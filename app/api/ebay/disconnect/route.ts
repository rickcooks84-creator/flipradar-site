import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/app/lib/session';
import { ebayCookieOptions, EBAY_COOKIE, EBAY_STATE_COOKIE } from '@/app/lib/ebay-oauth';

// POST → forget the stored eBay connection.
//
// This clears FlipSonar's copy of the refresh token. It does NOT revoke the grant on eBay's
// side — only the user can do that, from their eBay account settings — so the UI says so
// rather than implying a clean break we can't deliver.
export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const host = req.headers.get('host');
  const res = NextResponse.json({ success: true });
  res.cookies.set(EBAY_COOKIE, '', { ...ebayCookieOptions(host), maxAge: 0 });
  res.cookies.set(EBAY_STATE_COOKIE, '', { ...ebayCookieOptions(host), maxAge: 0 });
  return res;
}
