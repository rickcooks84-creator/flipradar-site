import { NextRequest, NextResponse } from 'next/server';
import { partsForVehicle, PULL_COST_BY_SHIP, SHIP_COST_BY_CLASS } from '@/app/lib/parts-catalog';
import { carPartCompsFromItems, carPartQuery } from '@/app/lib/car-comps';
import { scoreProduct } from '@/app/lib/scorer';
import type { Vehicle } from '@/app/lib/vehicle';
import type { EbayItem, FetchStatus, SoldComps } from '@/app/lib/ebay';

// ─── Scoring for ONE car part whose listings the extension fetched ───────────
//
// The junkyard scanner's twin of /api/comp-items. /api/vehicle-scan does the whole job
// server-side and is walled — eBay serves sold listings only to a signed-in session, and
// the server has none. When the browser extension is connected the page fetches each
// part's sold page inside the user's own eBay session and posts the listings here.
//
// The part definition is resolved server-side from `partId` rather than trusted from the
// request: mustMatch terms, the cross-fit rule and the sub-assembly price floor are what
// stop a $30 door handle from being scored as a door, and a client that could rewrite
// them could invent a profitable part out of noise.

const EMPTY: SoldComps = { found: false, count: 0, median: 0, low: 0, high: 0, avgSoldPerMonth: 0, matched: 0, scanned: 0 };

const MAX_ITEMS = 250;
const MAX_TITLE = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    year?: string; make?: string; model?: string; trim?: string;
    partId?: string; avgCost?: number; status?: FetchStatus; items?: unknown;
  };

  const { year, make, model, partId } = body;
  if (!year || !make || !model) {
    return NextResponse.json({ error: 'year, make and model are required.' }, { status: 400 });
  }
  if (!partId) return NextResponse.json({ error: 'partId required' }, { status: 400 });

  const vehicle: Vehicle = { year: String(year), make: String(make), model: String(model), trim: body.trim };
  const part = partsForVehicle(vehicle).find((p) => p.id === partId);
  if (!part) return NextResponse.json({ error: 'unknown part for this vehicle' }, { status: 400 });

  const cost = typeof body.avgCost === 'number' && body.avgCost >= 0 ? body.avgCost : (part.pull ?? PULL_COST_BY_SHIP[part.ship]);
  const shipping = SHIP_COST_BY_CLASS[part.ship];
  const query = carPartQuery(vehicle, part);

  const base = {
    id: part.id, label: part.label, category: part.category, ship: part.ship, note: part.note, query, cost,
  };

  // A refusal keeps its name. 'failed' tells the UI to offer RE-CHECK; it must never turn
  // into 'empty', which reads as "this part has no resale market" — the opposite of the
  // truth when eBay simply wouldn't show us.
  const status: FetchStatus = body.status ?? 'ok';
  if (status !== 'ok') {
    return NextResponse.json({
      parts: [{ ...base, comps: EMPTY, score: scoreProduct(cost, EMPTY, shipping), outcome: 'failed' }],
      keysExhausted: false,
      ebayBlocked: status === 'blocked',
    });
  }

  const raw = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const items: EbayItem[] = [];
  for (const it of raw) {
    const title = typeof (it as EbayItem)?.title === 'string' ? (it as EbayItem).title.slice(0, MAX_TITLE) : '';
    const price = Number((it as EbayItem)?.price);
    if (title && Number.isFinite(price) && price > 0) items.push({ title, price });
  }

  const res = carPartCompsFromItems(vehicle, part, items);

  // Zero listings parsed off a page that wasn't a refusal means the read itself was bad
  // (an interstitial, or eBay changed its layout) — not that a common part never sells.
  // The server path treats this the same way and retries; here the user re-checks.
  const outcome: 'ok' | 'empty' | 'failed' =
    res.status === 'ok' ? 'ok' : res.parsed > 0 ? 'empty' : 'failed';

  return NextResponse.json({
    parts: [{ ...base, comps: res.comps, score: scoreProduct(cost, res.comps, shipping), outcome }],
    keysExhausted: false,
    ebayBlocked: false,
  });
}
