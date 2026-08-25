import { NextRequest, NextResponse } from 'next/server';
import { verifyMembership } from '@/app/lib/whop';
import { signSession, sessionCookieOptions, SESSION_COOKIE } from '@/app/lib/session';

// POST { key } → verify the Whop membership → set a signed httpOnly session cookie.
// The cookie is long-lived and the proxy rolls it forward on every visit, so logging in
// here is a one-time thing rather than a monthly chore. Cookie scope/flags live in
// sessionCookieOptions so the mint here and the refresh in the proxy can't drift apart.
export async function POST(req: NextRequest) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key?.trim()) return NextResponse.json({ error: 'License key required' }, { status: 400 });

  const v = await verifyMembership(key.trim());
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const token = await signSession(key.trim());
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req.headers.get('host')));
  return res;
}
