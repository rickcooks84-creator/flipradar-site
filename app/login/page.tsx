"use client";
import { useState } from "react";

const BG = "#07111a", SURFACE = "#0d1e2b", BORDER = "#1a3a2e", MUTED = "#5a8a78";
const GREEN = "#00ff88", DIM = "#1a4a38", FG = "#e8f4f0", RED = "#ff6b6b";

export default function LoginPage() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    if (!key.trim()) { setError("Enter your license key."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const d = await r.json();
      if (d.success) window.location.href = "/vehicle";
      else setError(d.error || "Login failed.");
    } catch {
      setError("Couldn’t reach the server. Check your connection.");
    }
    setBusy(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, color: FG, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "radial-gradient(ellipse at 20% 50%, #0a2a1a18 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #0a1a2a18 0%, transparent 60%)" }} />
      <div style={{ width: "100%", maxWidth: 380, position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: 11, background: "linear-gradient(135deg, #003a20, #006640)", border: `1px solid ${GREEN}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: `0 0 18px ${GREEN}30` }}>📡</div>
          <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: "-0.03em", marginTop: 12, color: GREEN }}>FlipSonar Yard</div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
            Log in with your license key to scan junkyard cars for flippable parts.
          </div>
        </div>

        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 }}>
          <label style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>License key</label>
          <input
            value={key}
            onChange={e => setKey(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") login(); }}
            placeholder="mem_XXXXXXXXXXXXXX"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            style={{ width: "100%", marginTop: 6, background: "#081820", border: `1px solid ${BORDER}`, borderRadius: 10, color: FG, padding: "13px 12px", fontSize: 16, outline: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
          />

          {error && (
            <div style={{ color: RED, fontSize: 13, background: "#2a0e0e", border: `1px solid ${RED}44`, borderRadius: 8, padding: "8px 12px", marginTop: 12 }}>{error}</div>
          )}

          <button
            onClick={login}
            disabled={busy}
            style={{ width: "100%", marginTop: 14, background: DIM, color: GREEN, border: `1px solid ${GREEN}55`, borderRadius: 10, padding: "13px 16px", fontSize: 16, fontWeight: 800, boxShadow: `0 0 20px ${GREEN}20`, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Checking…" : "Log in →"}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
          Your key is the <code style={{ color: FG }}>mem_…</code> id from your FlipSonar welcome email.<br />
          Don’t have one? <a href="https://whop.com/flipsonar/flipsonar-monthly/" target="_blank" rel="noreferrer" style={{ color: GREEN }}>Get FlipSonar →</a>
        </div>
      </div>
    </div>
  );
}
