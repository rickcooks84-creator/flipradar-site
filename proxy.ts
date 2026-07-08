import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/app/lib/session';

// Gate ONLY the junkyard scanner. The marketing homepage, /activate, FAQ, and the existing
// webhook/validate APIs stay fully public — the matcher below only covers the scanner routes.
// Signed-out request → /login (for the page) or 401 (for the scanner APIs).
export async function proxy(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/vehicle/:path*', '/api/vehicle-scan/:path*', '/api/vin/:path*'],
};
