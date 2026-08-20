import { NextRequest, NextResponse } from 'next/server';
import { decodeVin, vehicleLabel, type Vehicle } from '@/app/lib/vehicle';
import { partsForVehicle } from '@/app/lib/parts-catalog';
import { carPartQuery } from '@/app/lib/car-comps';

// Returns the vehicle + the list of parts that apply to it, WITHOUT comps. The client
// renders these rows immediately, then fetches comps one part at a time via
// /api/vehicle-scan (with `only:[id]`) so each request is fast and plan-safe. This
// endpoint is cheap: at most one VIN decode, no eBay calls.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let { year, make, model, trim, vin } = body as {
    year?: string; make?: string; model?: string; trim?: string; vin?: string;
  };

  let decoded: Vehicle | null = null;
  if (vin && (!year || !make || !model)) {
    decoded = await decodeVin(vin);
    if (!decoded) return NextResponse.json({ error: 'Could not decode that VIN. Enter year / make / model manually.' }, { status: 400 });
    year = decoded.year; make = decoded.make; model = decoded.model; trim = trim || decoded.trim;
  }

  if (!year || !make || !model) {
    return NextResponse.json({ error: 'year, make and model are required (or a valid VIN).' }, { status: 400 });
  }

  const vehicle: Vehicle = {
    year: String(year), make: String(make), model: String(model), trim,
    engine: decoded?.engine, bodyClass: decoded?.bodyClass, drive: decoded?.drive, turbo: decoded?.turbo,
  };

  // `query` is included so the browser extension can fetch each part's sold page inside
  // the user's eBay session. It is built HERE, with the same carPartQuery the scorer uses,
  // so the search that runs and the search that gets scored are the same string.
  const parts = partsForVehicle(vehicle).map(p => ({
    id: p.id, label: p.label, category: p.category, ship: p.ship, note: p.note,
    query: carPartQuery(vehicle, p),
  }));

  return NextResponse.json({
    vehicle: { ...vehicle, label: vehicleLabel(vehicle) },
    parts,
  });
}
