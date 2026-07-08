"use client";
import { useState } from "react";

// ─── FlipSonar green/navy theme ───────────────────────────────────────────────
const BG = "#07111a", SURFACE = "#0d1e2b", BORDER = "#1a3a2e", MUTED = "#5a8a78";
const GREEN = "#00ff88", DIM = "#1a4a38", FG = "#e8f4f0";
const AMBER = "#ffb020", RED = "#ff6b6b";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

type Outcome = "ok" | "empty" | "failed";
type Mode = "store" | "vehicle";
interface Comps { found: boolean; count: number; median: number; low: number; high: number; avgSoldPerMonth: number; }
interface Score { score: number; estimatedProfit: number; roi: number; netRevenue: number; grade: string; reason: string; }
interface Result { comps: Comps; score: Score | null; outcome: Outcome; query: string; cost: number; note?: string; }
interface Row {
  id: string; label: string; sub?: string; imageUrl?: string; productUrl?: string;
  query: string; cost: number; status: "pending" | "busy" | "done"; result?: Result;
}
interface Vehicle { label: string; year: string; make: string; model: string; engine?: string; bodyClass?: string; }

const money = (n: number) => "$" + (n >= 100 ? Math.round(n) : n.toFixed(0));
function ebayUrl(q: string) {
  const qs = new URLSearchParams({ _nkw: q, LH_Complete: "1", LH_Sold: "1", _sop: "13" });
  return `https://www.ebay.com/sch/i.html?${qs}`;
}
function verdict(row: Row, buyWord: string): { label: string; color: string; bg: string } | null {
  if (row.status !== "done" || !row.result) return null;
  const r = row.result;
  if (r.outcome === "failed") return { label: "RE-CHECK", color: AMBER, bg: "#231a05" };
  if (r.outcome === "empty" || !r.comps.found) return { label: "NO MARKET", color: MUTED, bg: "#0d1e2b" };
  if (!r.score) return { label: "COMPS", color: GREEN, bg: DIM };
  const s = r.score.score;
  if (s >= 55) return { label: buyWord, color: GREEN, bg: DIM };
  if (s >= 40) return { label: "MAYBE", color: AMBER, bg: "#231a05" };
  return { label: "SKIP", color: RED, bg: "#230d0d" };
}
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; await worker(it); }
  }));
}

export default function ScanPage() {
  const [mode, setMode] = useState<Mode>("store");

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    window.location.href = "/login";
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, color: FG, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "radial-gradient(ellipse at 20% 0%, #0a2a1a20 0%, transparent 55%)" }} />

      {/* Header — no "Yard" wording */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, background: "#07111aee", backdropFilter: "blur(12px)", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: "linear-gradient(135deg, #003a20, #006640)", border: `1px solid ${GREEN}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: `0 0 12px ${GREEN}30` }}>📡</div>
          <span style={{ fontWeight: 800, fontSize: 16, color: GREEN, letterSpacing: "-0.02em" }}>FlipSonar</span>
        </div>
        <button onClick={logout} style={{ fontSize: 12, color: MUTED, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "6px 10px" }}>Log out</button>
      </div>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 6, padding: "12px 16px 0", position: "relative", zIndex: 1 }}>
        <Tab active={mode === "store"} onClick={() => setMode("store")} icon="🛒" label="Store Arbitrage" />
        <Tab active={mode === "vehicle"} onClick={() => setMode("vehicle")} icon="🚗" label="Vehicle Parts" />
      </div>

      {mode === "store" ? <StorePanel /> : <VehiclePanel />}
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "11px 8px", borderRadius: 10, fontSize: 14, fontWeight: 700,
      background: active ? DIM : "transparent", color: active ? GREEN : MUTED,
      border: `1px solid ${active ? GREEN + "55" : BORDER}`, boxShadow: active ? `0 0 14px ${GREEN}18` : "none",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
    }}>
      <span>{icon}</span>{label}
    </button>
  );
}

// ─── STORE ARBITRAGE (paste a URL → comps + buy score) ────────────────────────
function StorePanel() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  async function scanOne(row: Row) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: "busy" } : r));
    try {
      const res = await fetch("/api/comp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: row.query, cost: row.cost }) });
      const d = await res.json();
      if (d.keysExhausted) setExhausted(true);
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: "done", result: { comps: d.comps, score: d.score, outcome: d.outcome, query: row.query, cost: row.cost } } : r));
    } catch {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: "done", result: { comps: emptyComps(), score: null, outcome: "failed", query: row.query, cost: row.cost } } : r));
    }
  }

  async function scan() {
    setError(""); setNote(""); setRows([]); setExpanded(null); setExhausted(false);
    if (!/^https?:\/\//i.test(url.trim())) { setError("Enter a full store URL starting with https://"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/store-scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
      const d = await r.json();
      if (d.error) { setError(d.error); setBusy(false); return; }
      if (d.capped) setNote(`Showing the first ${d.products.length} of ${d.total} products.`);
      const initial: Row[] = d.products.map((p: any) => ({
        id: p.id, label: p.name, sub: p.price ? money(p.price) : "no price", imageUrl: p.imageUrl, productUrl: p.productUrl,
        query: p.ebayQuery, cost: p.price ?? 0, status: "pending" as const,
      }));
      setRows(initial);
      await runPool(initial, 6, scanOne);
      setRows(prev => [...prev].sort((a, b) => (b.result?.score?.score ?? -1) - (a.result?.score?.score ?? -1)));
    } catch { setError("Scan failed — check the URL and your connection."); }
    setBusy(false);
  }

  const done = rows.filter(r => r.status === "done").length;
  const buys = rows.filter(r => r.result?.outcome === "ok" && (r.result.score?.score ?? 0) >= 55);
  const upside = buys.reduce((s, r) => s + Math.max(0, r.result!.score!.estimatedProfit), 0);

  return (
    <div style={{ padding: 16, position: "relative", zIndex: 1 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter") scan(); }} placeholder="Paste a store or collection URL" style={inp} inputMode="url" autoCapitalize="none" spellCheck={false} />
        <button onClick={scan} disabled={busy} style={{ ...btnPrimary, minWidth: 96, opacity: busy ? 0.6 : 1 }}>{busy ? "…" : "Scan"}</button>
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>Works best on Shopify stores. Point at a collection/category page, not the homepage.</div>
      {error && <div style={errBox}>{error}</div>}

      {rows.length > 0 && (
        <>
          <SummaryCard title="Store scan" done={done} total={rows.length} busy={busy} exhausted={exhausted}
            stat1={{ n: String(buys.length), label: "to buy", color: GREEN }} stat2={{ n: money(upside), label: "est. profit", color: FG }} note={note} />
          <RowList rows={rows} buyWord="BUY" showImage expanded={expanded} setExpanded={setExpanded}
            onRecheck={(row) => scanOne(row)} />
        </>
      )}
    </div>
  );
}

// ─── VEHICLE PARTS (year/make/model or VIN → PULL/SKIP parts) ──────────────────
function VehiclePanel() {
  const [year, setYear] = useState(""), [make, setMake] = useState(""), [model, setModel] = useState("");
  const [vin, setVin] = useState(""), [avgCost, setAvgCost] = useState("");
  const [decoding, setDecoding] = useState(false), [busy, setBusy] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState(""), [expanded, setExpanded] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  async function decode() {
    if (!vin.trim()) return;
    setDecoding(true); setError("");
    try {
      const r = await fetch("/api/vin?vin=" + encodeURIComponent(vin.trim()));
      const d = await r.json();
      if (d.error) setError(d.error); else { setYear(d.year || ""); setMake(d.make || ""); setModel(d.model || ""); }
    } catch { setError("VIN lookup failed — check your connection."); }
    setDecoding(false);
  }

  async function scanOne(v: Vehicle, id: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status: "busy" } : r));
    try {
      const body: any = { year: v.year, make: v.make, model: v.model, only: [id] };
      if (avgCost.trim()) body.avgCost = parseFloat(avgCost);
      const r = await fetch("/api/vehicle-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.keysExhausted) setExhausted(true);
      const p = d.parts?.[0];
      setRows(prev => prev.map(row => row.id === id ? {
        ...row, status: "done",
        result: p ? { comps: p.comps, score: p.score, outcome: p.outcome, query: p.query, cost: p.cost, note: p.note } : { comps: emptyComps(), score: null, outcome: "failed", query: "", cost: 0 },
      } : row));
    } catch {
      setRows(prev => prev.map(row => row.id === id ? { ...row, status: "done", result: { comps: emptyComps(), score: null, outcome: "failed", query: "", cost: 0 } } : row));
    }
  }

  async function scan() {
    setError(""); setVehicle(null); setRows([]); setExpanded(null); setExhausted(false);
    if (!year || !make || !model) { setError("Enter year, make and model (or decode a VIN)."); return; }
    setBusy(true);
    try {
      const pr = await fetch("/api/vehicle-parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year, make, model, vin: vin.trim() || undefined }) });
      const pd = await pr.json();
      if (pd.error) { setError(pd.error); setBusy(false); return; }
      const v: Vehicle = pd.vehicle;
      const initial: Row[] = pd.parts.map((p: any) => ({ id: p.id, label: p.label, sub: p.category, query: "", cost: 0, status: "pending" as const }));
      setVehicle(v); setRows(initial);
      await runPool(initial.map(r => r.id), 6, (id) => scanOne(v, id));
      setRows(prev => [...prev].sort((a, b) => (b.result?.score?.score ?? -1) - (a.result?.score?.score ?? -1)));
    } catch { setError("Scan failed — check your connection and try again."); }
    setBusy(false);
  }

  const done = rows.filter(r => r.status === "done").length;
  const pulls = rows.filter(r => r.result?.outcome === "ok" && (r.result.score?.score ?? 0) >= 55);
  const upside = pulls.reduce((s, r) => s + Math.max(0, r.result!.score!.netRevenue), 0);

  return (
    <div style={{ padding: 16, position: "relative", zIndex: 1 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="Paste VIN (optional)" style={inp} autoCapitalize="characters" spellCheck={false} />
        <button onClick={decode} disabled={decoding || !vin.trim()} style={{ ...btnSecondary, opacity: (decoding || !vin.trim()) ? 0.5 : 1, whiteSpace: "nowrap" }}>{decoding ? "…" : "Decode"}</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={year} onChange={e => setYear(e.target.value)} placeholder="Year" style={{ ...inp, flex: "0 0 76px" }} inputMode="numeric" />
        <input value={make} onChange={e => setMake(e.target.value)} placeholder="Make" style={{ ...inp, flex: 1 }} />
        <input value={model} onChange={e => setModel(e.target.value)} placeholder="Model" style={{ ...inp, flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={avgCost} onChange={e => setAvgCost(e.target.value)} placeholder="Avg pull $ (optional)" style={{ ...inp, flex: 1 }} inputMode="decimal" />
        <button onClick={scan} disabled={busy} style={{ ...btnPrimary, minWidth: 132, opacity: busy ? 0.6 : 1 }}>{busy ? "Scanning…" : "Scan vehicle"}</button>
      </div>
      {error && <div style={errBox}>{error}</div>}

      {vehicle && (
        <>
          <SummaryCard title={vehicle.label} subtitle={vehicle.engine ? `${vehicle.engine}${vehicle.bodyClass ? ` · ${vehicle.bodyClass}` : ""}` : undefined}
            done={done} total={rows.length} busy={busy} exhausted={exhausted}
            stat1={{ n: String(pulls.length), label: "parts to pull", color: GREEN }} stat2={{ n: money(upside), label: "est. net upside", color: FG }} />
          <RowList rows={rows} buyWord="PULL" expanded={expanded} setExpanded={setExpanded} onRecheck={(row) => vehicle && scanOne(vehicle, row.id)} />
        </>
      )}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function SummaryCard(props: { title: string; subtitle?: string; done: number; total: number; busy: boolean; exhausted: boolean; stat1: { n: string; label: string; color: string }; stat2: { n: string; label: string; color: string }; note?: string }) {
  const pct = props.total ? Math.round((props.done / props.total) * 100) : 0;
  return (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, margin: "14px 0" }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{props.title}</div>
      {props.subtitle && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{props.subtitle}</div>}
      <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
        <div><div style={{ fontSize: 22, fontWeight: 800, color: props.stat1.color, fontFamily: MONO }}>{props.stat1.n}</div><div style={{ fontSize: 11, color: MUTED }}>{props.stat1.label}</div></div>
        <div><div style={{ fontSize: 22, fontWeight: 800, color: props.stat2.color, fontFamily: MONO }}>{props.stat2.n}</div><div style={{ fontSize: 11, color: MUTED }}>{props.stat2.label}</div></div>
      </div>
      {props.busy && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 4, background: "#0a1a12", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, background: GREEN, transition: "width .3s", boxShadow: `0 0 8px ${GREEN}` }} /></div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>Checking eBay comps… {props.done}/{props.total}</div>
        </div>
      )}
      {props.note && <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>{props.note}</div>}
      {props.exhausted && <div style={{ marginTop: 10, fontSize: 12, color: AMBER }}>⚠ Comp source ran low on credits — some rows may be incomplete.</div>}
    </div>
  );
}

function RowList({ rows, buyWord, showImage, expanded, setExpanded, onRecheck }: { rows: Row[]; buyWord: string; showImage?: boolean; expanded: string | null; setExpanded: (s: string | null) => void; onRecheck: (row: Row) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map(row => {
        const v = verdict(row, buyWord);
        const isOpen = expanded === row.id;
        const p = row.result;
        const pending = row.status !== "done";
        const q = p?.query || row.query;
        return (
          <div key={row.id} style={{ background: SURFACE, border: `1px solid ${isOpen ? GREEN + "40" : BORDER}`, borderRadius: 12, overflow: "hidden", opacity: pending ? 0.7 : 1 }}>
            <button onClick={() => !pending && setExpanded(isOpen ? null : row.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", background: "transparent", border: "none", color: FG, textAlign: "left" }}>
              <div style={{ flex: "0 0 72px", fontSize: 12, fontWeight: 800, color: v?.color ?? MUTED, background: v?.bg ?? "#0d1e2b", border: `1px solid ${(v?.color ?? MUTED)}44`, borderRadius: 8, padding: "6px 0", textAlign: "center", letterSpacing: "0.03em" }}>
                {pending ? <Spinner /> : v?.label}
              </div>
              {showImage && (
                <div style={{ flex: "0 0 40px", width: 40, height: 40, borderRadius: 7, background: "#081820", border: `1px solid ${BORDER}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {row.imageUrl ? <img src={row.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 14 }}>📦</span>}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                  {pending ? "checking…" :
                    p?.outcome === "ok" && p.comps.found
                      ? `${row.sub ? row.sub + " · " : ""}${p.comps.count} sold${p.score ? ` · ${(p.score.roi * 100).toFixed(0)}% ROI` : ""}`
                      : p?.outcome === "failed" ? "couldn’t read — tap RE-CHECK" : "no eBay sales matched"}
                </div>
              </div>
              <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                <div style={{ fontSize: 17, fontWeight: 800, fontFamily: MONO, color: p?.comps.found ? FG : MUTED }}>{p?.comps.found ? money(p.comps.median) : "—"}</div>
                <div style={{ fontSize: 10, color: MUTED }}>{p?.comps.found ? "sold median" : ""}</div>
              </div>
            </button>

            {isOpen && p && (
              <div style={{ padding: "12px 14px 14px", fontSize: 13, color: "#9fc4b5", borderTop: `1px solid ${BORDER}` }}>
                {p.comps.found ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                    <Detail k="Sold range" v={`${money(p.comps.low)} – ${money(p.comps.high)}`} />
                    <Detail k="~ sold / mo" v={String(p.comps.avgSoldPerMonth)} />
                    {p.cost > 0 && <Detail k="Your cost" v={money(p.cost)} />}
                    {p.score && <Detail k="Net after fees" v={money(p.score.netRevenue)} />}
                    {p.score && p.cost > 0 && <Detail k="Est. profit" v={money(p.score.estimatedProfit)} />}
                  </div>
                ) : (
                  <div style={{ marginBottom: 8 }}>{p.outcome === "failed" ? "The comp source didn’t return a clean page. Re-check to try again." : "No matching sold listings."}</div>
                )}
                {p.note && <div style={{ marginTop: 10, color: AMBER, fontSize: 12 }}>ℹ {p.note}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  {q && <a href={ebayUrl(q)} target="_blank" rel="noreferrer" style={{ ...pill, color: GREEN, borderColor: `${GREEN}55` }}>View sold on eBay ↗</a>}
                  {row.productUrl && <a href={row.productUrl} target="_blank" rel="noreferrer" style={{ ...pill, color: FG, borderColor: BORDER }}>View product ↗</a>}
                  <button onClick={() => onRecheck(row)} disabled={row.status === "busy"} style={{ ...pill, color: AMBER, borderColor: `${AMBER}55`, background: "transparent", opacity: row.status === "busy" ? 0.5 : 1 }}>{row.status === "busy" ? "Re-checking…" : "Re-check"}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Spinner() { return <span style={{ display: "inline-block", width: 11, height: 11, border: `2px solid ${MUTED}55`, borderTopColor: GREEN, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />; }
function Detail({ k, v }: { k: string; v: string }) { return <div><div style={{ fontSize: 11, color: MUTED }}>{k}</div><div style={{ fontSize: 14, color: FG, fontWeight: 600, fontFamily: MONO }}>{v}</div></div>; }
function emptyComps(): Comps { return { found: false, count: 0, median: 0, low: 0, high: 0, avgSoldPerMonth: 0 }; }

const inp: React.CSSProperties = { background: "#081820", border: `1px solid ${BORDER}`, borderRadius: 10, color: FG, padding: "12px 12px", fontSize: 16, outline: "none", minWidth: 0, width: "100%" };
const btnPrimary: React.CSSProperties = { background: DIM, color: GREEN, border: `1px solid ${GREEN}55`, borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 800, boxShadow: `0 0 16px ${GREEN}20`, flex: "0 0 auto" };
const btnSecondary: React.CSSProperties = { background: SURFACE, color: FG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px", fontSize: 14, fontWeight: 600 };
const pill: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 999, border: `1px solid ${BORDER}`, background: "transparent", display: "inline-block" };
const errBox: React.CSSProperties = { color: RED, fontSize: 13, background: "#230d0d", border: `1px solid ${RED}44`, borderRadius: 8, padding: "8px 12px", marginTop: 10 };
