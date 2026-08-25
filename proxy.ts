import { NextRequest, NextResponse } from 'next/server';
import {
  verifySession, signSession, needsRefresh, needsReverify, reverifySoon,
  sessionCookieOptions, SESSION_COOKIE,
} from '@/app/lib/session';
import { verifyMembership } from '@/app/lib/whop';

// Gate ONLY the junkyard scanner. The marketing homepage, /activate, FAQ, and the existing
// webhook/validate APIs stay fully public — the matcher below only covers the scanner routes.
// Signed-out request → /login (for the page) or 401 (for the scanner APIs).
//
// This is also where the session is kept alive: every gated request re-mints an ageing
// cookie, so someone who uses FlipSonar stays logged in instead of being dumped at /login a
// month after signing up. The membership is re-checked with Whop on a slow cadence so an
// endless session still ends when someone cancels.
export async function proxy(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return deny(req);

  let verifiedAt = session.verifiedAt;
  if (needsReverify(session)) {
    const v = await verifyMembership(session.key);
    if (v.ok) {
      verifiedAt = Date.now();
    } else if (v.status === 403) {
      // Whop answered and said this membership is gone or inactive — the one case where we
      // do end the session.
      return deny(req, true);
    } else {
      // Whop unreachable / misconfigured / 5xx: an outage must never log paying users out.
      // Keep them in and try again in an hour.
      verifiedAt = reverifySoon();
    }
  }

  const res = NextResponse.next();
  if (verifiedAt !== session.verifiedAt || needsRefresh(session)) {
    const token = await signSession(session.key, { verifiedAt });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req.headers.get('host')));
  }
  return res;
}

function deny(req: NextRequest, clear = false) {
  const res = req.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : redirectToLogin(req, clear);
  if (clear) {
    res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(req.headers.get('host')), maxAge: 0 });
  }
  return res;
}

function redirectToLogin(req: NextRequest, expired: boolean) {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = expired ? '?expired=1' : '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/scan/:path*',
    '/api/store-scrape/:path*',
    '/api/comp/:path*',
    '/api/comp-items/:path*',
    '/api/vehicle-comp-items/:path*',
    '/api/vehicle-scan/:path*',
    '/api/vehicle-parts/:path*',
    '/api/vin/:path*',
  ],
};
