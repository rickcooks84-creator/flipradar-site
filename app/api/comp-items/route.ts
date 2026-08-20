import { NextRequest, NextResponse } from 'next/server';
import { relevantPrices, calcComps, type EbayItem, type FetchStatus } from '@/app/lib/ebay';
import { buildQuery } from '@/app/lib/ebay-dom.js';
import { scoreProduct } from '@/app/lib/scorer';

// ─── Scoring for comps the BROWSER EXTENSION fetched ─────────────────────────
//
// The sibling route, /api/comp, does the whole job server-side: it fetches eBay itself,
// parses, scores. That path is walled — eBay stopped serving sold listings to signed-out
// sessions, and a server has no signed-in session to offer. This route is the other half
// of the way around it: the extension fetched the page inside the USER's eBay session and
// the page parsed it, so what arrives here is already a list of (title, price) pairs.
//
// Everything after the fetch is identical to /api/comp on purpose. Relevance filtering
// and comp maths are the parts that decide whether a number is trustworthy, and they stay
// on the server where they can't be tampered with and where a fix reaches every user at
// once. The two routes therefore return the SAME response shape, so the scan UI doesn't
// care which one served a row.

const EMPTY = { found: false, count: 0, median: 0, low: 0, high: 0, avgSoldPerMonth: 0, matched: 0, scanned: 0 };

// A scan sends one request per product. Cap what one request may carry: an eBay results
// page holds 60 cards, so anything beyond a couple of hundred is not a real page.
const MAX_ITEMS = 250;
const MAX_TITLE = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    cost?: number;
    status?: FetchStatus;
    items?: unknown;
  };

  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

  // The extension reports how the fetch went. A refusal is terminal and must keep its
  // own name all the way to the UI: 'blocked' means we never got to look, and collapsing
  // it into an empty result would render as "no resale market" — a confident lie about a
  // product we know nothing about, and one the user would act on.
  const status: FetchStatus = body.status ?? 'ok';
  if (status !== 'ok') {
    return NextResponse.json({
      comps: EMPTY,
      score: null,
      outcome: status === 'empty' ? 'empty' : 'failed',
      keysExhausted: false,
      blocked: status === 'blocked',
    });
  }

  // Items come from the user's own browser, so they are untrusted input like any other
  // request body — validate rather than assume the extension shaped them correctly.
  const raw = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const items: EbayItem[] = [];
  for (const it of raw) {
    const title = typeof (it as EbayItem)?.title === 'string' ? (it as EbayItem).title.slice(0, MAX_TITLE) : '';
    const price = Number((it as EbayItem)?.price);
    if (title && Number.isFinite(price) && price > 0) items.push({ title, price });
  }

  // buildQuery is the same function the page used to build the eBay search, so the tokens
  // scored here describe exactly the search that was run.
  const { tokens } = buildQuery(query);
  const prices = relevantPrices(items, tokens).filter((p) => p > 0);

  // Parsed the page fine, but nothing on it was the same product → genuinely no market.
  if (!prices.length) {
    return NextResponse.json({ comps: EMPTY, score: null, outcome: 'empty', keysExhausted: false, blocked: false });
  }

  const comps = calcComps(prices, items.length);
  const c = typeof body.cost === 'number' && body.cost > 0 ? body.cost : 0;
  const score = c > 0 ? scoreProduct(c, comps) : null;

  return NextResponse.json({ comps, score, outcome: 'ok', keysExhausted: false, blocked: false });
}
