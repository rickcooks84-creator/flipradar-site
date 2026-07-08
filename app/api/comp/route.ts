import { NextRequest, NextResponse } from 'next/server';
import { getSoldComps, type EbayResult } from '@/app/lib/ebay';
import { scoreProduct } from '@/app/lib/scorer';

// POST { query, cost } → eBay sold comps + 1–100 buy score for ONE product. Called once per
// product by the store-scan UI (client pool), so each request finishes fast and fits any
// plan. Uses the store-product relevance path (getSoldComps) — brand-aware, year-agnostic.
export async function POST(req: NextRequest) {
  const { query, cost } = (await req.json().catch(() => ({}))) as { query?: string; cost?: number };
  if (!query?.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 });

  // Retry throttled/error within a tight budget so one request stays under a 10s limit.
  // Genuine 'empty' / 'exhausted' are final.
  const run = async (fn: () => Promise<EbayResult>): Promise<EbayResult> => {
    for (let a = 0; a <= 2; a++) {
      const res = await fn();
      if (res.status === 'ok' || res.status === 'empty' || res.status === 'exhausted') return res;
      if (a < 2) await new Promise(r => setTimeout(r, 500 * (a + 1) + Math.random() * 300));
    }
    return fn();
  };

  const res = await getSoldComps(query.trim(), { timeoutMs: 8000, run });
  const c = typeof cost === 'number' && cost > 0 ? cost : 0;
  const score = c > 0 && res.comps.found ? scoreProduct(c, res.comps) : null;
  const outcome = res.status === 'ok' ? 'ok' : res.status === 'empty' ? 'empty' : 'failed';

  return NextResponse.json({ comps: res.comps, score, outcome, keysExhausted: res.status === 'exhausted' });
}
