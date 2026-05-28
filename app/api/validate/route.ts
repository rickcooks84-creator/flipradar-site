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
    const res = await fetch(
      `https://api.whop.com/api/v2/memberships/${encodeURIComponent(key.trim())}/validate_license`,
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body:    JSON.stringify({}),
      }
    );

    if (res.status === 200 || res.status === 201) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false, error: "Invalid or expired license key." }, { status: 400 });
  } catch {
    return NextResponse.json({ valid: false, error: "Could not reach license server." }, { status: 500 });
  }
}
