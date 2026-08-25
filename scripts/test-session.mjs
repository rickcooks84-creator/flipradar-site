// ─── Does a login actually stay logged in? ───────────────────────────────────
//
//   node scripts/test-session.mjs                                (session logic only)
//   FS_BASE=http://localhost:3111 node scripts/test-session.mjs  (+ the live proxy)
//
// The web build has no user table — being logged in IS the signed fs_session cookie, and
// the proxy re-mints it as people browse. That rolling refresh is the whole reason a login
// survives: the original build stamped a fixed 30-day expiry at login and never renewed it,
// so every user was silently dumped back at /login a month after signing up, mid-scan.
//
// The failure mode is slow and invisible — nothing throws, no session breaks today, and you
// only hear about it 30 days later — so the clock behaviour is pinned here against a faked
// Date.now() rather than left to trust. The HTTP half (skipped unless FS_BASE is set and
// reachable) covers what the unit tests can't see: that the refreshed cookie really lands on
// the response, and that a cancelled membership still ends the session.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signSession, verifySession, needsRefresh, needsReverify, reverifySoon,
  sessionCookieOptions,
} from '../app/lib/session.ts';
import {
  signState, verifyState, signConnection, readConnection, hasInsights,
  authorizeUrl, ebayConfigured, ebayCookieOptions, INSIGHTS_SCOPE,
} from '../app/lib/ebay-oauth.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Sign with the same secret the dev server loaded from .env.local — otherwise every cookie
// this script mints is correctly rejected and the HTTP checks fail for the wrong reason.
if (!process.env.SESSION_SECRET) {
  const p = path.join(ROOT, '.env.local');
  const m = fs.existsSync(p) && /^SESSION_SECRET=(.*)$/m.exec(fs.readFileSync(p, 'utf8'));
  if (m) process.env.SESSION_SECRET = m[1].trim().replace(/^["']|["']$/g, '');
}

const DAY = 24 * 60 * 60 * 1000;
const enc = new TextEncoder();
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = tok => {
  let s = tok.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
};

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  → ' + detail : '')); }
};

/** Mint a token as if it had been issued `days` ago. */
async function backdate(key, days, opts) {
  const realNow = Date.now;
  Date.now = () => realNow() - days * DAY;
  try { return await signSession(key, opts); } finally { Date.now = realNow; }
}

// ── the cookie itself ────────────────────────────────────────────────────────
const tok = await signSession('mem_abc');
const fresh = await verifySession(tok);
t('round trip returns the key', fresh?.key === 'mem_abc');
t('a fresh cookie is not re-minted', fresh && !needsRefresh(fresh));
t('a fresh cookie is not re-verified', fresh && !needsReverify(fresh));
t('a tampered cookie is rejected', (await verifySession(tok.replace(/^./, 'X'))) === null);
t('garbage is rejected', (await verifySession('nope')) === null);
t('a missing cookie is rejected', (await verifySession(undefined)) === null);
t('an expired cookie is rejected', (await verifySession(await signSession('mem_abc', { ttlMs: -1000 }))) === null);

// ── the rolling window: active users never age out ───────────────────────────
const twoDays = await verifySession(await backdate('mem_abc', 2));
t('a 2-day-old cookie rolls forward', needsRefresh(twoDays));
t('a 2-day-old cookie is not re-verified yet', !needsReverify(twoDays));
t('an 8-day-old cookie is re-verified', needsReverify(await verifySession(await backdate('mem_abc', 8))));
t('day 31 no longer signs anyone out', (await verifySession(await backdate('mem_abc', 31)))?.key === 'mem_abc');
t('364 days idle is still signed in', (await verifySession(await backdate('mem_abc', 364)))?.key === 'mem_abc');
t('366 days idle is signed out', (await verifySession(await backdate('mem_abc', 366))) === null);

// ── cookies minted before the rolling change must upgrade, not strand ────────
const legacyBody = b64url(enc.encode(JSON.stringify({ k: 'mem_legacy', e: Date.now() + 5 * DAY })));
const hmac = await crypto.subtle.importKey(
  'raw', enc.encode(process.env.SESSION_SECRET || 'dev-insecure-secret-change-me'),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
);
const legacySig = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, enc.encode(legacyBody)));
const legacy = await verifySession(`${legacyBody}.${b64url(legacySig)}`);
t('a pre-rolling cookie still verifies', legacy?.key === 'mem_legacy');
t('a pre-rolling cookie is rescued on the next visit', legacy && needsRefresh(legacy) && needsReverify(legacy));

// ── a Whop outage must not log paying users out ──────────────────────────────
const backoff = reverifySoon();
t('a soft failure retries in ~an hour, not a week',
  !needsReverify({ key: 'x', issuedAt: Date.now(), verifiedAt: backoff })
  && Math.abs((Date.now() - backoff) / 6e4 - (7 * 24 * 60 - 60)) < 1);

// ── cookie scope: www and the bare domain must share one session ─────────────
const opts = sessionCookieOptions('www.flipsonar.io');
t('www is scoped to .flipsonar.io', opts.domain === '.flipsonar.io');
t('the bare domain is scoped to .flipsonar.io', sessionCookieOptions('flipsonar.io').domain === '.flipsonar.io');
t('localhost stays host-only', sessionCookieOptions('localhost:3111').domain === undefined);
t('the cookie outlives the browser session', opts.maxAge === 365 * 24 * 60 * 60 && opts.httpOnly === true);

// ── the eBay connection cookie ───────────────────────────────────────────────
//
// It carries an OAuth refresh token, so forging it is the interesting attack: a valid-looking
// fs_ebay would let someone spend FlipSonar's client credentials against an account of their
// choosing. And `state` is what stops a third party walking a logged-in user through a
// connection they never started.
const conn = { refreshToken: 'v^1.1#refresh#token', scopes: ['https://api.ebay.com/oauth/api_scope'], connectedAt: Date.now() };
const stored = await readConnection(await signConnection(conn));
t('a connection round-trips', stored?.refreshToken === conn.refreshToken);
t('granted scopes survive the round trip', stored?.scopes.join() === conn.scopes.join());
t('a tampered connection cookie is rejected', (await readConnection((await signConnection(conn)).replace(/^./, 'X'))) === null);
t('garbage is not a connection', (await readConnection('nope')) === null);
t('no cookie is not a connection', (await readConnection(undefined)) === null);

// The whole point of the honest UI: connected does not imply sold data.
t('a base-scope connection does NOT claim Insights', !hasInsights(stored));
t('an Insights-scoped connection does', hasInsights({ ...conn, scopes: [INSIGHTS_SCOPE] }));

const state = await signState('mem_abc');
t('state verifies for the user who started the flow', await verifyState(state, 'mem_abc'));
t('state does NOT verify for a different user', !(await verifyState(state, 'mem_someone_else')));
t('a forged state is rejected', !(await verifyState(state.replace(/^./, 'X'), 'mem_abc')));
t('a missing state is rejected', !(await verifyState(undefined, 'mem_abc')));
t('two flows get different states', (await signState('mem_abc')) !== (await signState('mem_abc')));

t('the eBay cookie is httpOnly and domain-scoped', ebayCookieOptions('www.flipsonar.io').domain === '.flipsonar.io'
  && ebayCookieOptions('www.flipsonar.io').httpOnly === true);

// The authorize URL is what eBay validates; a wrong shape fails at the consent screen.
const auth = new URL(authorizeUrl(state));
t('authorize points at eBay consent', auth.origin + auth.pathname === 'https://auth.ebay.com/oauth2/authorize');
t('authorize asks for the sold-data scope', (auth.searchParams.get('scope') || '').includes(INSIGHTS_SCOPE));
t('authorize carries the state', auth.searchParams.get('state') === state);
t('authorize is an authorization_code flow', auth.searchParams.get('response_type') === 'code');
t('ebayConfigured() is false without a RuName', ebayConfigured() === !!process.env.EBAY_RUNAME);

// ── live proxy (optional) ────────────────────────────────────────────────────
const BASE = process.env.FS_BASE;
const reachable = BASE && await fetch(BASE, { redirect: 'manual' }).then(() => true).catch(() => false);
if (!reachable) {
  console.log(BASE
    ? `\n(skipped the HTTP checks — nothing answering at ${BASE})`
    : '\n(skipped the HTTP checks — set FS_BASE to a running server)');
} else {
  const get = (path, cookie) =>
    fetch(BASE + path, { redirect: 'manual', headers: cookie ? { cookie: `fs_session=${cookie}` } : {} });
  const setCookie = r => {
    const hit = r.headers.getSetCookie().find(c => c.startsWith('fs_session='));
    return hit ? hit.slice('fs_session='.length).split(';')[0] : null;
  };

  let r = await get('/scan');
  t('signed out → /login', r.status === 307 && (r.headers.get('location') || '').endsWith('/login'), String(r.status));
  t('signed out scanner API → 401', (await get('/api/vin?vin=x')).status === 401);
  t('a forged cookie → /login', (await get('/scan', 'garbage.token')).status === 307);

  const good = await signSession('mem_abc');
  r = await get('/scan', good);
  t('a valid session reaches /scan', r.status === 200, String(r.status));
  t('a fresh session adds no Set-Cookie', setCookie(r) === null);

  r = await get('/scan', await backdate('mem_abc', 3));
  const rolled = setCookie(r);
  t('an ageing session is re-minted on the way through', r.status === 200 && !!rolled, String(r.status));
  if (rolled) {
    t('the refreshed cookie keeps the key', decode(rolled).k === 'mem_abc');
    t('the refreshed cookie expires ~a year out', Math.abs((decode(rolled).e - Date.now()) / DAY - 365) < 1);
    t('the refreshed cookie is not immediately re-minted', setCookie(await get('/scan', rolled)) === null);
  }

  // A cookie one day from the OLD 30-day expiry — the case that used to log people out.
  // verifiedAt is stamped with the real clock (backdate fakes Date.now for the mint), so this
  // asks only about the expiry and doesn't also trip a Whop re-check on a made-up key.
  r = await get('/scan', await backdate('mem_abc', 29, { ttlMs: 30 * DAY, verifiedAt: Date.now() }));
  const saved = setCookie(r);
  t('a session at the old 30-day wall is rescued', r.status === 200 && !!saved, String(r.status));
  if (saved) t('…and has ~a year left again', (decode(saved).e - Date.now()) / DAY > 364);

  r = await get('/login', good);
  t('an already-signed-in visitor to /login → /scan', r.status === 307 && (r.headers.get('location') || '').endsWith('/scan'), String(r.status));
  t('a signed-out visitor to /login gets the form', (await get('/login')).status === 200);

  // eBay routes are gated on the FlipSonar session, not just the proxy matcher.
  t('eBay status needs a login', (await get('/api/ebay/status')).status === 401);
  t('eBay disconnect needs a login',
    (await fetch(BASE + '/api/ebay/disconnect', { method: 'POST', redirect: 'manual' })).status === 401);
  r = await get('/api/ebay/connect');
  t('eBay connect needs a login', r.status === 307 && (r.headers.get('location') || '').endsWith('/login'), String(r.status));

  r = await get('/api/ebay/connect', good);
  const dest = r.headers.get('location') || '';
  // With no EBAY_RUNAME configured this must say so rather than bouncing users to a broken
  // eBay consent screen; with one, it must be a real authorize URL carrying a state.
  t('eBay connect goes somewhere honest',
    dest.includes('ebay=unconfigured') || (dest.startsWith('https://auth.ebay.com/oauth2/authorize') && dest.includes('state=')),
    dest.slice(0, 90));

  // A logged-in user with no connection is reported as not connected, not as an error.
  const st = await (await get('/api/ebay/status', good)).json();
  t('no eBay connection reads as not connected', st.connected === false);
  t('status reports whether the server is configured', typeof st.configured === 'boolean');

  // Needs WHOP_API_KEY on the server: a stale session for a membership Whop has never heard of.
  const stale = await signSession('mem_definitely_not_a_real_membership', { verifiedAt: Date.now() - 8 * DAY });
  r = await get('/scan', stale);
  const loc = r.headers.get('location') || '';
  t('a stale session on a dead membership is signed out', r.status === 307 && loc.includes('expired=1'), `${r.status} ${loc}`);
  t('…and its cookie is cleared', setCookie(r) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
