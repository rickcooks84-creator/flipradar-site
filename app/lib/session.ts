// ─── Stateless signed session cookie (Edge + Node compatible) ────────────────
//
// The desktop app gates access with a local license.json file. That can't work on the
// web (no per-user server file, ephemeral serverless FS), so the web build authenticates
// with a signed, httpOnly cookie instead: the user enters their Whop key once, we verify
// it, and mint a cookie carrying the key + an expiry, signed with HMAC-SHA-256.
//
// This module uses ONLY Web Crypto (crypto.subtle) + btoa/atob so the SAME code runs in
// the Edge middleware (which verifies the cookie on every request) and in the Node route
// handlers (which mint it). No Node-only APIs, no external deps.

const enc = new TextEncoder();

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str: string): Uint8Array {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const SESSION_COOKIE = 'fs_session';

export async function signSession(memKey: string, ttlMs = DEFAULT_TTL_MS): Promise<string> {
  const payload = { k: memKey, e: Date.now() + ttlMs };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body) as BufferSource));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token?: string | null): Promise<{ key: string } | null> {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), fromB64url(sig) as BufferSource, enc.encode(body) as BufferSource);
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!payload?.k || typeof payload.e !== 'number' || Date.now() > payload.e) return null;
    return { key: String(payload.k) };
  } catch {
    return null;
  }
}
