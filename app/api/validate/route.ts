import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { key } = await req.json();
  if (!key || typeof key !== "string") {
    return NextResponse.json({ valid: false, error: "No license key provided." }, { status: 400 });
  }

  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ valid: false, error: "Server configuration error." }, { status: 500 });
  }

  try {
    // Validate by fetching the membership and checking it's valid. We do NOT use Whop's
    // validate_license endpoint: it 400s for trialing / 100%-off-coupon memberships even
    // though they're perfectly valid (valid:true). A plain GET works for trial AND paid.
    const res = await fetch(
      `https://api.whop.com/api/v2/memberships/${encodeURIComponent(key.trim())}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );

    if (res.ok) {
      const m = await res.json().catch(() => ({}));
      if (m?.valid === true) return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false, error: "Invalid or expired license key." }, { status: 400 });
  } catch {
    return NextResponse.json({ valid: false, error: "Could not reach license server." }, { status: 500 });
  }
}
