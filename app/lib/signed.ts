// ─── Signed, tamper-evident cookie payloads (Edge + Node compatible) ─────────
//
// The web build keeps its per-user state in cookies rather than a database — there's no user
// table, and a serverless filesystem is gone the moment the request ends. That only works if
// the browser can't edit what it's holding, so every payload is HMAC-SHA-256 signed with
// SESSION_SECRET and carries its own expiry.
//
// Two things ride on this: who is logged in (session.ts) and which eBay account they've
// connected (ebay-oauth.ts). Both are Cookies You Must Not Be Able To Forge — one grants
// access to a paid product, the other carries an OAuth refresh token — so the primitive is
// shared rather than reimplemented per feature.
//
// Web Crypto + btoa/atob only, so the same code runs in the proxy and in Node route handlers.

const enc = new TextEncoder();

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str: string): Uint8Array {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Sign an arbitrary payload. `e` (expiry, ms since epoch) is the caller's job to include —
 * verifyPayload enforces it, so a payload without one never expires.
 */
export async function signPayload(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body) as BufferSource));
  return `${body}.${b64url(sig)}`;
}

/** Verify signature + expiry. Returns null for anything forged, corrupt, or past its `e`. */
export async function verifyPayload<T = Record<string, unknown>>(token?: string | null): Promise<T | null> {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), fromB64url(sig) as BufferSource, enc.encode(body) as BufferSource);
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (typeof payload?.e !== 'number' || Date.now() > payload.e) return null;
    return payload as T;
  } catch {
    return null;
  }
}
