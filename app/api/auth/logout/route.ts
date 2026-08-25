import { NextRequest, NextResponse } from 'next/server';
import { sessionCookieOptions, SESSION_COOKIE } from '@/app/lib/session';

// POST → clear the session cookie. We clear BOTH the domain-scoped (.flipsonar.io) cookie
// used going forward AND any older host-only cookie, so logout is complete regardless of
// which one the browser is holding. Getting this wrong is worse now that sessions are
// long-lived: a leftover cookie would silently sign the user back in.
export async function POST(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(host), maxAge: 0 });
  if (host.endsWith('flipsonar.io')) {
    // Host-only twin of the same cookie (no Domain attribute) — a different cookie as far as
    // the browser is concerned, so it needs its own expiry.
    res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  }
  return res;
}
