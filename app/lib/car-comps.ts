// ─── Car-part eBay comps (year + model aware) ────────────────────────────────
//
// The store-product relevance in ebay.ts is tuned for branded catalog items and
// deliberately IGNORES bare numbers. Car parts are the opposite: the model YEAR and
// MODEL CODE are the entire identity — a 2013 F-150 tail light must not comp against a
// 2005 one. So we fetch the raw sold items (fetchSoldItems keeps the year in the query)
// and apply our own relevance here:
//   1. the comp title must contain the PART identity (one of the part's mustMatch words),
//   2. it must FIT the vehicle — see fitMatches below (this is where recall lives),
//   3. if the title mentions any years, the vehicle year must fall inside that range
//      (±1 to allow generation overlap). Titles with no year still count (many omit it).
//
// Recall history: the original filter required the WHOLE collapsed model to appear in the
// title ("silverado1500"), which dropped the majority of real comps two ways —
//   • multi-word / sub-designated models: a "Silverado 1500" scan dropped every listing
//     that just says "Silverado" (i.e. almost all of them), and
//   • cross-fit mechanical/electrical parts (alternator, starter, ECU, modules, sensors)
//     that sellers list by OEM part number + MAKE, with no model in the title at all.
// Both surfaced as "NO MARKET" on parts that obviously sell. fitMatches fixes both.

import { fetchSoldItems, calcComps, type EbayItem, type SoldComps, type FetchStatus } from './ebay';
import type { PartDef, PartFit } from './parts-catalog';
import type { Vehicle } from './vehicle';

const EMPTY: SoldComps = { found: false, count: 0, median: 0, low: 0, high: 0, avgSoldPerMonth: 0, matched: 0, scanned: 0 };

export interface CarCompResult {
  status: FetchStatus;
  comps: SoldComps;
  parsed: number; // total eBay items parsed off the page (0 usually means a bad/blocked fetch)
}

function collapse(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Words that show up inside a model name but carry no identity on their own — requiring
// just "model" or "series" would match almost anything, so they never become the sole
// required token (we fall back to the full collapsed model instead).
const GENERIC_MODEL_TOKENS = new Set(['model', 'series', 'class', 'type', 'edition', 'line']);

// Brand aliases so a MAKE-level match (used for cross-fit parts) survives how sellers
// actually write the brand: "Chevrolet" listings almost always say "Chevy", VWs say "VW",
// etc. Keys are the collapsed NHTSA/user make; values are collapsed accepted tokens.
const MAKE_ALIASES: Record<string, string[]> = {
  chevrolet: ['chevrolet', 'chevy', 'chev', 'gm', 'gmc'],
  gmc: ['gmc', 'gm', 'chevy', 'chevrolet'],
  ram: ['ram', 'dodge', 'mopar'],
  dodge: ['dodge', 'ram', 'mopar', 'chrysler'],
  chrysler: ['chrysler', 'mopar', 'dodge'],
  jeep: ['jeep', 'mopar'],
  volkswagen: ['volkswagen', 'vw'],
  mercedesbenz: ['mercedesbenz', 'mercedes', 'benz'],
  mercedes: ['mercedes', 'benz', 'mercedesbenz'],
  landrover: ['landrover', 'rover', 'land'],
  ford: ['ford', 'motorcraft'],
  toyota: ['toyota', 'lexus', 'scion'],
  lexus: ['lexus', 'toyota'],
  honda: ['honda', 'acura'],
  acura: ['acura', 'honda'],
  nissan: ['nissan', 'infiniti', 'datsun'],
  infiniti: ['infiniti', 'nissan'],
  hyundai: ['hyundai', 'genesis'],
  mazda: ['mazda'],
  subaru: ['subaru'],
  kia: ['kia'],
  bmw: ['bmw', 'mini'],
  audi: ['audi'],
};

function makeTokensFor(make: string): string[] {
  const m = collapse(make);
  return MAKE_ALIASES[m] ?? (m ? [m] : []);
}

// MAKE-level fit: does the title name this brand (or a sibling brand that shares the part)?
// Short aliases (<= 3 chars, e.g. "vw", "gm") are matched as whole tokens to avoid random
// substring hits; longer ones can match inside the collapsed title.
function makeMatches(collapsedTitle: string, tokens: Set<string>, make: string): boolean {
  return makeTokensFor(make).some(a => (a.length <= 3 ? tokens.has(a) : collapsedTitle.includes(a)));
}

// MODEL-level fit: does the title name this model? Handles the two shapes that broke before:
//   • whole collapsed model present ("f150" in "Ford F150 …")  → match
//   • every ALPHABETIC model word present, ignoring pure-number sub-designations —
//     so "Silverado 1500" needs only "silverado", while "Grand Cherokee" still needs both
//     "grand" and "cherokee" (keeps it off a plain "Cherokee").
// Falls back to a bare-token check for tiny models ("3", "Q5", "CR-V" → "crv").
function modelMatches(collapsedTitle: string, tokens: Set<string>, model: string): boolean {
  const full = collapse(model);
  if (full.length >= 2 && collapsedTitle.includes(full)) return true;

  const alpha = model
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter(w => /[a-z]/.test(w)) // drop pure-number designations like "1500" / "2500"
    .map(collapse)
    .filter(w => w.length >= 2 && !GENERIC_MODEL_TOKENS.has(w));

  if (alpha.length) return alpha.every(w => collapsedTitle.includes(w));
  return full.length ? tokens.has(full) : false;
}

// The vehicle-fit gate, chosen per part:
//   • 'model'    (default) — the part's identity is model-specific (lights, panels, trim,
//                 mirrors, cluster …): require a MODEL match. Wrong model = wrong part/price.
//   • 'crossfit' — the part is shared across a brand and commonly listed by OEM part number
//                 + make (alternator, starter, A/C compressor, sensors, control modules …):
//                 accept a MODEL **or** MAKE match, so part-number listings still count.
function fitMatches(
  collapsedTitle: string,
  tokens: Set<string>,
  v: Pick<Vehicle, 'make' | 'model'>,
  fit: PartFit,
): boolean {
  if (modelMatches(collapsedTitle, tokens, v.model)) return true;
  return fit === 'crossfit' && makeMatches(collapsedTitle, tokens, v.make);
}

function isRelevantCarComp(
  title: string,
  v: Pick<Vehicle, 'year' | 'make' | 'model'>,
  mustMatch: string[],
  fit: PartFit = 'model',
): boolean {
  const t = title.toLowerCase();
  const collapsed = collapse(t);
  const tokens = new Set(t.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean));

  // 1) Part identity — the listing must actually be this part.
  if (!mustMatch.some(m => tokens.has(m) || collapsed.includes(m))) return false;

  // 2) Vehicle fit — model-strict, or make-level for cross-fit parts.
  if (!fitMatches(collapsed, tokens, v, fit)) return false;

  // 3) Year window — only enforce when the title actually cites years.
  const yrs = (t.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  if (yrs.length) {
    const y = Number(v.year);
    if (y) {
      const lo = Math.min(...yrs) - 1;
      const hi = Math.max(...yrs) + 1;
      if (!(y >= lo && y <= hi)) return false;
    }
  }
  return true;
}

// Build the eBay keyword string for a part on a vehicle. Year first (eBay weights it),
// then make + model + the part term. Trim is intentionally left out of the query — it
// narrows results too aggressively and most part listings don't include it.
export function carPartQuery(v: Pick<Vehicle, 'year' | 'make' | 'model'>, part: PartDef): string {
  return `${v.year} ${v.make} ${v.model} ${part.term}`.replace(/\s+/g, ' ').trim();
}

// One part → sold comps for THIS vehicle. Single fetch; the caller handles retry/backoff
// and concurrency across the parts list (see the vehicle-scan route).
export async function getCarPartComps(
  v: Pick<Vehicle, 'year' | 'make' | 'model'>,
  part: PartDef,
  timeoutMs = 12000,
): Promise<CarCompResult> {
  const query = carPartQuery(v, part);
  const res = await fetchSoldItems(query, timeoutMs);

  if (res.status !== 'ok') return { status: res.status, comps: EMPTY, parsed: res.items.length };

  const relevant: EbayItem[] = res.items.filter(it => isRelevantCarComp(it.title, v, part.mustMatch, part.fit ?? 'model'));
  const prices = relevant.map(i => i.price).filter(p => p > 0);
  if (!prices.length) return { status: 'empty', comps: EMPTY, parsed: res.items.length };

  return { status: 'ok', comps: calcComps(prices, res.items.length), parsed: res.items.length };
}

// Exposed for offline tests.
export const __test = { isRelevantCarComp, carPartQuery, modelMatches, makeMatches };
