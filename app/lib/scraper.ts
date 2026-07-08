import * as cheerio from 'cheerio';

export interface ScrapedProduct {
  name: string;
  price: number | null;    // null = not visible, user must enter
  imageUrl: string;
  productUrl: string;
  ebayQuery: string;       // pre-built search query optimized for eBay sold comps
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) || val <= 0 ? null : val;
}

function absoluteUrl(href: string, base: string): string {
  try { return new URL(href, base).href; } catch { return href; }
}

// ─── Generic eBay query builder (works for any site) ─────────────────────────

// Convert URL path slug to keywords: "/products/equip-prime-protein-chocolate" → "equip prime protein chocolate"
function slugToKeywords(productUrl: string): string {
  try {
    const path = new URL(productUrl).pathname;
    const parts = path.split('/').filter(p => p && !/^\d+$/.test(p));
    const slug = parts[parts.length - 1] ?? '';
    return slug
      .replace(/[^a-z0-9-]/gi, '-')
      .replace(/-+/g, ' ')
      .replace(/\b\w{1,1}\b/g, '') // drop single-char words like "x"
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  } catch { return ''; }
}

// Brand hint from the site's domain: "equipfoods.com" → "equipfoods"
function brandFromDomain(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/-/g, ' ').trim().toLowerCase();
  } catch { return ''; }
}

// Strip collab/crossover prefixes: "Masa x Equip: ProductName" → "ProductName"
function stripCollabPrefix(name: string): string {
  return name.replace(/^.+?\s+x\s+.+?:\s*/i, '').trim();
}

// ─── Resellability filter ─────────────────────────────────────────────────────
// Storefronts list lots of "products" that aren't physical resellable goods: gift cards,
// subscriptions, fees/surcharges, deposits, tips, donations, warranties, and services like
// classes/workshops/tickets. Running these through eBay produces pure noise (a "Gift Card"
// matches gift cards, "Intro to Roasting" matches roasting pans). We skip them entirely so
// the scan only scores things a reseller could actually buy and flip.
const NON_PRODUCT_PHRASES = [
  'gift card', 'giftcard', 'gift certificate', 'e-gift', 'egift',
  'subscription', 'subscribe', 'tariff', 'surcharge', 'restocking',
  'deposit', 'gratuity', 'donation', 'donate', 'warranty', 'protection plan',
  'workshop', 'seminar', 'webinar', 'masterclass', 'consultation',
  'booking', 'reservation', 'appointment',
];
const NON_PRODUCT_WORDS = new Set([
  'fee', 'fees', 'tip', 'tips', 'shipping', 'freight', 'handling', 'class', 'classes',
  'course', 'courses', 'lesson', 'lessons', 'ticket', 'tickets', 'training',
  'intro', 'basics',
]);

export function isResellable(name: string): boolean {
  const n = (name || '').toLowerCase().trim();
  if (!n) return false;
  for (const p of NON_PRODUCT_PHRASES) if (n.includes(p)) return false;
  const words = n.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  for (const w of words) if (NON_PRODUCT_WORDS.has(w)) return false;
  return true;
}

// Apparel size codes + free-weight/volume option values. A product's resale comps don't
// change by T-shirt size or bag weight, so these variant labels are noise in an eBay query
// — and worse, appending them splits ONE product into many different searches (a hoodie
// scored 7 different ways by size). We detect them so the query collapses to the base
// product: more accurate, consistent across variants, and (via query memoization) faster.
const APPAREL_SIZES = new Set([
  'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'xxxxl', '2xl', '3xl', '4xl', '5xl',
  'sm', 'med', 'lg', 'small', 'medium', 'large', 'xlarge', 'x-large', 'one size', 'os',
]);
function isSizeOrWeightVariant(v: string): boolean {
  const s = (v || '').toLowerCase().trim();
  if (!s || s === 'default title') return true;
  if (APPAREL_SIZES.has(s)) return true;
  // Pure weights/volumes: "12 oz", "2 lb", "5lb", "500 ml", "1kg", "12.0", "60 count".
  if (/^[\d][\d.,\s/-]*(oz|ounces?|lb|lbs|pound|pounds|g|grams?|kg|ml|l|liters?|litres?|ct|count|pk|pack|servings?|cups?)?\.?$/.test(s)) return true;
  return false;
}

/**
 * Build the best possible eBay search query for a product.
 * Priority: URL slug (most reliable) > cleaned display name.
 * Prepends vendor/brand if not already present.
 */
export function buildEbayQuery(
  displayName: string,
  productUrl: string,
  siteUrl: string,
  vendor?: string, // explicit brand (e.g. from Shopify vendor field)
  variantTitle?: string,
): string {
  const slug = slugToKeywords(productUrl);
  const slugWords = slug.split(' ').filter(Boolean);

  // Choose base: slug if it has 4+ meaningful words, else cleaned display name
  let base = slugWords.length >= 4 ? slug : stripCollabPrefix(displayName).toLowerCase();

  // Append a variant label ONLY when it's a real differentiator (flavor, color, model) —
  // never a size or weight. Sizes/weights don't change resale comps and fragment one
  // product into many divergent searches, so they collapse to the base product query.
  if (variantTitle && !isSizeOrWeightVariant(variantTitle)) {
    const vLower = variantTitle.toLowerCase();
    if (!base.includes(vLower.split(' ')[0])) {
      base = `${base} ${vLower}`;
    }
  }

  // Prepend the brand if not already present — but ONLY its first token, never the full
  // multi-word store name. Prepending "redhawk coffee roasters …" would shove the store's
  // own words ("coffee", "roasters") into the query, where they masquerade as product
  // identity and skew relevance for every item. One brand token is enough to bias eBay's
  // ranking; the relevance layer treats it as a soft signal, not a hard requirement.
  const brand = (vendor || brandFromDomain(siteUrl)).toLowerCase();
  const brandFirst = brand.split(/\s+/)[0];
  if (brandFirst && brandFirst.length > 2 && !base.includes(brandFirst)) {
    base = `${brandFirst} ${base}`;
  }

  return base.replace(/\s+/g, ' ').trim().slice(0, 100);
}

// ─── Shopify JSON API (returns every product + variant with brand/price) ──────

async function tryShopifyJson(
  startUrl: string,
  maxPages: number,
  onProgress?: (msg: string) => void,
): Promise<ScrapedProduct[] | null> {
  const parsed = new URL(startUrl);
  const origin = parsed.origin;

  const collMatch = parsed.pathname.match(/\/collections\/[^/]+/);
  const apiBase = collMatch
    ? `${origin}${collMatch[0]}/products.json`
    : `${origin}/products.json`;

  const products: ScrapedProduct[] = [];
  let page = 1;

  while (page <= maxPages) {
    onProgress?.(`Fetching Shopify products page ${page}…`);
    let data: any;
    try {
      const res = await fetch(`${apiBase}?limit=250&page=${page}`, { headers: HEADERS });
      if (!res.ok) return null;
      data = await res.json();
    } catch { return null; }

    const items: any[] = data?.products ?? [];
    if (!items.length) break;

    for (const p of items) {
      const title: string    = p.title ?? '';
      const vendor: string   = (p.vendor ?? '').trim();
      const handle: string   = p.handle ?? '';
      const productUrl       = `${origin}/products/${handle}`;
      const imageUrl: string = p.images?.[0]?.src ?? '';
      const variants: any[]  = p.variants ?? [];

      if (variants.length <= 1) {
        const vTitle = variants[0]?.title ?? '';
        const price  = parseFloat(variants[0]?.price ?? '0') || null;
        products.push({
          name: title,
          price: price && price > 0 ? price : null,
          imageUrl,
          productUrl,
          ebayQuery: buildEbayQuery(title, productUrl, startUrl, vendor, vTitle),
        });
      } else {
        for (const v of variants) {
          const vTitle: string = v.title ?? '';
          const displayName = !vTitle || vTitle.toLowerCase() === 'default title'
            ? title
            : `${title} - ${vTitle}`;
          const price = parseFloat(v.price ?? '0') || null;
          products.push({
            name: displayName,
            price: price && price > 0 ? price : null,
            imageUrl,
            productUrl,
            ebayQuery: buildEbayQuery(title, productUrl, startUrl, vendor, vTitle),
          });
        }
      }
    }

    if (items.length < 250) break;
    page++;
    if (page <= maxPages) await sleep(1200);
  }

  return products.length > 0 ? products : null;
}

// ─── JSON-LD schema.org extraction ───────────────────────────────────────────

function extractJsonLd(html: string, baseUrl: string): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];
  const $ = cheerio.load(html);
  const seen = new Set<string>();

  const pushProduct = (item: any) => {
    const name = item.name ?? '';
    if (!name) return;
    const image = Array.isArray(item.image) ? item.image[0] : (item.image ?? '');
    const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
    const rawPrice = offer?.price ?? offer?.lowPrice ?? null;
    const price = rawPrice != null ? (parseFloat(rawPrice) || null) : null;
    const url = absoluteUrl(item.url ?? offer?.url ?? '', baseUrl);
    const key = url || name;
    if (seen.has(key)) return;
    seen.add(key);
    products.push({
      name, price, imageUrl: image, productUrl: url,
      ebayQuery: buildEbayQuery(name, url, baseUrl),
    });
  };

  // Recursively walk JSON-LD nodes. Products can sit at the top level, inside an
  // @graph, or nested under CollectionPage→mainEntity→ItemList→itemListElement
  // (common on Next.js stores like Lenskart). Walk all of those.
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }

    const type = String(node['@type'] ?? '').toLowerCase();
    if (type === 'product') pushProduct(node);

    if (node['@graph']) walk(node['@graph']);
    if (node.mainEntity) walk(node.mainEntity);

    if (Array.isArray(node.itemListElement)) {
      for (const entry of node.itemListElement) {
        if (!entry) continue;
        const inner = entry.item ?? entry;
        const itype = String(inner['@type'] ?? '').toLowerCase();
        if (itype === 'product') pushProduct(inner);
        else if (inner.name && inner.url) pushProduct(inner); // ListItem product ref
        else walk(inner); // skips breadcrumbs (name but no url) harmlessly
      }
    }
  };

  $('script[type="application/ld+json"]').each((_, el) => {
    try { walk(JSON.parse($(el).html() ?? '')); } catch {}
  });

  return products;
}

// ─── Heuristic HTML extraction ────────────────────────────────────────────────

function extractHeuristic(html: string, baseUrl: string): ScrapedProduct[] {
  const $ = cheerio.load(html);
  const products: ScrapedProduct[] = [];

  const cardSelectors = [
    '[data-product-id]', '[data-item-id]', '[data-product]',
    '.product-card', '.product-item', '.product-tile', '.product-grid-item',
    '.item-card', '.listing-item', '.product', 'li.product',
    '[class*="ProductCard"]', '[class*="product-card"]', '[class*="productCard"]',
    '[class*="item-tile"]', '[class*="ItemCard"]',
  ];
  const titleSelectors = ['h2', 'h3', 'h4', '.product-title', '.product-name', '[class*="title"]', '[class*="name"]', 'a[title]'];
  const priceSelectors = ['.price', '[class*="price"]', '[data-price]', 'span[itemprop="price"]'];
  const imageSelectors = ['img[src]', 'img[data-src]', 'img[data-lazy-src]'];

  const seen = new Set<string>();

  for (const cardSel of cardSelectors) {
    const cards = $(cardSel);
    if (cards.length < 2) continue;

    cards.each((_, card) => {
      const $card = $(card);
      let name = '';
      for (const sel of titleSelectors) {
        const t = $card.find(sel).first().text().trim() || $card.find(sel).first().attr('title')?.trim() || '';
        if (t.length > 3) { name = t; break; }
      }
      if (!name || seen.has(name)) return;
      seen.add(name);

      let price: number | null = null;
      for (const sel of priceSelectors) {
        const raw = $card.find(sel).first().text().trim();
        if (raw) { price = parsePrice(raw); if (price) break; }
      }

      let imageUrl = '';
      for (const sel of imageSelectors) {
        const img = $card.find(sel).first();
        imageUrl = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
        if (imageUrl && !imageUrl.startsWith('data:')) { imageUrl = absoluteUrl(imageUrl, baseUrl); break; }
      }

      let productUrl = baseUrl;
      const link = $card.find('a[href]').first().attr('href');
      if (link) productUrl = absoluteUrl(link, baseUrl);

      products.push({
        name, price, imageUrl, productUrl,
        ebayQuery: buildEbayQuery(name, productUrl, baseUrl),
      });
    });

    if (products.length >= 5) break;
  }

  return products;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function findNextPageUrl(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);
  const selectors = [
    'a[rel="next"]', 'a.next', 'a.next-page', 'a[class*="next"]',
    '[aria-label="Next page"] a', '[aria-label="Next"] a',
    'li.next a', '.pagination a:last-child',
  ];
  for (const sel of selectors) {
    const href = $(sel).first().attr('href');
    if (href && !href.startsWith('#')) return absoluteUrl(href, baseUrl);
  }
  return null;
}

// ─── Public ───────────────────────────────────────────────────────────────────

export async function scrapeProducts(
  startUrl: string,
  maxPages = 10,
  onProgress?: (msg: string) => void,
): Promise<ScrapedProduct[]> {
  // Shopify JSON API — all products + variants with vendor brand context
  const shopifyProducts = await tryShopifyJson(startUrl, maxPages, onProgress);
  if (shopifyProducts) {
    // Check the URL slug too — disguised non-products name themselves innocuously but the
    // handle gives them away ("City Drug" → /products/additional-fees, "Milk Science" →
    // /products/copy-of-intro-to-roasting).
    const sellable = shopifyProducts.filter(p =>
      isResellable(p.name) && isResellable(slugToKeywords(p.productUrl)));
    const dropped = shopifyProducts.length - sellable.length;
    onProgress?.(`Shopify: found ${sellable.length} products/variants` +
      (dropped ? ` (skipped ${dropped} non-resellable: gift cards, fees, subscriptions…)` : ''));
    return sellable;
  }

  // Generic HTML scraping fallback (any other site)
  const all: ScrapedProduct[] = [];
  const seen = new Set<string>();
  let url: string | null = startUrl;
  let page = 0;

  while (url && page < maxPages) {
    page++;
    onProgress?.(`Fetching page ${page}…`);
    let html: string;
    try { html = await fetchPage(url); }
    catch (e: any) { onProgress?.(`Page ${page} failed: ${e.message}`); break; }

    let products = extractJsonLd(html, url);
    if (products.length < 2) products = extractHeuristic(html, url);
    onProgress?.(`Page ${page}: found ${products.length} products`);

    for (const p of products) {
      const key = p.productUrl || p.name;
      if (!seen.has(key)) { seen.add(key); all.push(p); }
    }

    url = findNextPageUrl(html, url);
    if (url && page < maxPages) await sleep(1200);
  }

  return all.filter(p => isResellable(p.name));
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
