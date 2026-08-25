import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/app/lib/session';
import {
  readConnection, refreshAccessToken, hasInsights, signConnection,
  ebayConfigured, ebayCookieOptions, EBAY_COOKIE,
} from '@/app/lib/ebay-oauth';

// GET → what the /scan page needs to render the eBay button honestly.
//
// `connected` alone would be misleading, so this reports `insights` separately: a connection
// without the sold-data scope is real but can't produce comps. `live` is the difference
// between a token we're holding and one eBay still honours — a user who revoked FlipSonar in
// their eBay account settings looks connected here until we actually spend the refresh token.
export async function GET(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const connection = await readConnection(req.cookies.get(EBAY_COOKIE)?.value);
  if (!connection) {
    return NextResponse.json({ connected: false, configured: ebayConfigured() });
  }

  // Spend the refresh token to see whether the connection still stands. eBay's access tokens
  // last ~2h, so this is a cheap call we'd be making on the next scan anyway.
  const tok = await refreshAccessToken(connection.refreshToken, connection.scopes);
  const revoked = !tok.ok && /invalid_grant/i.test(tok.error || '');

  const res = NextResponse.json({
    connected: !revoked,
    live: tok.ok,
    insights: hasInsights(connection),
    scopes: connection.scopes,
    connectedAt: connection.connectedAt,
    configured: ebayConfigured(),
    // Distinguishes "eBay says no" from "we couldn't reach eBay" for the UI copy.
    error: tok.ok ? undefined : tok.error,
  });

  const host = req.headers.get('host');
  if (revoked) {
    res.cookies.set(EBAY_COOKIE, '', { ...ebayCookieOptions(host), maxAge: 0 });
  } else if (tok.ok && tok.scopes && tok.scopes.join(' ') !== connection.scopes.join(' ')) {
    // eBay can widen a grant (e.g. Insights approval landing) without the user reconnecting.
    res.cookies.set(EBAY_COOKIE, await signConnection({ ...connection, scopes: tok.scopes }), ebayCookieOptions(host));
  }
  return res;
}
