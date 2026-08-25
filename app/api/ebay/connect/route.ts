import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/app/lib/session';
import {
  authorizeUrl, signState, ebayConfigured, ebayCookieOptions,
  EBAY_STATE_COOKIE, STATE_MAX_AGE_S,
} from '@/app/lib/ebay-oauth';

// GET → send the user to eBay's consent screen.
//
// The FlipSonar session is checked here rather than left to the proxy: the proxy's matcher is
// a separate list that a later refactor can quietly stop covering, and Next's own docs warn
// against relying on it as the only gate. A connection must belong to a known account — the
// state cookie binds it to this license key so the callback can prove the round trip.
export async function GET(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.redirect(new URL('/login', req.url));

  if (!ebayConfigured()) {
    return NextResponse.redirect(new URL('/scan?ebay=unconfigured', req.url));
  }

  const state = await signState(session.key);
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set(EBAY_STATE_COOKIE, state, ebayCookieOptions(req.headers.get('host'), STATE_MAX_AGE_S));
  return res;
}
