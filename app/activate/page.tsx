"use client";
import { useState } from "react";
import Link from "next/link";

const BG      = "#07111a";
const SURFACE = "#0d1e2b";
const BORDER  = "#1a3a2e";
const MUTED   = "#5a8a78";
const GREEN   = "#00ff88";
const DIM     = "#1a4a38";

export default function Activate() {
  const [key, setKey]       = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg]       = useState("");

  async function handleActivate() {
    if (!key.trim()) return;
    setStatus("loading");
    setMsg("");
    try {
      const res  = await fetch("/api/validate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setStatus("ok");
        setMsg("License verified! Download the app below.");
      } else {
        setStatus("err");
        setMsg(data.error || "Invalid license key. Check your Whop email and try again.");
      }
    } catch {
      setStatus("err");
      setMsg("Network error — please try again.");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column" }}>

      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "radial-gradient(ellipse at 20% 50%, #0a2a1a18 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #0a1a2a18 0%, transparent 60%)" }} />

      {/* Nav */}
      <nav style={{ borderBottom: `1px solid ${BORDER}`, padding: "0 32px", height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#07111add", backdropFilter: "blur(12px)", zIndex: 50 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "7px", background: "linear-gradient(135deg, #003a20, #006640)", border: `1px solid ${GREEN}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", boxShadow: `0 0 12px ${GREEN}30` }}>📡</div>
          <span style={{ fontWeight: 800, fontSize: "15px", letterSpacing: "-0.03em", color: GREEN }}>FlipSonar</span>
        </Link>
        <a href="https://whop.com/checkout/plan_k2FTmWkCEj04H" target="_blank" rel="noopener noreferrer" style={{ fontSize: "13px", fontWeight: 600, padding: "8px 18px", background: DIM, border: `1px solid ${GREEN}50`, borderRadius: "7px", color: GREEN, boxShadow: `0 0 12px ${GREEN}20` }}>
          Buy Now →
        </a>
      </nav>

      {/* Main */}
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px", position: "relative", zIndex: 1 }}>
        <div style={{ width: "100%", maxWidth: "480px" }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <div style={{ width: "56px", height: "56px", borderRadius: "14px", background: "linear-gradient(135deg, #003a20, #006640)", border: `1px solid ${GREEN}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", margin: "0 auto 20px", boxShadow: `0 0 24px ${GREEN}30` }}>📡</div>
            <h1 style={{ fontSize: "28px", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: "8px", color: "#e8f4f0" }}>Activate FlipSonar</h1>
            <p style={{ color: MUTED, fontSize: "14px", lineHeight: 1.6 }}>
              Enter your license key to verify your purchase and download the app.
            </p>
          </div>

          {/* Card */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "16px", padding: "32px" }}>

            {/* Key input */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "8px" }}>
                License Key
              </label>
              <input
                type="text"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={key}
                onChange={e => setKey(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleActivate()}
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  background: BG,
                  border: `1px solid ${status === "err" ? "#f87171" : status === "ok" ? GREEN : BORDER}`,
                  borderRadius: "8px",
                  color: "#fafafa",
                  fontSize: "14px",
                  outline: "none",
                  fontFamily: "monospace",
                  letterSpacing: "0.05em",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Status message */}
            {msg && (
              <div style={{
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                marginBottom: "16px",
                background: status === "ok" ? "#0a2a1a" : "#450a0a33",
                border: `1px solid ${status === "ok" ? GREEN + "55" : "#b91c1c55"}`,
                color: status === "ok" ? GREEN : "#f87171",
              }}>
                {msg}
              </div>
            )}

            {/* Verify button */}
            {status !== "ok" && (
              <button
                onClick={handleActivate}
                disabled={status === "loading" || !key.trim()}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: status === "loading" || !key.trim() ? DIM : DIM,
                  color: status === "loading" || !key.trim() ? MUTED : GREEN,
                  border: `1px solid ${status === "loading" || !key.trim() ? BORDER : GREEN + "50"}`,
                  borderRadius: "9px",
                  fontWeight: 700,
                  fontSize: "15px",
                  cursor: status === "loading" || !key.trim() ? "not-allowed" : "pointer",
                  marginBottom: "20px",
                  boxShadow: status === "loading" || !key.trim() ? "none" : `0 0 20px ${GREEN}20`,
                  fontFamily: "inherit",
                }}
              >
                {status === "loading" ? "Verifying…" : "Verify License"}
              </button>
            )}

            {/* Download button (shown after verification) */}
            {status === "ok" && (
              <a
                href="https://github.com/rickcooks84-creator/flipsonar-releases/releases/download/v1.0.0/FlipSonar.exe"
                download
                style={{
                  display: "block",
                  width: "100%",
                  padding: "12px",
                  background: DIM,
                  color: GREEN,
                  border: `1px solid ${GREEN}50`,
                  borderRadius: "9px",
                  fontWeight: 700,
                  fontSize: "15px",
                  textAlign: "center",
                  marginBottom: "20px",
                  boxShadow: `0 0 20px ${GREEN}20`,
                  textDecoration: "none",
                }}
              >
                ⬇ Download FlipSonar for Windows
              </a>
            )}

            {/* Divider */}
            <div style={{ borderTop: `1px solid ${BORDER}`, marginBottom: "20px" }} />

            {/* Setup steps */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "14px" }}>Setup Instructions</div>
              {[
                "Download and run the installer above",
                "Launch FlipSonar — it opens to the activation screen",
                "Paste your license key and click Activate",
                "Start scanning stores and finding flips",
              ].map((step, i) => (
                <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", marginBottom: "10px" }}>
                  <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: DIM, border: `1px solid ${GREEN}50`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "11px", flexShrink: 0, marginTop: "1px", color: GREEN, boxShadow: `0 0 8px ${GREEN}20` }}>{i + 1}</div>
                  <span style={{ fontSize: "13px", color: MUTED, lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </div>

            {/* Purchase link */}
            <div style={{ textAlign: "center", paddingTop: "4px" }}>
              <span style={{ fontSize: "13px", color: MUTED }}>Don't have a key?{" "}</span>
              <a href="https://whop.com/checkout/plan_k2FTmWkCEj04H" target="_blank" rel="noopener noreferrer" style={{ fontSize: "13px", color: GREEN, fontWeight: 600 }}>
                Purchase on Whop →
              </a>
            </div>
          </div>

          {/* Support */}
          <p style={{ textAlign: "center", fontSize: "12px", color: MUTED, marginTop: "24px" }}>
            Need help?{" "}
            <a href="mailto:support@flipsonar.io" style={{ color: MUTED, textDecoration: "underline" }}>
              Contact support
            </a>
          </p>

        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>📡</span>
          <span style={{ fontWeight: 700, fontSize: "13px", color: GREEN }}>FlipSonar</span>
        </div>
        <div style={{ fontSize: "12px", color: MUTED }}>© {new Date().getFullYear()} FlipSonar. All rights reserved.</div>
        <Link href="/" style={{ fontSize: "13px", color: MUTED }}>← Back to home</Link>
      </footer>

    </div>
  );
}
