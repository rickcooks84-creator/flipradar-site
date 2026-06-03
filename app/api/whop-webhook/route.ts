import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Resend } from "resend";

// Whop sends webhooks server-to-server; never cache, always run on Node (we use node:crypto).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FROM = process.env.RESEND_FROM || "FlipSonar <support@flipsonar.io>";
const REPLY_TO = process.env.SUPPORT_EMAIL || "support@flipsonar.io";
const ACTIVATE_URL = process.env.ACTIVATE_URL || "https://flipsonar.io/activate";

/**
 * Verify a Whop webhook using the Standard Webhooks spec.
 * Headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<base64hmac> v1,<...>").
 * signed content = `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 keyed by the
 * base64-decoded secret (the part after the `whsec_` prefix).
 */
function verifyWhopSignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[whop-webhook] WHOP_WEBHOOK_SECRET not set");
    return false;
  }

  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !sigHeader) return false;

  // Reject stale/replayed deliveries (5 minute tolerance).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    console.error("[whop-webhook] timestamp outside tolerance");
    return false;
  }

  // Whop's secret is `ws_...`. The SDK uses it as `btoa(secret)`, which the
  // Standard Webhooks lib base64-decodes straight back to the raw string bytes,
  // so the HMAC key is simply the full secret string (NOT base64-decoded).
  const keyBytes = Buffer.from(secret, "utf8");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", keyBytes)
    .update(signedContent)
    .digest("base64");

  // The header may carry multiple space-separated `v1,<sig>` entries.
  return sigHeader.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

/** Pull the buyer email out of the membership payload, falling back to an API lookup. */
async function resolveEmail(data: any): Promise<string | null> {
  const direct =
    data?.user?.email || data?.email || data?.user_email || null;
  if (direct) return direct;

  // Fallback: re-fetch the membership with the user expanded.
  const apiKey = process.env.WHOP_API_KEY;
  const id = data?.id;
  if (!apiKey || !id) return null;
  try {
    const res = await fetch(`https://api.whop.com/api/v2/memberships/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const m = await res.json();
    return m?.user?.email || m?.email || null;
  } catch {
    return null;
  }
}

function emailHtml(key: string): string {
  return `<!doctype html><html><body style="margin:0;background:#07111a;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e6f0ea;padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#0b1722;border:1px solid #13283a;border-radius:14px;overflow:hidden">
      <tr><td style="padding:28px 32px 8px">
        <div style="font-size:22px;font-weight:700;color:#00ff88;letter-spacing:.3px">FlipSonar 🛰️</div>
      </td></tr>
      <tr><td style="padding:8px 32px 0">
        <h1 style="font-size:20px;margin:12px 0 6px;color:#ffffff">Thanks for your purchase!</h1>
        <p style="font-size:15px;line-height:1.6;color:#9fb4c2;margin:0 0 20px">Here's your license key. Keep it safe — you'll need it to activate the FlipSonar desktop app.</p>
      </td></tr>
      <tr><td style="padding:0 32px">
        <div style="background:#07131c;border:1px solid #00ff88;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#5a7385;margin-bottom:6px">Your License Key</div>
          <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;font-weight:700;color:#00ff88;word-break:break-all">${key}</div>
        </div>
      </td></tr>
      <tr><td style="padding:24px 32px 8px" align="center">
        <a href="${ACTIVATE_URL}" style="display:inline-block;background:#00ff88;color:#03210f;font-weight:700;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:9px">Activate FlipSonar →</a>
      </td></tr>
      <tr><td style="padding:18px 32px 8px">
        <ol style="font-size:14px;line-height:1.7;color:#9fb4c2;padding-left:18px;margin:0">
          <li>Download &amp; open the FlipSonar desktop app.</li>
          <li>Paste the license key above when prompted.</li>
          <li>Start scanning stores for profitable flips.</li>
        </ol>
      </td></tr>
      <tr><td style="padding:20px 32px 30px">
        <p style="font-size:13px;color:#5a7385;margin:0;border-top:1px solid #13283a;padding-top:16px">Need help? Just reply to this email or reach us at <a href="mailto:${REPLY_TO}" style="color:#00ff88">${REPLY_TO}</a>.</p>
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyWhopSignature(rawBody, req.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const action = event?.action || event?.event;
  // Email the key when a membership becomes active. Whop fires "membership.went_valid"
  // on checkout and (for some products) "membership.activated" — accept either so the
  // email sends regardless of which event the webhook is subscribed to. Dots are
  // normalized to underscores to be tolerant of formatting.
  // NOTE: went_valid can re-fire on renewals; if duplicate emails become a problem,
  // add a KV dedupe on the membership id.
  const TRIGGER_EVENTS = new Set(["membership_went_valid", "membership_activated"]);
  const normalized = String(action ?? "").replace(/\./g, "_");
  if (!TRIGGER_EVENTS.has(normalized)) {
    return NextResponse.json({ ok: true, ignored: action ?? "unknown" });
  }

  const data = event?.data ?? {};
  const key: string | undefined = data?.id;
  const email = await resolveEmail(data);

  if (!key || !email) {
    console.error("[whop-webhook] missing key or email", { key, hasEmail: !!email });
    // 200 so Whop doesn't retry — there is nothing a retry would fix.
    return NextResponse.json({ ok: true, skipped: "missing key or email" });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[whop-webhook] RESEND_API_KEY not set");
    return NextResponse.json({ error: "Email not configured" }, { status: 500 });
  }

  try {
    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      replyTo: REPLY_TO,
      subject: "Your FlipSonar license key 🛰️",
      html: emailHtml(key),
    });
    if (error) {
      console.error("[whop-webhook] resend error", error);
      return NextResponse.json({ error: "Send failed" }, { status: 502 });
    }
  } catch (e: any) {
    console.error("[whop-webhook] send threw", e?.message);
    return NextResponse.json({ error: "Send failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sent: email });
}
