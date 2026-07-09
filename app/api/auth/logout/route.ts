import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/app/lib/session';

// POST → clear the session cookie. We clear BOTH the domain-scoped (.flipsonar.io) cookie
// used going forward AND any older host-only cookie, so logout is complete regardless of
// which one the browser is holding.
export async function POST(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  const res = NextResponse.json({ success: true });
  res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  if (host.endsWith('flipsonar.io')) {
    res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; Domain=.flipsonar.io; HttpOnly; SameSite=Lax`);
  }
  return res;
}
