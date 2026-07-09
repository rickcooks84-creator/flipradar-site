import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/app/lib/session';

// Web build is always cookie-authenticated. Returns `mode: 'cookie'` so the shared /scan
// page's logout sends users to /login here (and /activate in the desktop build, which has
// its own file-based check that returns mode: 'file').
export async function GET(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json({ valid: !!session, key: session?.key, mode: 'cookie' });
}
