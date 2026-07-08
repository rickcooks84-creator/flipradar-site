// ─── Whop license verification (shared) ──────────────────────────────────────
//
// The license key IS the Whop membership id (mem_...). We validate by fetching the
// membership and checking valid===true. NOTE: Whop's validate_license endpoint 400s for
// trialing / 100%-off-coupon memberships even though they're valid, so we use a plain GET
// (works for trial AND paid) — same approach as the desktop /api/license/activate route.

export interface WhopVerifyResult {
  ok: boolean;
  status: number;   // HTTP status to return to the client
  error?: string;
}

export async function verifyMembership(key: string): Promise<WhopVerifyResult> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) return { ok: false, status: 500, error: 'Server misconfigured (no WHOP_API_KEY).' };

  try {
    const res = await fetch(
      `https://api.whop.com/api/v2/memberships/${encodeURIComponent(key.trim())}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }
    );
    if (res.status === 404) return { ok: false, status: 403, error: 'License key not found. Copy it exactly from your email.' };
    if (!res.ok) return { ok: false, status: 502, error: 'Could not verify license right now. Try again.' };

    const m = await res.json().catch(() => ({} as any));
    if (m?.valid !== true) return { ok: false, status: 403, error: 'This license is inactive or expired.' };

    return { ok: true, status: 200 };
  } catch (e: any) {
    return { ok: false, status: 500, error: e?.message || 'Verification failed.' };
  }
}
