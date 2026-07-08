"use client";
import { useState } from "react";

// ─── FlipSonar green/navy theme (matches the marketing site) ──────────────────
const BG = "#07111a", SURFACE = "#0d1e2b", BORDER = "#1a3a2e", MUTED = "#5a8a78";
const GREEN = "#00ff88", DIM = "#1a4a38", FG = "#e8f4f0";
const AMBER = "#ffb020", RED = "#ff6b6b";

type Outcome = "ok" | "empty" | "failed";
interface Comps { found: boolean; count: number; median: number; low: number; high: number; avgSoldPerMonth: number; }
interface Score { score: number; estimatedProfit: number; roi: number; netRevenue: number; grade: string; reason: string; }
interface Part {
  id: string; label: string; category: string; ship: string; note?: string;
  query: string; cost: number; comps: Comps; score: Score; outcome: Outcome;
}
interface ScanResp {
  vehicle: { label: string; year: string; make: string; model: string; trim?: string; engine?: string; bodyClass?: string };
  parts: Part[]; keysExhausted: boolean; error?: string;
}

function ebayUrl(query: string) {
  const qs = new URLSearchParams({ _nkw: query, LH_Complete: "1", LH_Sold: "1", _sop: "13" });
  return `https://www.ebay.com/sch/i.html?${qs}`;
}

function verdict(p: Part): { label: string; color: string; bg: string } {
  if (p.outcome === "failed") return { label: "RE-CHECK", color: AMBER, bg: "#231a05" };
  if (p.outcome === "empty" || !p.comps.found) return { label: "NO MARKET", color: MUTED, bg: "#0d1e2b" };
  if (p.score.score >= 55) return { label: "PULL", color: GREEN, bg: DIM };
  if (p.score.score >= 40) return { label: "MAYBE", color: AMBER, bg: "#231a05" };
  return { label: "SKIP", color: RED, bg: "#230d0d" };
}

const money = (n: number) => "$" + (n >= 100 ? Math.round(n) : n.toFixed(0));
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default function VehiclePage() {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [resp, setResp] = useState<ScanResp | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState<Set<string>>(new Set());

  async function decode() {
    if (!vin.trim()) return;
    setDecoding(true); setError("");
    try {
      const r = await fetch("/api/vin?vin=" + encodeURIComponent(vin.trim()));
      const d = await r.json();
      if (d.error) setError(d.error);
      else { setYear(d.year || ""); setMake(d.make || ""); setModel(d.model || ""); }
    } catch { setError("VIN lookup failed — check your connection."); }
    setDecoding(false);
  }

  async function scan() {
    setError(""); setResp(null); setExpanded(null);
    if (!year || !make || !model) { setError("Enter year, make and model (or decode a VIN)."); return; }
    setScanning(true);
    try {
      const body: any = { year, make, model };
      if (vin.trim()) body.vin = vin.trim();
      if (avgCost.trim()) body.avgCost = parseFloat(avgCost);
      const r = await fetch("/api/vehicle-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d: ScanResp = await r.json();
      if (d.error) setError(d.error); else setResp(d);
    } catch { setError("Scan failed — check your connection and try again."); }
    setScanning(false);
  }

  async function recheck(part: Part) {
    if (!resp) return;
    setRechecking(s => new Set(s).add(part.id));
    try {
      const body: any = { year: resp.vehicle.year, make: resp.vehicle.make, model: resp.vehicle.model, only: [part.id] };
      if (avgCost.trim()) body.avgCost = parseFloat(avgCost);
      const r = await fetch("/api/vehicle-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d: ScanResp = await r.json();
      const fresh = d.parts?.[0];
      if (fresh) {
        setResp(prev => prev ? {
          ...prev,
          parts: [...prev.parts.map(p => p.id === fresh.id ? fresh : p)].sort((a, b) => b.score.score - a.score.score),
        } : prev);
      }
    } catch {}
    setRechecking(s => { const n = new Set(s); n.delete(part.id); return n; });
  }

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    window.location.href = "/login";
  }

  const pullList = resp?.parts.filter(p => p.outcome === "ok" && p.score.score >= 55) ?? [];
  const totalUpside = pullList.reduce((s, p) => s + Math.max(0, p.score.netRevenue), 0);

  return (
    <div style={{ minHeight: "100vh", background: BG, color: FG, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "radial-gradient(ellipse at 20% 0%, #0a2a1a20 0%, transparent 55%)" }} />

      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, background: "#07111aee", backdropFilter: "blur(12px)", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: "linear-gradient(135deg, #003a20, #006640)", border: `1px solid ${GREEN}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: `0 0 12px ${GREEN}30` }}>📡</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: GREEN, letterSpacing: "-0.02em" }}>FlipSonar Yard</div>
            <div style={{ fontSize: 10, color: MUTED }}>Which parts on this car are worth pulling?</div>
          </div>
        </div>
        <button onClick={logout} style={{ fontSize: 12, color: MUTED, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "6px 10px" }}>Log out</button>
      </div>

      {/* Vehicle input */}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="Paste VIN (optional)" style={inp} inputMode="text" autoCapitalize="characters" spellCheck={false} />
          <button onClick={decode} disabled={decoding || !vin.trim()} style={{ ...btnSecondary, opacity: (decoding || !vin.trim()) ? 0.5 : 1, whiteSpace: "nowrap" }}>{decoding ? "…" : "Decode"}</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={year} onChange={e => setYear(e.target.value)} placeholder="Year" style={{ ...inp, flex: "0 0 76px" }} inputMode="numeric" />
          <input value={make} onChange={e => setMake(e.target.value)} placeholder="Make" style={{ ...inp, flex: 1 }} />
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="Model" style={{ ...inp, flex: 1 }} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={avgCost} onChange={e => setAvgCost(e.target.value)} placeholder="Avg pull $ (optional)" style={{ ...inp, flex: 1 }} inputMode="decimal" />
          <button onClick={scan} disabled={scanning} style={{ ...btnPrimary, minWidth: 132, opacity: scanning ? 0.6 : 1 }}>{scanning ? "Scanning…" : "Scan vehicle"}</button>
        </div>
        {error && <div style={{ color: RED, fontSize: 13, background: "#230d0d", border: `1px solid ${RED}44`, borderRadius: 8, padding: "8px 12px" }}>{error}</div>}
      </div>

      {scanning && !resp && (
        <div style={{ padding: "0 16px 16px", color: MUTED, fontSize: 13, position: "relative", zIndex: 1 }}>Checking eBay sold comps for ~30 parts… this takes ~20–40s.</div>
      )}

      {/* Results */}
      {resp && (
        <div style={{ padding: "0 16px 44px", position: "relative", zIndex: 1 }}>
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{resp.vehicle.label}</div>
            {resp.vehicle.engine && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{resp.vehicle.engine}{resp.vehicle.bodyClass ? ` · ${resp.vehicle.bodyClass}` : ""}</div>}
            <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, fontFamily: MONO }}>{pullList.length}</div>
                <div style={{ fontSize: 11, color: MUTED }}>parts to pull</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: FG, fontFamily: MONO }}>{money(totalUpside)}</div>
                <div style={{ fontSize: 11, color: MUTED }}>est. net upside</div>
              </div>
            </div>
            {resp.keysExhausted && <div style={{ marginTop: 10, fontSize: 12, color: AMBER }}>⚠ Comp source ran low on credits — some parts may be incomplete.</div>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {resp.parts.map(p => {
              const v = verdict(p);
              const isOpen = expanded === p.id;
              const busy = rechecking.has(p.id);
              return (
                <div key={p.id} style={{ background: SURFACE, border: `1px solid ${isOpen ? GREEN + "40" : BORDER}`, borderRadius: 12, overflow: "hidden" }}>
                  <button onClick={() => setExpanded(isOpen ? null : p.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "transparent", border: "none", color: FG, textAlign: "left" }}>
                    <div style={{ flex: "0 0 76px", fontSize: 12, fontWeight: 800, color: v.color, background: v.bg, border: `1px solid ${v.color}44`, borderRadius: 8, padding: "6px 0", textAlign: "center", letterSpacing: "0.03em" }}>{busy ? "…" : v.label}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</div>
                      <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                        {p.outcome === "ok" && p.comps.found
                          ? `${p.comps.count} sold · ${(p.score.roi * 100).toFixed(0)}% ROI · ~${p.comps.avgSoldPerMonth}/mo`
                          : p.outcome === "failed" ? "couldn’t read — tap RE-CHECK" : "no eBay sales matched"}
                      </div>
                    </div>
                    <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: MONO, color: p.comps.found ? FG : MUTED }}>{p.comps.found ? money(p.comps.median) : "—"}</div>
                      <div style={{ fontSize: 10, color: MUTED }}>{p.comps.found ? "sold median" : ""}</div>
                    </div>
                  </button>

                  {isOpen && (
                    <div style={{ padding: "12px 14px 14px", fontSize: 13, color: "#9fc4b5", borderTop: `1px solid ${BORDER}` }}>
                      {p.comps.found ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                          <Detail k="Sold range" v={`${money(p.comps.low)} – ${money(p.comps.high)}`} />
                          <Detail k="Net after fees" v={money(p.score.netRevenue)} />
                          <Detail k="Est. pull cost" v={money(p.cost)} />
                          <Detail k="Est. profit" v={money(p.score.estimatedProfit)} />
                        </div>
                      ) : (
                        <div style={{ marginBottom: 8 }}>{p.outcome === "failed" ? "The comp source didn’t return a clean page for this part. Re-check to try again." : "No matching sold listings for this exact vehicle."}</div>
                      )}
                      {p.note && <div style={{ marginTop: 10, color: AMBER, fontSize: 12 }}>ℹ {p.note}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        <a href={ebayUrl(p.query)} target="_blank" rel="noreferrer" style={{ ...pill, color: GREEN, borderColor: `${GREEN}55` }}>View sold on eBay ↗</a>
                        <button onClick={() => recheck(p)} disabled={busy} style={{ ...pill, color: AMBER, borderColor: `${AMBER}55`, background: "transparent", opacity: busy ? 0.5 : 1 }}>{busy ? "Re-checking…" : "Re-check"}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: MUTED }}>{k}</div>
      <div style={{ fontSize: 14, color: FG, fontWeight: 600, fontFamily: MONO }}>{v}</div>
    </div>
  );
}

const inp: React.CSSProperties = { background: "#081820", border: `1px solid ${BORDER}`, borderRadius: 10, color: FG, padding: "12px 12px", fontSize: 16, outline: "none", minWidth: 0, width: "100%" };
const btnPrimary: React.CSSProperties = { background: DIM, color: GREEN, border: `1px solid ${GREEN}55`, borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 800, boxShadow: `0 0 16px ${GREEN}20`, flex: "0 0 auto" };
const btnSecondary: React.CSSProperties = { background: SURFACE, color: FG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px", fontSize: 14, fontWeight: 600 };
const pill: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 999, border: `1px solid ${BORDER}`, background: "transparent", display: "inline-block" };
