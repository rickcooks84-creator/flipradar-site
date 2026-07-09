import { NextRequest, NextResponse } from 'next/server';
import { decodeVin, vehicleLabel, type Vehicle } from '@/app/lib/vehicle';
import { partsForVehicle, PULL_COST_BY_SHIP, SHIP_COST_BY_CLASS, type PartDef } from '@/app/lib/parts-catalog';
import { getCarPartComps, carPartQuery } from '@/app/lib/car-comps';
import { scoreProduct, type ScoreResult } from '@/app/lib/scorer';
import type { SoldComps } from '@/app/lib/ebay';

// No maxDuration override: the UI drives ONE part per request (see /api/vehicle-parts +
// the client pool), so each call finishes in a couple seconds and fits any Vercel plan's
// function limit (incl. Hobby's 10s). We deliberately DON'T set maxDuration=60 — that
// would fail the build on Hobby. A whole-vehicle batch (no `only`) still works locally.

interface PartResult {
  id: string;
  label: string;
  category: string;
  ship: string;
  note?: string;
  query: string;
  cost: number;
  comps: SoldComps;
  score: ScoreResult;
  // 'ok' = comps found · 'empty' = page read fine, nothing matched this vehicle (truly
  // no market) · 'failed' = we couldn't get a clean read after retries (re-check it).
  outcome: 'ok' | 'empty' | 'failed';
}

// Bounded-concurrency runner with retry-on-throttle. Only ~20–30 parts, so this stays
// well inside one request — no scan-state/polling needed (unlike the store scan).
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function drain() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, drain));
  return results;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let { year, make, model, trim, vin, avgCost, only } = body as {
    year?: string; make?: string; model?: string; trim?: string; vin?: string; avgCost?: number;
    only?: string[]; // optional subset of part ids — used by the UI's per-part re-check
  };

  // VIN wins if provided and the manual fields are incomplete.
  let decoded: Vehicle | null = null;
  if (vin && (!year || !make || !model)) {
    decoded = await decodeVin(vin);
    if (!decoded) {
      return NextResponse.json({ error: 'Could not decode that VIN. Enter year / make / model manually.' }, { status: 400 });
    }
    year = decoded.year; make = decoded.make; model = decoded.model;
    trim = trim || decoded.trim;
  }

  if (!year || !make || !model) {
    return NextResponse.json({ error: 'year, make and model are required (or a valid VIN).' }, { status: 400 });
  }

  const vehicle: Vehicle = {
    year: String(year), make: String(make), model: String(model), trim,
    engine: decoded?.engine, bodyClass: decoded?.bodyClass, drive: decoded?.drive, turbo: decoded?.turbo,
  };

  let parts: PartDef[] = partsForVehicle(vehicle);
  if (Array.isArray(only) && only.length) {
    const want = new Set(only);
    parts = parts.filter(p => want.has(p.id));
  }

  const globalCost = typeof avgCost === 'number' && avgCost >= 0 ? avgCost : undefined;

  let keysExhausted = false;

  const results = await runPool<PartDef, PartResult>(parts, 8, async (part) => {
    const cost = globalCost ?? part.pull ?? PULL_COST_BY_SHIP[part.ship];
    const shipping = SHIP_COST_BY_CLASS[part.ship];
    const query = carPartQuery(vehicle, part);

    // Retry throttled/error, AND retry an 'empty' that parsed ZERO items — for a common
    // car part on a real vehicle, 0 parsed almost always means eBay/ScraperAPI served a
    // soft-block/interstitial (proven: the same query returns 60 items on retry), not a
    // genuine no-comps. A REAL empty (page parsed fine but nothing matched the vehicle)
    // has parsed > 0 and is treated as final so we don't waste requests.
    // Retry budget is kept tight so a SINGLE-part request stays well under a 10s function
    // limit: at most 3 fetches (8s ceiling each) with short backoffs. The client re-checks
    // anything that still comes back 'failed'.
    let comps: SoldComps | null = null;
    let outcome: PartResult['outcome'] = 'failed';
    const MAX = 2;
    for (let attempt = 0; attempt <= MAX; attempt++) {
      const res = await getCarPartComps(vehicle, part, 8000);
      comps = res.comps;
      if (res.status === 'exhausted') { keysExhausted = true; outcome = 'failed'; break; }
      if (res.status === 'ok') { outcome = 'ok'; break; }
      if (res.status === 'empty' && res.parsed > 0) { outcome = 'empty'; break; } // genuine no-match
      outcome = 'failed';
      if (attempt < MAX) await new Promise(r => setTimeout(r, 500 * (attempt + 1) + Math.random() * 300));
    }

    const score = scoreProduct(cost, comps!, shipping);
    return {
      id: part.id, label: part.label, category: part.category, ship: part.ship, note: part.note,
      query, cost, comps: comps!, score, outcome,
    };
  });

  // Rank most-worth-pulling first.
  results.sort((a, b) => b.score.score - a.score.score);

  return NextResponse.json({
    vehicle: { ...vehicle, label: vehicleLabel(vehicle) },
    parts: results,
    keysExhausted,
    scannedAt: Date.now(),
  });
}
