// ─── Stateless signed session cookie (Edge + Node compatible) ────────────────
//
// The desktop app gates access with a local license.json file. That can't work on the
// web (no per-user server file, ephemeral serverless FS), so the web build authenticates
// with a signed, httpOnly cookie instead: the user enters their Whop key once, we verify
// it, and mint a cookie carrying the key + an expiry, signed with HMAC-SHA-256.
//
// The session is ROLLING, not fixed: the expiry used to be stamped once at login, so
// everyone was kicked back to /login exactly 30 days after signing in even if they used
// the scanner daily. Now the proxy re-mints the cookie as people browse (see needsRefresh),
// so an active user stays logged in indefinitely and only a genuinely idle one ages out.
//
// Because the session no longer expires on its own, it carries `v` — when the membership
// was last checked against Whop — so a cancelled subscriber can't hold a permanent session
// (see needsReverify + the proxy).
//
// The HMAC signing itself lives in ./signed, shared with the eBay connection cookie.

import { signPayload, verifyPayload } from './signed.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// How long a session survives with NO visits at all. Chrome clamps cookie Max-Age to 400
// days, so there's no point going past that.
const DEFAULT_TTL_MS = 365 * DAY_MS;
export const SESSION_MAX_AGE_S = Math.floor(DEFAULT_TTL_MS / 1000);

// Re-mint the cookie after a day of use rather than on every request: signing is cheap, but
// a Set-Cookie on every response is noise.
const REFRESH_AFTER_MS = 1 * DAY_MS;

// How often the membership is re-checked against Whop while the session rolls forward.
const REVERIFY_AFTER_MS = 7 * DAY_MS;

// When Whop can't be reached we keep the user signed in (never log someone out over an
// outage) but retry sooner than a full week.
const REVERIFY_RETRY_MS = 1 * 60 * 60 * 1000; // 1 hour

export const SESSION_COOKIE = 'fs_session';

export interface Session {
  key: string;
  issuedAt: number;    // when this cookie was minted
  verifiedAt: number;  // when the membership was last confirmed with Whop
}

export async function signSession(
  memKey: string,
  opts: { verifiedAt?: number; ttlMs?: number } = {}
): Promise<string> {
  const now = Date.now();
  const payload = {
    k: memKey,
    e: now + (opts.ttlMs ?? DEFAULT_TTL_MS),
    i: now,
    v: opts.verifiedAt ?? now,
  };
  return signPayload(payload);
}

export async function verifySession(token?: string | null): Promise<Session | null> {
  const payload = await verifyPayload<{ k?: unknown; i?: unknown; v?: unknown }>(token);
  if (!payload?.k) return null;
  // Cookies minted before the rolling-session change carry no `i`/`v`. Treating both as 0
  // upgrades them on the holder's next visit (refresh + one re-verify) instead of stranding
  // them on the old 30-day clock.
  return {
    key: String(payload.k),
    issuedAt: typeof payload.i === 'number' ? payload.i : 0,
    verifiedAt: typeof payload.v === 'number' ? payload.v : 0,
  };
}

/** True once the cookie is old enough to be worth re-minting with a fresh expiry. */
export function needsRefresh(s: Session): boolean {
  return Date.now() - s.issuedAt >= REFRESH_AFTER_MS;
}

/** True once the membership behind this session should be re-checked with Whop. */
export function needsReverify(s: Session): boolean {
  return Date.now() - s.verifiedAt >= REVERIFY_AFTER_MS;
}

/** Back-dated `verifiedAt` that makes the next re-verify attempt happen in ~an hour. */
export function reverifySoon(): number {
  return Date.now() - REVERIFY_AFTER_MS + REVERIFY_RETRY_MS;
}

/**
 * Cookie attributes, shared by the login route and the proxy so a refreshed cookie lands on
 * exactly the same name/scope as the original instead of creating a second one beside it.
 *
 * Scoped to the registrable domain (".flipsonar.io") so it's valid on BOTH the bare domain
 * and www — otherwise a redirect between them drops the session and logs the user out. On
 * localhost we leave it host-only (browsers reject a Domain for localhost).
 */
export function sessionCookieOptions(host?: string | null) {
  const h = (host || '').toLowerCase().split(':')[0];
  const domain = h.endsWith('flipsonar.io') ? '.flipsonar.io' : undefined;
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
    ...(domain ? { domain } : {}),
  };
}
