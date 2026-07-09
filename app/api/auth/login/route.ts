import { NextRequest, NextResponse } from 'next/server';
import { verifyMembership } from '@/app/lib/whop';
import { signSession, SESSION_COOKIE } from '@/app/lib/session';

// POST { key } → verify the Whop membership → set a signed httpOnly session cookie.
export async function POST(req: NextRequest) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key?.trim()) return NextResponse.json({ error: 'License key required' }, { status: 400 });

  const v = await verifyMembership(key.trim());
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  // Scope the cookie to the registrable domain (".flipsonar.io") so it's valid on BOTH the
  // bare domain and www — otherwise a redirect between them drops the session and logs the
  // user out. On localhost we leave it host-only (browsers reject a Domain for localhost).
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  const domain = host.endsWith('flipsonar.io') ? '.flipsonar.io' : undefined;

  const token = await signSession(key.trim());
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days (seconds)
    ...(domain ? { domain } : {}),
  });
  return res;
}
