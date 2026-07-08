// ─── Vehicle identity + VIN decode ───────────────────────────────────────────
//
// At a junkyard you're standing in front of a whole car, not a shelf. The user
// enters the vehicle (year / make / model) — or pastes the VIN and we auto-fill it.
// VIN decoding uses the U.S. NHTSA vPIC API, which is FREE and needs no API key:
//   https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json
// It returns a single flat record with ModelYear, Make, Model, Trim, engine, body
// class, etc. We normalize that into the small shape the parts scanner needs.

export interface Vehicle {
  year: string;      // "2013"
  make: string;      // "Ford" (title-cased)
  model: string;     // "F-150"
  trim?: string;     // "XLT"
  engine?: string;   // "3.5L V6" (built from displacement + cylinders when present)
  bodyClass?: string;// "Pickup"
  drive?: string;    // "4WD"
  turbo?: boolean;   // engine is turbo/forced-induction (gates turbo-only parts)
}

// Title-case a NHTSA value ("FORD" → "Ford", "GMC" stays GMC-ish). Keep short
// all-caps tokens (make acronyms like GMC, BMW, RAM) uppercase.
function titleCase(s: string): string {
  return (s || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(w => (w.length <= 3 && /^[a-z]+$/.test(w) && ['gmc', 'bmw', 'ram', 'kia'].includes(w))
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildEngine(fields: Record<string, string>): string | undefined {
  const disp = fields.DisplacementL ? `${parseFloat(fields.DisplacementL).toFixed(1)}L` : '';
  const cyl  = fields.EngineCylinders ? `${fields.EngineCylinders}cyl` : '';
  const parts = [disp, cyl].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

// A VIN is 17 chars, no I/O/Q. We don't hard-fail on format (NHTSA tolerates
// partial VINs and returns what it can) but we do a light sanity check.
export function looksLikeVin(vin: string): boolean {
  const v = (vin || '').trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(v);
}

export async function decodeVin(vin: string): Promise<Vehicle | null> {
  const clean = (vin || '').trim().toUpperCase();
  if (!looksLikeVin(clean)) return null;

  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(clean)}?format=json`;
  let data: any;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const f: Record<string, string> = data?.Results?.[0] ?? {};
  const year = (f.ModelYear || '').trim();
  const make = titleCase(f.Make || '');
  const model = titleCase(f.Model || '');
  // Need at least make+model+year to be useful.
  if (!make || !model || !year) return null;

  const fuel = (f.FuelTypePrimary || '').toLowerCase();
  const turbo = /turbo/i.test(f.Turbo || '') || /turbo/i.test(f.OtherEngineInfo || '') ||
    (f.ForcedInductionType || '').toLowerCase().includes('turbo');

  return {
    year,
    make,
    model,
    trim: f.Trim ? titleCase(f.Trim) : undefined,
    engine: buildEngine(f),
    bodyClass: f.BodyClass ? titleCase(f.BodyClass) : undefined,
    drive: f.DriveType || undefined,
    turbo: turbo || undefined,
    ...(fuel ? {} : {}),
  };
}

// A clean, human-readable vehicle label for headings.
export function vehicleLabel(v: Pick<Vehicle, 'year' | 'make' | 'model' | 'trim'>): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
}
