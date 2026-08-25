// ─── "Connect your eBay account" — OAuth authorization code flow ─────────────
//
// Same flow Auto List Bot uses (authorize → code → token → refresh), with two deliberate
// differences, both because this app is a paid product with a session of its own:
//
//  1. Tokens never touch the browser. Auto List Bot hands them back through URL params into
//     localStorage; here the refresh token goes straight into a signed httpOnly cookie, so it
//     stays out of browser history, referrer headers, server logs, and page scripts. Access
//     tokens are short-lived (~2h) and minted on demand from the refresh token instead of
//     being stored at all.
//
//  2. The authorize request carries a signed `state`, checked on the way back, so a third
//     party can't walk a logged-in user through a connection they didn't start.
//
// WHAT THIS UNLOCKS — read before assuming it fixes comps. FlipSonar scores on SOLD prices,
// and the only official sold endpoint is Marketplace Insights. That scope is granted at the
// APP level by eBay, not by the user consenting, and this app's grant was refused
// (`invalid_scope`, see EXTENSION.md). A user token does not route around that: connecting
// an account cannot produce sold comps until eBay approves the app for Insights. The flow
// requests the scope anyway and reports honestly when eBay withholds it, so the day approval
// lands the connection already works.

import { signPayload, verifyPayload } from './signed.ts';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const AUTHORIZE_URL = 'https://auth.ebay.com/oauth2/authorize';

export const EBAY_COOKIE = 'fs_ebay';
export const EBAY_STATE_COOKIE = 'fs_ebay_state';

const MINUTE_MS = 60 * 1000;
const STATE_TTL_MS = 15 * MINUTE_MS;   // long enough to sign in to eBay, short enough to matter

// eBay's authorization-code refresh tokens last ~18 months; we re-mint the cookie on every
// successful refresh, so this is the idle ceiling rather than a hard deadline.
const CONNECTION_TTL_MS = 540 * 24 * 60 * 60 * 1000;

/**
 * The base scope is what every token needs. Insights is the one we actually want — it is
 * requested even though the grant is currently refused, because eBay silently drops scopes it
 * won't grant rather than failing the whole authorization, and `grantedScopes` on the way back
 * tells us which we got.
 */
export const INSIGHTS_SCOPE = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';
const REQUESTED_SCOPES = ['https://api.ebay.com/oauth/api_scope', INSIGHTS_SCOPE];

export interface EbayConnection {
  refreshToken: string;
  scopes: string[];       // what eBay actually granted, not what we asked for
  connectedAt: number;
}

export function ebayConfig() {
  return {
    clientId: process.env.EBAY_CLIENT_ID || '',
    clientSecret: process.env.EBAY_CLIENT_SECRET || '',
    // eBay's authorization-code flow takes an RuName here, NOT a URL. It's created in the
    // developer console and its "Your auth accepted URL" must point at /api/ebay/callback.
    ruName: process.env.EBAY_RUNAME || '',
  };
}

export function ebayConfigured(): boolean {
  const c = ebayConfig();
  return !!(c.clientId && c.clientSecret && c.ruName);
}

function basicAuth(): string {
  const { clientId, clientSecret } = ebayConfig();
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

// ── state (CSRF) ─────────────────────────────────────────────────────────────

/** Bind the pending connection to the FlipSonar user who started it. */
export function signState(licenseKey: string): Promise<string> {
  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)));
  return signPayload({ k: licenseKey, n: nonce, e: Date.now() + STATE_TTL_MS });
}

export async function verifyState(token: string | undefined | null, licenseKey: string): Promise<boolean> {
  const p = await verifyPayload<{ k?: unknown }>(token);
  return !!p && String(p.k) === licenseKey;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/[^A-Za-z0-9]/g, '');
}

// ── the flow ─────────────────────────────────────────────────────────────────

export function authorizeUrl(state: string): string {
  const { clientId, ruName } = ebayConfig();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', ruName);
  url.searchParams.set('scope', REQUESTED_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export interface TokenResult {
  ok: boolean;
  error?: string;
  refreshToken?: string;
  accessToken?: string;
  scopes?: string[];
}

/** Swap the one-time code from eBay's redirect for a refresh + access token. */
export async function exchangeCode(code: string): Promise<TokenResult> {
  const { ruName } = ebayConfig();
  return tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ruName,
  }));
}

/**
 * Mint a fresh access token from a stored refresh token. Scopes must be re-stated here —
 * eBay rejects a refresh asking for more than the original grant, which is why we pass back
 * what it granted rather than what we requested.
 */
export async function refreshAccessToken(refreshToken: string, scopes: string[]): Promise<TokenResult> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: (scopes.length ? scopes : REQUESTED_SCOPES).join(' '),
  }));
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResult> {
  if (!ebayConfigured()) return { ok: false, error: 'eBay is not configured on the server.' };
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      // eBay puts the useful part in error_description ("invalid_scope", "invalid_grant" for
      // a revoked connection, …). Pass it through rather than flattening to "failed".
      let detail = text.slice(0, 300);
      try { const j = JSON.parse(text); detail = j.error_description || j.error || detail; } catch { /* keep raw */ }
      return { ok: false, error: detail };
    }
    const j = JSON.parse(text);
    return {
      ok: true,
      refreshToken: j.refresh_token,
      accessToken: j.access_token,
      // Older eBay responses omit grantedScopes; fall back to `scope`, then to what we asked.
      scopes: String(j.grantedScopes || j.scope || REQUESTED_SCOPES.join(' ')).split(/\s+/).filter(Boolean),
    };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'eBay token request failed.' };
  }
}

// ── the stored connection ────────────────────────────────────────────────────

export function signConnection(c: EbayConnection): Promise<string> {
  return signPayload({ r: c.refreshToken, s: c.scopes, c: c.connectedAt, e: Date.now() + CONNECTION_TTL_MS });
}

export async function readConnection(token?: string | null): Promise<EbayConnection | null> {
  const p = await verifyPayload<{ r?: unknown; s?: unknown; c?: unknown }>(token);
  if (!p?.r) return null;
  return {
    refreshToken: String(p.r),
    scopes: Array.isArray(p.s) ? p.s.map(String) : [],
    connectedAt: typeof p.c === 'number' ? p.c : 0,
  };
}

/** Did eBay actually grant the sold-data scope? This is what gates real comps. */
export function hasInsights(c: EbayConnection | null): boolean {
  return !!c?.scopes.includes(INSIGHTS_SCOPE);
}

export function ebayCookieOptions(host?: string | null, maxAgeS = Math.floor(CONNECTION_TTL_MS / 1000)) {
  const h = (host || '').toLowerCase().split(':')[0];
  const domain = h.endsWith('flipsonar.io') ? '.flipsonar.io' : undefined;
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeS,
    ...(domain ? { domain } : {}),
  };
}

export const STATE_MAX_AGE_S = Math.floor(STATE_TTL_MS / 1000);
