import { NextRequest, NextResponse } from 'next/server';
import { decodeVin } from '@/app/lib/vehicle';

// GET /api/vin?vin=1FTFW1ET5DFC10312 → { year, make, model, trim, engine, ... }
export async function GET(req: NextRequest) {
  const vin = req.nextUrl.searchParams.get('vin') || '';
  if (!vin.trim()) return NextResponse.json({ error: 'vin required' }, { status: 400 });

  const v = await decodeVin(vin);
  if (!v) return NextResponse.json({ error: 'Could not decode that VIN. Enter year / make / model manually.' }, { status: 400 });

  return NextResponse.json(v);
}
