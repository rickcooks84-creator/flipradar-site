"use client";
import { useState, useMemo } from "react";

// ─── FlipSonar green/navy theme (matches the marketing site) ──────────────────
const BG = "#07111a", SURFACE = "#0d1e2b", BORDER = "#1a3a2e", MUTED = "#5a8a78";
const GREEN = "#00ff88", DIM = "#1a4a38", FG = "#e8f4f0";
const AMBER = "#ffb020", RED = "#ff6b6b";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

type Outcome = "ok" | "empty" | "failed";
interface Comps { found: boolean; count: number; median: number; low: number; high: number; avgSoldPerMonth: number; }
interface Score { score: number; estimatedProfit: number; roi: number; netRevenue: number; grade: string; reason: string; }
interface PartResult {
  id: string; label: string; category: string; ship: string; note?: string;
  query: string; cost: number; comps: Comps; score: Score; outcome: Outcome;
}
interface Vehicle { label: string; year: string; make: string; model: string; trim?: string; engine?: string; bodyClass?: string; }
type RowStatus = "pending" | "busy" | "done";
interface Row { id: string; label: string; category: string; ship: string; note?: string; status: RowStatus; result?: PartResult; }

function ebayUrl(query: string) {
  const qs = new URLSearchParams({ _nkw: query, LH_Complete: "1", LH_Sold: "1", _sop: "13" });
  return `https://www.ebay.com/sch/i.html?${qs}`;
}

function verdict(r: Row): { label: string; color: string; bg: string } {
  if (r.status !== "done" || !r.result) return { label: "…", color: MUTED, bg: "#0d1e2b" };
  const p = r.result;
  if (p.outcome === "failed") return { label: "RE-CHECK", color: AMBER, bg: "#231a05" };
  if (p.outcome === "empty" || !p.comps.found) return { label: "NO MARKET", color: MUTED, bg: "#0d1e2b" };
  if (p.score.score >= 55) return { label: "PULL", color: GREEN, bg: DIM };
  if (p.score.score >= 40) return { label: "MAYBE", color: AMBER, bg: "#231a05" };
  return { label: "SKIP", color: RED, bg: "#230d0d" };
}

const money = (n: number) => "$" + (n >= 100 ? Math.round(n) : n.toFixed(0));

// Simple client-side concurrency pool.
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await worker(item); }
  }));
}

export default function VehiclePage() {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [keysExhausted, setKeysExhausted] = useState(false);

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

  // Fetch comps for one part and patch its row in place.
  async function scanOne(v: Vehicle, id: string) {
    setRows(prev => prev.map(row => row.id === id ? { ...row, status: "busy" } : row));
    try {
      const body: any = { year: v.year, make: v.make, model: v.model, only: [id] };
      if (avgCost.trim()) body.avgCost = parseFloat(avgCost);
      const r = await fetch("/api/vehicle-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.keysExhausted) setKeysExhausted(true);
      const res: PartResult | undefined = d.parts?.[0];
      setRows(prev => prev.map(row => row.id === id ? { ...row, status: "done", result: res } : row));
    } catch {
      setRows(prev => prev.map(row => row.id === id
        ? { ...row, status: "done", result: row.result ?? failedResult(row) }
        : row));
    }
  }

  async function scan() {
    setError(""); setVehicle(null); setRows([]); setExpanded(null); setKeysExhausted(false);
    if (!year || !make || !model) { setError("Enter year, make and model (or decode a VIN)."); return; }
    setScanning(true);
    try {
      // 1) get the vehicle + applicable parts list (fast, no comps)
      const pr = await fetch("/api/vehicle-parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year, make, model, vin: vin.trim() || undefined }) });
      const pd = await pr.json();
      if (pd.error) { setError(pd.error); setScanning(false); return; }
      const v: Vehicle = pd.vehicle;
      const initial: Row[] = pd.parts.map((p: any) => ({ ...p, status: "pending" as RowStatus }));
      setVehicle(v);
      setRows(initial);

      // 2) fetch comps one part at a time (progressive), 6 in flight
      await runPool(initial.map(r => r.id), 6, (id) => scanOne(v, id));

      // 3) once everything's in, rank most-worth-pulling first
      setRows(prev => [...prev].sort((a, b) => (b.result?.score.score ?? -1) - (a.result?.score.score ?? -1)));
    } catch {
      setError("Scan failed — check your connection and try again.");
    }
    setScanning(false);
  }

  async function recheck(v: Vehicle, id: string) {
    await scanOne(v, id);
  }

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    window.location.href = "/login";
  }

  const done = rows.filter(r => r.status === "done").length;
  const pullRows = rows.filter(r => r.result?.outcome === "ok" && r.result.score.score >= 55);
  const totalUpside = pullRows.reduce((s, r) => s + Math.max(0, r.result!.score.netRevenue), 0);
  const scanProgress = useMemo(() => rows.length ? Math.round((done / rows.length) * 100) : 0, [done, rows.length]);

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

      {/* Results */}
      {vehicle && (
        <div style={{ padding: "0 16px 44px", position: "relative", zIndex: 1 }}>
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{vehicle.label}</div>
            {vehicle.engine && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{vehicle.engine}{vehicle.bodyClass ? ` · ${vehicle.bodyClass}` : ""}</div>}
            <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, fontFamily: MONO }}>{pullRows.length}</div>
                <div style={{ fontSize: 11, color: MUTED }}>parts to pull</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: FG, fontFamily: MONO }}>{money(totalUpside)}</div>
                <div style={{ fontSize: 11, color: MUTED }}>est. net upside</div>
              </div>
            </div>
            {/* progress */}
            {scanning && (
              <div style={{ marginTop: 12 }}>
                <div style={{ height: 4, background: "#0a1a12", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${scanProgress}%`, background: GREEN, transition: "width .3s", boxShadow: `0 0 8px ${GREEN}` }} />
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>Checking eBay comps… {done}/{rows.length}</div>
              </div>
            )}
            {keysExhausted && <div style={{ marginTop: 10, fontSize: 12, color: AMBER }}>⚠ Comp source ran low on credits — some parts may be incomplete.</div>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map(r => {
              const v = verdict(r);
              const isOpen = expanded === r.id;
              const p = r.result;
              const pending = r.status !== "done";
              return (
                <div key={r.id} style={{ background: SURFACE, border: `1px solid ${isOpen ? GREEN + "40" : BORDER}`, borderRadius: 12, overflow: "hidden", opacity: pending ? 0.7 : 1 }}>
                  <button onClick={() => !pending && setExpanded(isOpen ? null : r.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "transparent", border: "none", color: FG, textAlign: "left" }}>
                    <div style={{ flex: "0 0 76px", fontSize: 12, fontWeight: 800, color: v.color, background: v.bg, border: `1px solid ${v.color}44`, borderRadius: 8, padding: "6px 0", textAlign: "center", letterSpacing: "0.03em" }}>
                      {pending ? <Spinner /> : v.label}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</div>
                      <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                        {pending ? "checking…" :
                          p?.outcome === "ok" && p.comps.found
                            ? `${p.comps.count} sold · ${(p.score.roi * 100).toFixed(0)}% ROI · ~${p.comps.avgSoldPerMonth}/mo`
                            : p?.outcome === "failed" ? "couldn’t read — tap RE-CHECK" : "no eBay sales matched"}
                      </div>
                    </div>
                    <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: MONO, color: p?.comps.found ? FG : MUTED }}>{p?.comps.found ? money(p.comps.median) : "—"}</div>
                      <div style={{ fontSize: 10, color: MUTED }}>{p?.comps.found ? "sold median" : ""}</div>
                    </div>
                  </button>

                  {isOpen && p && (
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
                        <button onClick={() => vehicle && recheck(vehicle, r.id)} disabled={r.status === "busy"} style={{ ...pill, color: AMBER, borderColor: `${AMBER}55`, background: "transparent", opacity: r.status === "busy" ? 0.5 : 1 }}>{r.status === "busy" ? "Re-checking…" : "Re-check"}</button>
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

function Spinner() {
  return <span style={{ display: "inline-block", width: 11, height: 11, border: `2px solid ${MUTED}55`, borderTopColor: GREEN, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />;
}

function failedResult(row: Row): PartResult {
  return {
    id: row.id, label: row.label, category: row.category, ship: row.ship, note: row.note,
    query: "", cost: 0,
    comps: { found: false, count: 0, median: 0, low: 0, high: 0, avgSoldPerMonth: 0 },
    score: { score: 1, estimatedProfit: 0, roi: 0, netRevenue: 0, grade: "F", reason: "" },
    outcome: "failed",
  };
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
