// ─── Car-part eBay comps (year + model aware) ────────────────────────────────
//
// The store-product relevance in ebay.ts is tuned for branded catalog items and
// deliberately IGNORES bare numbers. Car parts are the opposite: the model YEAR and
// MODEL CODE are the entire identity — a 2013 F-150 tail light must not comp against a
// 2005 one. So we fetch the raw sold items (fetchSoldItems keeps the year in the query)
// and apply our own relevance here:
//   1. the comp title must contain the PART identity (one of the part's mustMatch words),
//   2. it must contain the vehicle MODEL (compared with punctuation collapsed: "F-150"
//      == "F150" == "F 150"),
//   3. if the title mentions any years, the vehicle year must fall inside that range
//      (±1 to allow generation overlap). Titles with no year still count (many omit it).

import { fetchSoldItems, calcComps, type EbayItem, type SoldComps, type FetchStatus } from './ebay';
import type { PartDef } from './parts-catalog';
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

function isRelevantCarComp(
  title: string,
  v: Pick<Vehicle, 'year' | 'make' | 'model'>,
  mustMatch: string[],
): boolean {
  const t = title.toLowerCase();
  const collapsed = collapse(t);
  const tokens = new Set(t.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean));

  // 1) Part identity — the listing must actually be this part.
  if (!mustMatch.some(m => tokens.has(m) || collapsed.includes(m))) return false;

  // 2) Model fit — collapse punctuation so "F-150" / "F150" / "F 150" all match.
  const modelC = collapse(v.model);
  const modelOk = modelC.length >= 2 ? collapsed.includes(modelC) : tokens.has(modelC);
  if (!modelOk) return false;

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

  const relevant: EbayItem[] = res.items.filter(it => isRelevantCarComp(it.title, v, part.mustMatch));
  const prices = relevant.map(i => i.price).filter(p => p > 0);
  if (!prices.length) return { status: 'empty', comps: EMPTY, parsed: res.items.length };

  return { status: 'ok', comps: calcComps(prices, res.items.length), parsed: res.items.length };
}

// Exposed for offline tests.
export const __test = { isRelevantCarComp, carPartQuery };
