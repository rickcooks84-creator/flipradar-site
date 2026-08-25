import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/app/lib/session';
import {
  exchangeCode, verifyState, signConnection, hasInsights,
  ebayCookieOptions, EBAY_COOKIE, EBAY_STATE_COOKIE,
} from '@/app/lib/ebay-oauth';

// GET ← eBay redirects here with ?code=… (or ?error=…) after the user accepts or declines.
//
// Everything lands back on /scan with an ?ebay= reason the page explains in plain words. The
// interesting outcome isn't success or failure — it's `connected_no_insights`: eBay hands
// back a perfectly valid token while silently withholding the sold-data scope, which is the
// state this app is in until it's approved for Marketplace Insights. Reporting that as
// "connected" would be a lie the user only discovers when comps stay empty.
export async function GET(req: NextRequest) {
  const back = (reason: string) => NextResponse.redirect(new URL(`/scan?ebay=${reason}`, req.url));

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.redirect(new URL('/login', req.url));

  const { searchParams } = new URL(req.url);
  if (searchParams.get('error')) return back('declined');

  const code = searchParams.get('code');
  if (!code) return back('declined');

  // The state cookie must match the one minted for THIS license key when the flow started.
  const state = searchParams.get('state');
  const cookieState = req.cookies.get(EBAY_STATE_COOKIE)?.value;
  if (!state || !cookieState || state !== cookieState || !(await verifyState(state, session.key))) {
    return back('state_mismatch');
  }

  const tok = await exchangeCode(code);
  if (!tok.ok || !tok.refreshToken) {
    // invalid_scope here means eBay refused the whole grant rather than trimming it — the
    // app isn't approved for a scope it asked for.
    const reason = /invalid_scope/i.test(tok.error || '') ? 'scope_refused' : 'error';
    return back(reason);
  }

  const connection = {
    refreshToken: tok.refreshToken,
    scopes: tok.scopes ?? [],
    connectedAt: Date.now(),
  };

  const host = req.headers.get('host');
  const res = back(hasInsights(connection) ? 'connected' : 'connected_no_insights');
  res.cookies.set(EBAY_COOKIE, await signConnection(connection), ebayCookieOptions(host));
  res.cookies.set(EBAY_STATE_COOKIE, '', { ...ebayCookieOptions(host), maxAge: 0 });
  return res;
}
