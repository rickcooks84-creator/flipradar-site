"use client";
import { useState, useRef, useEffect } from "react";

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
  id: string; label: string; sub?: string; category?: string; imageUrl?: string; productUrl?: string;
  query: string; cost: number; status: "pending" | "busy" | "done"; result?: Result;
}
interface Vehicle { label: string; year: string; make: string; model: string; engine?: string; bodyClass?: string; }

type SortBy = "best" | "median" | "profit" | "sold";
type Tier = "pending" | "recheck" | "pull" | "maybe" | "skip" | "none";

const CAT_META: Record<string, { icon: string; label: string }> = {
  lighting: { icon: "🔦", label: "Lighting" }, engine: { icon: "⚙️", label: "Engine" },
  electrical: { icon: "🔌", label: "Electrical" }, interior: { icon: "🪑", label: "Interior" },
  body: { icon: "🚪", label: "Body" }, wheels: { icon: "⭕", label: "Wheels" },
  emissions: { icon: "♻️", label: "Emissions" }, drivetrain: { icon: "⚙️", label: "Drivetrain" },
};

function tier(r: Row): Tier {
  if (r.status !== "done" || !r.result) return "pending";
  const x = r.result;
  if (x.outcome === "failed") return "recheck";
  if (x.outcome === "empty" || !x.comps.found) return "none";
  const s = x.score?.score ?? 0;
  if (s >= 55) return "pull";
  if (s >= 40) return "maybe";
  return "skip";
}
const TIER_COLOR: Record<Tier, string> = { pending: BORDER, recheck: AMBER, pull: GREEN, maybe: AMBER, skip: RED, none: MUTED };
function sortVal(r: Row, by: SortBy): number {
  const x = r.result;
  if (!x || !x.comps.found) return -1;
  if (by === "median") return x.comps.median;
  if (by === "profit") return x.score?.estimatedProfit ?? -1;
  if (by === "sold") return x.comps.count;
  return x.score?.score ?? -1;
}

// Client-side re-scoring so typing a cost updates profit / ROI / verdict INSTANTLY with no
// server call (the comps are already known). Mirrors lib/scorer.ts scoreProduct with a flat
// $8 shipping estimate (matches the store scanner). Returns null when there are no comps.
const FEE_RATE = 0.1325, EST_SHIP = 8;
function scoreClient(cost: number, comps: Comps): Score | null {
  if (!comps.found || comps.count === 0 || comps.median === 0) return null;
  const netRevenue = comps.median - comps.median * FEE_RATE - EST_SHIP;
  const estimatedProfit = netRevenue - cost;
  const roi = cost > 0 ? estimatedProfit / cost : 0;
  const vol = Math.min(1, comps.count / 20);
  let base: number;
  if (roi >= 1) base = 90; else if (roi >= 0.75) base = 80; else if (roi >= 0.5) base = 70;
  else if (roi >= 0.3) base = 57; else if (roi >= 0.2) base = 45; else if (roi >= 0.1) base = 32;
  else if (roi >= 0) base = 18; else base = 5;
  const score = Math.max(1, Math.min(100, Math.round(base * vol + 35 * (1 - vol))));
  const grade = score >= 85 ? "S" : score >= 70 ? "A" : score >= 55 ? "B" : score >= 40 ? "C" : score >= 25 ? "D" : "F";
  return { score, estimatedProfit, roi, netRevenue, grade, reason: "" };
}

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
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>, shouldStop?: () => boolean) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { if (shouldStop?.()) return; const it = items[i++]; await worker(it); }
  }));
}

export default function ScanPage() {
  const [mode, setMode] = useState<Mode>("store");

  async function logout() {
    // Web build uses a session cookie (→ /login); the desktop build uses a local license
    // file (→ /activate). /api/license/check reports which via `mode`, so one function fits both.
    try {
      const d = await (await fetch("/api/license/check")).json();
      if (d.mode === "cookie") {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
        return;
      }
    } catch {}
    window.location.href = "/activate";
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

// ─── Scan cooldown ────────────────────────────────────────────────────────────
//
// Sold-comp lookups ride the user's own eBay session, and one scan fires far more
// searches than ordinary browsing ever would. It's back-to-back BIG scans that make an
// account look automated, so the app rests afterwards — scaled to how much it just did.
// A 60-product collection barely pauses; a 2,000-product catalog earns a real break.
//
// Persisted to localStorage rather than component state ON PURPOSE: a cooldown that a
// page refresh clears is decoration, not protection.
const COOLDOWN_MS_PER_PRODUCT = 250;
const COOLDOWN_MIN_MS = 30_000;          // even a tiny scan gets a breather
const COOLDOWN_MAX_MS = 15 * 60_000;     // cap it — past this it just feels broken
const COOLDOWN_KEY = "fs_scan_cooldown_until";

function cooldownFor(products: number): number {
  return Math.min(COOLDOWN_MAX_MS, Math.max(COOLDOWN_MIN_MS, Math.round(products * COOLDOWN_MS_PER_PRODUCT)));
}

function fmtDur(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function useScanCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Restore a cooldown that was still running when the page was closed/refreshed.
  useEffect(() => {
    const saved = Number(localStorage.getItem(COOLDOWN_KEY) || 0);
    if (saved > Date.now()) { setUntil(saved); setNow(Date.now()); }
  }, []);

  // Tick only while one is actually active — no permanent 1s timer on an idle page.
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);

  const remainingMs = Math.max(0, until - now);
  function start(products: number) {
    const u = Date.now() + cooldownFor(products);
    localStorage.setItem(COOLDOWN_KEY, String(u));
    setUntil(u);
    setNow(Date.now());
  }
  return { remainingMs, active: remainingMs > 0, start };
}

// ─── eBay connection ──────────────────────────────────────────────────────────
//
// Users can now connect their own eBay account here (the same OAuth flow Auto List Bot
// uses). What that connection is WORTH is the part this component has to be careful about.
//
// FlipSonar scores on SOLD prices. The only official sold endpoint is eBay's Marketplace
// Insights API, and eBay grants that scope to the APP, not to the user consenting — this
// app's request was refused (invalid_scope). So a user can connect successfully and still
// get no comps, which is exactly the kind of thing a UI is tempted to paper over.
//
// It doesn't: `insights` is reported separately from `connected`, and until eBay grants the
// scope this says so in as many words. An earlier version of this page promised an eBay
// connection the web couldn't deliver, and that was worse than saying nothing — the fix
// isn't to promise it again, it's to show exactly how far the connection actually gets.

interface EbayStatus {
  connected: boolean;
  live?: boolean;
  insights?: boolean;
  configured: boolean;
  connectedAt?: number;
  error?: string;
}

// Outcomes handed back by /api/ebay/callback via ?ebay=…
const EBAY_RETURN: Record<string, { tone: string; text: string }> = {
  connected: { tone: GREEN, text: "eBay account connected — sold comps are on." },
  connected_no_insights: { tone: AMBER, text: "eBay account connected, but eBay didn't grant sold-data access. Comps stay unavailable until the app is approved." },
  declined: { tone: MUTED, text: "eBay connection cancelled." },
  state_mismatch: { tone: RED, text: "That connection request didn't match — start it again from this page." },
  scope_refused: { tone: AMBER, text: "eBay refused the sold-data permission for this app. Nothing was connected." },
  unconfigured: { tone: RED, text: "eBay isn't set up on the server yet." },
  error: { tone: RED, text: "eBay couldn't complete the connection. Try again." },
};

function EbayConnection() {
  const [status, setStatus] = useState<EbayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [returned, setReturned] = useState<{ tone: string; text: string } | null>(null);

  useEffect(() => {
    // Read (and clear) the ?ebay= reason so a refresh doesn't replay a stale message.
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("ebay");
    if (reason) {
      setReturned(EBAY_RETURN[reason] ?? EBAY_RETURN.error);
      params.delete("ebay");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : ""));
    }
    fetch("/api/ebay/status")
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/ebay/disconnect", { method: "POST" });
      setStatus({ connected: false, configured: status?.configured ?? true });
      setReturned(null);
    } catch { /* leave the current state alone */ }
    setBusy(false);
  }

  const connected = !!status?.connected;
  const insights = !!status?.insights;
  const tone = connected ? (insights ? GREEN : AMBER) : AMBER;

  return (
    <div style={{ background: SURFACE, border: `1px solid ${tone}44`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
      {returned && (
        <div style={{ fontSize: 12, color: returned.tone, fontWeight: 700, marginBottom: 8, lineHeight: 1.5 }}>
          {returned.text}
        </div>
      )}

      <div style={{ fontSize: 12, color: FG, lineHeight: 1.5 }}>
        {connected && insights && (
          <>
            <span style={{ color: GREEN, fontWeight: 700 }}>eBay connected ·</span>{" "}
            Sold comps are read through your own eBay account.
          </>
        )}
        {connected && !insights && (
          <>
            <span style={{ color: AMBER, fontWeight: 700 }}>eBay connected — sold data not granted ·</span>{" "}
            Your account is linked, but eBay hasn&apos;t approved FlipSonar for sold-listing
            access, so comps still can&apos;t be checked. Nothing more for you to do; the
            approval is on eBay&apos;s side.
          </>
        )}
        {!connected && (
          <>
            <span style={{ color: AMBER, fontWeight: 700 }}>Sold prices aren&apos;t available yet ·</span>{" "}
            eBay only shows sold listings to signed-in users. You can connect your eBay account
            below, but be aware it won&apos;t switch comps on by itself &mdash; eBay still has to
            approve FlipSonar for sold-listing access. Scans list a store&apos;s products and
            prices either way, and report comps as unchecked rather than guessing.
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        {!connected && status?.configured !== false && (
          <a
            href="/api/ebay/connect"
            style={{ background: DIM, border: `1px solid ${GREEN}50`, color: GREEN, fontWeight: 700, fontSize: 12, padding: "8px 14px", borderRadius: 8, textDecoration: "none" }}
          >
            Connect eBay account →
          </a>
        )}
        {connected && (
          <button
            onClick={disconnect}
            disabled={busy}
            style={{ background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, fontWeight: 700, fontSize: 12, padding: "8px 14px", borderRadius: 8, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Disconnecting…" : "Disconnect eBay"}
          </button>
        )}
        <a
          href="/activate"
          style={{ background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, fontWeight: 700, fontSize: 12, padding: "8px 14px", borderRadius: 8, textDecoration: "none" }}
        >
          Get the desktop app →
        </a>
      </div>

      {connected && (
        <div style={{ fontSize: 11, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
          Disconnecting removes FlipSonar&apos;s copy of your token. To revoke the permission on
          eBay&apos;s side, use your eBay account settings.
          {status?.live === false && status?.error && (
            <> · eBay reported: {status.error}</>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
        The <strong style={{ color: FG }}>desktop app</strong> signs in to eBay on your own
        machine &mdash; something a website can&apos;t do &mdash; so sold comps work there today.
        Use a separate eBay account for scanning, not the one you sell on: a scan runs many
        searches in a short window.
      </div>
    </div>
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
  const [blocked, setBlocked] = useState(false);
  const stopRef = useRef(false);
  const cooldown = useScanCooldown();
  // Counts lookups actually sent this scan, so the cooldown reflects real eBay activity —
  // stopping after 5 products shouldn't cost the same rest as scanning 2,000.
  const doneCountRef = useRef(0);

  function stop() { stopRef.current = true; setBusy(false); }

  async function scanOne(row: Row) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: "busy" } : r));
    doneCountRef.current += 1;
    try {
      const res = await fetch("/api/comp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: row.query, cost: row.cost }) });
      const d = await res.json();
      if (d.keysExhausted) setExhausted(true);
      // eBay's sign-in wall hits every product identically — halt the pool instead of
      // running the whole catalog into the same wall and showing a page of blank rows.
      if (d.blocked) { setBlocked(true); stopRef.current = true; }
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: "done", result: { comps: d.comps, score: d.score, outcome: d.outcome, query: row.query, cost: row.cost } } : r));
    } catch {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: "done", result: { comps: emptyComps(), score: null, outcome: "failed", query: row.query, cost: row.cost } } : r));
    }
  }

  async function scan() {
    setError(""); setNote(""); setRows([]); setExpanded(null); setExhausted(false); setBlocked(false);
    if (!/^https?:\/\//i.test(url.trim())) { setError("Enter a full store URL starting with https://"); return; }
    if (cooldown.active) { setError(`Cooling down — you can scan again in ${fmtDur(cooldown.remainingMs)}.`); return; }
    stopRef.current = false; setBusy(true);
    doneCountRef.current = 0;
    try {
      const r = await fetch("/api/store-scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
      const d = await r.json();
      if (d.error) { setError(d.error); setBusy(false); return; }
      if (stopRef.current) { setBusy(false); return; }
      if (d.capped) setNote(`Showing the first ${d.products.length} of ${d.total} products.`);
      const initial: Row[] = d.products.map((p: any) => ({
        id: p.id, label: p.name, sub: p.price ? money(p.price) : "no price", imageUrl: p.imageUrl, productUrl: p.productUrl,
        query: p.ebayQuery, cost: p.price ?? 0, status: "pending" as const,
      }));
      setRows(initial);
      await runPool(initial, 6, scanOne, () => stopRef.current);
      setRows(prev => [...prev].sort((a, b) => (b.result?.score?.score ?? -1) - (a.result?.score?.score ?? -1)));
    } catch { setError("Scan failed — check the URL and your connection."); }
    if (doneCountRef.current > 0) cooldown.start(doneCountRef.current);
    setBusy(false);
  }

  // Cost handling: default = the store's scraped price; a global field overrides all, and
  // each row can override individually. Re-scoring is client-side (instant, no server call).
  const [globalCost, setGlobalCost] = useState("");
  const [costs, setCosts] = useState<Record<string, string>>({});
  const effCost = (r: Row): number => {
    const per = parseFloat(costs[r.id] ?? ""); if (per > 0) return per;
    const g = parseFloat(globalCost); if (g > 0) return g;
    return r.result?.cost ?? r.cost ?? 0;
  };
  const scoredRows: Row[] = rows.map(r => {
    if (r.status !== "done" || !r.result || !r.result.comps.found) return r;
    const c = effCost(r);
    return { ...r, sub: money(c), result: { ...r.result, cost: c, score: scoreClient(c, r.result.comps) } };
  });

  // Cooling only matters when idle — mid-scan the button is the Stop control.
  const cooling = cooldown.active && !busy;
  const done = rows.filter(r => r.status === "done").length;
  const buys = scoredRows.filter(r => r.result?.outcome === "ok" && (r.result.score?.score ?? 0) >= 55);
  const upside = buys.reduce((s, r) => s + Math.max(0, r.result!.score!.estimatedProfit), 0);

  return (
    <div style={{ padding: 16, position: "relative", zIndex: 1 }}>
      <EbayConnection />
      <div style={{ display: "flex", gap: 8 }}>
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter") scan(); }} placeholder="Paste a store or collection URL" style={inp} inputMode="url" autoCapitalize="none" spellCheck={false} />
        <button
          onClick={busy ? stop : scan}
          disabled={cooling}
          style={
            busy ? { ...btnStop, minWidth: 96 }
            : cooling ? { ...btnPrimary, minWidth: 96, background: SURFACE, color: MUTED, borderColor: BORDER, boxShadow: "none" }
            : { ...btnPrimary, minWidth: 96 }
          }
        >
          {busy ? "◼ Stop" : cooling ? fmtDur(cooldown.remainingMs) : "Scan"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
        {cooling
          ? "Resting before the next scan so your eBay activity stays in a normal range. Larger scans rest longer."
          : "Works best on Shopify stores. Point at a collection/category page, not the homepage."}
      </div>
      {error && <div style={errBox}>{error}</div>}

      {blocked && (
        <div style={{ ...errBox, borderColor: AMBER, color: AMBER }}>
          eBay is requiring sign-in to view sold listings right now, so comps couldn’t be checked.
          Scan stopped — this is <strong>not</strong> a sign these products have no resale market.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <SummaryCard title="Store scan" done={done} total={rows.length} busy={busy} exhausted={exhausted}
            stat1={{ n: String(buys.length), label: "to buy", color: GREEN }} stat2={{ n: money(upside), label: "est. profit", color: FG }} note={note} />
          {/* Your cost — applies to every product (default is the store's price). Per-row
              override lives in each card's detail. Profit/ROI recompute instantly. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <input value={globalCost} onChange={e => setGlobalCost(e.target.value)} placeholder="Your cost $ — applies to all (optional)" style={{ ...inp, flex: 1 }} inputMode="decimal" />
            {(globalCost || Object.keys(costs).length > 0) && (
              <button onClick={() => { setGlobalCost(""); setCosts({}); }} style={{ ...btnSecondary, whiteSpace: "nowrap" }}>Reset</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>Default cost = the store’s price. Enter your real buy cost to see true profit.</div>
          <RowList rows={scoredRows} buyWord="BUY" showImage scanning={busy} expanded={expanded} setExpanded={setExpanded}
            onRecheck={(row) => scanOne(row)} costs={costs} onCostChange={(id, val) => setCosts(prev => ({ ...prev, [id]: val }))} />
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
  const stopRef = useRef(false);

  function stop() { stopRef.current = true; setBusy(false); }

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
    stopRef.current = false; setBusy(true);
    try {
      const pr = await fetch("/api/vehicle-parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year, make, model, vin: vin.trim() || undefined }) });
      const pd = await pr.json();
      if (pd.error) { setError(pd.error); setBusy(false); return; }
      if (stopRef.current) { setBusy(false); return; }
      const v: Vehicle = pd.vehicle;
      const initial: Row[] = pd.parts.map((p: any) => ({ id: p.id, label: p.label, sub: p.category, category: p.category, query: "", cost: 0, status: "pending" as const }));
      setVehicle(v); setRows(initial);
      await runPool(initial.map(r => r.id), 6, (id) => scanOne(v, id), () => stopRef.current);
      setRows(prev => [...prev].sort((a, b) => (b.result?.score?.score ?? -1) - (a.result?.score?.score ?? -1)));
    } catch { setError("Scan failed — check your connection and try again."); }
    setBusy(false);
  }

  const done = rows.filter(r => r.status === "done").length;
  const pulls = rows.filter(r => r.result?.outcome === "ok" && (r.result.score?.score ?? 0) >= 55);
  const upside = pulls.reduce((s, r) => s + Math.max(0, r.result!.score!.netRevenue), 0);

  return (
    <div style={{ padding: 16, position: "relative", zIndex: 1 }}>
      <EbayConnection />
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
        <button onClick={busy ? stop : scan} style={busy ? { ...btnStop, minWidth: 132 } : { ...btnPrimary, minWidth: 132 }}>{busy ? "◼ Stop" : "Scan vehicle"}</button>
      </div>
      {error && <div style={errBox}>{error}</div>}

      {vehicle && (
        <>
          <SummaryCard title={vehicle.label} subtitle={vehicle.engine ? `${vehicle.engine}${vehicle.bodyClass ? ` · ${vehicle.bodyClass}` : ""}` : undefined}
            done={done} total={rows.length} busy={busy} exhausted={exhausted}
            stat1={{ n: String(pulls.length), label: "parts to pull", color: GREEN }} stat2={{ n: money(upside), label: "est. net upside", color: FG }} />
          <RowList rows={rows} buyWord="PULL" scanning={busy} expanded={expanded} setExpanded={setExpanded} onRecheck={(row) => vehicle && scanOne(vehicle, row.id)} />
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

function RowList({ rows, buyWord, showImage, scanning, expanded, setExpanded, onRecheck, costs, onCostChange }: { rows: Row[]; buyWord: string; showImage?: boolean; scanning?: boolean; expanded: string | null; setExpanded: (s: string | null) => void; onRecheck: (row: Row) => void; costs?: Record<string, string>; onCostChange?: (id: string, val: string) => void }) {
  const [sortBy, setSortBy] = useState<SortBy>("best");
  const [cat, setCat] = useState<string | null>(null);
  const [winnersOnly, setWinnersOnly] = useState(false);

  const cats = Array.from(new Set(rows.map(r => r.category).filter(Boolean))) as string[];
  const activeCat = cat && cats.includes(cat) ? cat : null;

  // Top picks: best "pull/buy" rows ranked by est. profit (fallback to median), up to 3.
  const topPicks = [...rows.filter(r => tier(r) === "pull")].sort((a, b) => {
    const pa = a.result!.score?.estimatedProfit ?? a.result!.comps.median;
    const pb = b.result!.score?.estimatedProfit ?? b.result!.comps.median;
    return pb - pa;
  }).slice(0, 3);

  // Visible list: apply category + winners-only filters, then sort.
  let view = rows.filter(r => !activeCat || r.category === activeCat);
  if (winnersOnly) view = view.filter(r => { const t = tier(r); return t === "pull" || t === "maybe" || t === "pending" || t === "recheck"; });
  view = [...view].sort((a, b) => {
    const d = sortVal(b, sortBy) - sortVal(a, sortBy);
    if (d !== 0) return d;
    // Tie-break by profit, then median — so "Best" surfaces the MOST PROFITABLE among items
    // that share the same score (e.g. everything scoring 90 after a global cost is entered).
    const pa = a.result?.score?.estimatedProfit ?? -Infinity, pb = b.result?.score?.estimatedProfit ?? -Infinity;
    if (pb !== pa) return pb - pa;
    return (b.result?.comps.median ?? -1) - (a.result?.comps.median ?? -1);
  });
  const hiddenCount = rows.length - view.length;

  const SORTS: [SortBy, string][] = [["best", "Best"], ["median", "$ Median"], ["profit", "Profit"], ["sold", "Sold"]];

  return (
    <div>
      {/* Top picks */}
      {topPicks.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: GREEN, letterSpacing: "0.06em", marginBottom: 7 }}>🔥 TOP PICKS — GRAB THESE FIRST</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {topPicks.map((r, i) => {
              const tp = r.result!;
              return (
                <button key={r.id} onClick={() => setExpanded(r.id)} style={{ flex: "0 0 auto", minWidth: 148, textAlign: "left", background: "#0c2318", border: `1px solid ${GREEN}55`, borderRadius: 11, padding: "10px 12px", boxShadow: `0 0 16px ${GREEN}12`, color: FG }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: GREEN }}>#{i + 1}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{r.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: MONO, marginTop: 2 }}>{money(tp.comps.median)}</div>
                  <div style={{ fontSize: 11, color: GREEN }}>{tp.score && tp.cost > 0 ? `+${money(tp.score.estimatedProfit)} profit` : `${tp.comps.count} sold`}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Sort + winners-only */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        {SORTS.map(([k, lbl]) => (
          <button key={k} onClick={() => setSortBy(k)} style={{ fontSize: 12, fontWeight: 700, padding: "6px 11px", borderRadius: 8, background: sortBy === k ? DIM : "transparent", color: sortBy === k ? GREEN : MUTED, border: `1px solid ${sortBy === k ? GREEN + "55" : BORDER}` }}>{lbl}</button>
        ))}
        <button onClick={() => setWinnersOnly(w => !w)} style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, padding: "6px 11px", borderRadius: 999, background: winnersOnly ? DIM : "transparent", color: winnersOnly ? GREEN : MUTED, border: `1px solid ${winnersOnly ? GREEN + "55" : BORDER}` }}>{winnersOnly ? "✓ Winners only" : "Winners only"}</button>
      </div>

      {/* Category chips */}
      {cats.length > 1 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
          <Chip active={!activeCat} onClick={() => setCat(null)} label={`All (${rows.length})`} />
          {cats.map(c => {
            const meta = CAT_META[c] || { icon: "•", label: c };
            const n = rows.filter(r => r.category === c).length;
            return <Chip key={c} active={activeCat === c} onClick={() => setCat(c)} label={`${meta.icon} ${meta.label} (${n})`} />;
          })}
        </div>
      )}

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {view.map(row => {
        const v = verdict(row, buyWord);
        const isOpen = expanded === row.id;
        const p = row.result;
        const pending = row.status !== "done";
        // A row is "active" only while a lookup is actually running. Once the user hits Stop,
        // still-pending rows fall idle — show "—" / "not scanned" instead of a forever-spinner.
        const active = row.status === "busy" || (pending && scanning);
        const q = p?.query || row.query;
        const tc = TIER_COLOR[tier(row)];
        return (
          <div key={row.id} style={{ background: SURFACE, border: `1px solid ${isOpen ? GREEN + "40" : BORDER}`, borderLeft: `3px solid ${tc}`, borderRadius: 12, overflow: "hidden", opacity: pending ? 0.7 : 1 }}>
            <button onClick={() => !pending && setExpanded(isOpen ? null : row.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", background: "transparent", border: "none", color: FG, textAlign: "left" }}>
              <div style={{ flex: "0 0 72px", fontSize: 12, fontWeight: 800, color: v?.color ?? MUTED, background: v?.bg ?? "#0d1e2b", border: `1px solid ${(v?.color ?? MUTED)}44`, borderRadius: 8, padding: "6px 0", textAlign: "center", letterSpacing: "0.03em" }}>
                {active ? <Spinner /> : pending ? "—" : v?.label}
              </div>
              {showImage && (
                <div style={{ flex: "0 0 40px", width: 40, height: 40, borderRadius: 7, background: "#081820", border: `1px solid ${BORDER}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {row.imageUrl ? <img src={row.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 14 }}>📦</span>}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                  {active ? "checking…" : pending ? "not scanned — stopped" :
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
                    {onCostChange ? (
                      <div>
                        <div style={{ fontSize: 11, color: MUTED }}>Your cost</div>
                        <input value={costs?.[row.id] ?? String(p.cost || "")} onChange={e => onCostChange(row.id, e.target.value)} onClick={e => e.stopPropagation()} inputMode="decimal" placeholder="$"
                          style={{ width: "100%", marginTop: 2, background: "#081820", border: `1px solid ${BORDER}`, borderRadius: 7, color: FG, padding: "6px 8px", fontSize: 14, fontWeight: 600, fontFamily: MONO, outline: "none" }} />
                      </div>
                    ) : (p.cost > 0 && <Detail k="Your cost" v={money(p.cost)} />)}
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
      {winnersOnly && hiddenCount > 0 && <div style={{ fontSize: 11, color: MUTED, textAlign: "center", padding: 10 }}>{hiddenCount} hidden (skip / no market)</div>}
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} style={{ flex: "0 0 auto", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 999, background: active ? DIM : "transparent", color: active ? GREEN : MUTED, border: `1px solid ${active ? GREEN + "55" : BORDER}` }}>{label}</button>;
}

function Spinner() { return <span style={{ display: "inline-block", width: 11, height: 11, border: `2px solid ${MUTED}55`, borderTopColor: GREEN, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />; }
function Detail({ k, v }: { k: string; v: string }) { return <div><div style={{ fontSize: 11, color: MUTED }}>{k}</div><div style={{ fontSize: 14, color: FG, fontWeight: 600, fontFamily: MONO }}>{v}</div></div>; }
function emptyComps(): Comps { return { found: false, count: 0, median: 0, low: 0, high: 0, avgSoldPerMonth: 0 }; }

const inp: React.CSSProperties = { background: "#081820", border: `1px solid ${BORDER}`, borderRadius: 10, color: FG, padding: "12px 12px", fontSize: 16, outline: "none", minWidth: 0, width: "100%" };
const btnPrimary: React.CSSProperties = { background: DIM, color: GREEN, border: `1px solid ${GREEN}55`, borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 800, boxShadow: `0 0 16px ${GREEN}20`, flex: "0 0 auto" };
const btnStop: React.CSSProperties = { background: "#230d0d", color: RED, border: `1px solid ${RED}77`, borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 800, boxShadow: `0 0 16px ${RED}22`, flex: "0 0 auto" };
const btnSecondary: React.CSSProperties = { background: SURFACE, color: FG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px", fontSize: 14, fontWeight: 600 };
const pill: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 999, border: `1px solid ${BORDER}`, background: "transparent", display: "inline-block" };
const errBox: React.CSSProperties = { color: RED, fontSize: 13, background: "#230d0d", border: `1px solid ${RED}44`, borderRadius: 8, padding: "8px 12px", marginTop: 10 };
