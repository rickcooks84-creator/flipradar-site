import { NextRequest, NextResponse } from 'next/server';
import { scrapeProducts } from '@/app/lib/scraper';

// POST { url } → scrape the store's products (names, prices, images, eBay queries) WITHOUT
// comps. The client then fetches comps one product per request via /api/comp, so this stays
// a single quick call and the whole flow fits any Vercel plan's function limit. Pages are
// capped so the scrape returns fast; the product list is capped to keep the comp sweep sane.
const MAX_PAGES = 4;      // Shopify returns 250/page → up to 1000 fetched; keeps scrape < ~5s
const MAX_PRODUCTS = 500; // matches the "500+ products per scan" promise (was 100)

export async function POST(req: NextRequest) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!url || !/^https?:\/\//i.test(url.trim())) {
    return NextResponse.json({ error: 'Enter a full store URL starting with https://' }, { status: 400 });
  }

  try {
    const products = await scrapeProducts(url.trim(), MAX_PAGES);
    if (!products.length) {
      return NextResponse.json({ error: 'No products found. Point at a category/collection page, not the homepage.' }, { status: 200 });
    }
    const items = products.slice(0, MAX_PRODUCTS).map((p, i) => ({
      id: String(i),
      name: p.name,
      price: p.price,
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      ebayQuery: p.ebayQuery || p.name,
    }));
    return NextResponse.json({ products: items, total: products.length, capped: products.length > MAX_PRODUCTS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not scrape that URL.' }, { status: 500 });
  }
}
