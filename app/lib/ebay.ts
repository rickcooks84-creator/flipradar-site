import * as cheerio from 'cheerio';
import { unstable_cache } from 'next/cache';
import { isStopSignaled } from './stop-signal';

export interface SoldComps {
  found: boolean;
  count: number;        // number of relevant comps used
  median: number;
  low: number;
  high: number;
  avgSoldPerMonth: number;
  matched: number;      // relevant comps before outlier trim (diagnostics)
  scanned: number;      // total listings parsed off the page (diagnostics)
}

const EMPTY: SoldComps = { found: false, count: 0, median: 0, low: 0, high: 0, avgSoldPerMonth: 0, matched: 0, scanned: 0 };

// Outcome of a single eBay fetch. The scan scheduler uses `status` to drive adaptive
// backoff: THROTTLED → slow down + retry; EMPTY/OK → genuine result, cache it; ERROR →
// transient network/timeout, retry a bounded number of times.
// 'exhausted' = every ScraperAPI key is out of credits → the scan can't continue and
// the scheduler should stop issuing requests (terminal, not retryable).
// 'blocked'   = eBay served a sign-in wall instead of results (see isSignInWall). Also
// terminal: no amount of retrying or backing off opens it, and it must NEVER be
// downgraded to 'empty' — an empty result reads as "this item has no resale market",
// which is a confident lie when the truth is "we never got to look".
export type FetchStatus = 'ok' | 'empty' | 'throttled' | 'error' | 'exhausted' | 'blocked';


export interface EbayResult {
  status: FetchStatus;
  comps: SoldComps;     // EMPTY unless status === 'ok'
}

export interface EbayItem { title: string; price: number; }

// Match whatever the installed cheerio version's load() returns (older @types/cheerio
// returns `Root`, newer returns `CheerioAPI`) so this stays version-agnostic.
type Cheerio$ = ReturnType<typeof cheerio.load>;


// ─── Fetch eBay SOLD-results HTML via ScraperAPI ─────────────────────────────
//
// WHY ScraperAPI (not the user's machine): eBay sold-comp lookups must scale to large
// catalogs (10k+ products) and must NEVER come from the user's home IP — fetching
// thousands of eBay pages from one residential IP gets it rate-limited / soft-blocked,
// and is the bottleneck that capped the old in-app scraper at ~50 products. ScraperAPI
// fetches the page through its OWN rotating proxy pool, so:
//   • requests never originate from the user's IP (no bans / throttling on their end),
//   • it never touches the user's eBay account (it's ScraperAPI's anonymous request),
//   • we can run many concurrent lookups and handle huge stores.
// It returns the SAME eBay sold-results HTML the old engine fetched (verified: real
// "sold" cards with sold dates), so all downstream parsing/relevance logic is unchanged.

interface RawResponse { status: number; ok: boolean; html: string; }

// ─── ScraperAPI key POOL ─────────────────────────────────────────────────────
// We run on ScraperAPI's FREE tier, where each key has a small monthly credit budget
// and a low concurrency limit. To scan large catalogs we pool multiple keys:
//   • round-robin across keys, capping in-flight requests per key (PER_KEY_CONC),
//   • when a key runs out of credits (ScraperAPI 403 / "credit"/"limit" body), RETIRE
//     it for the rest of the session and fall through to the next key,
//   • report 'exhausted' only when every key is retired (the scan then ends gracefully).
// Keys come from SCRAPERAPI_KEYS (comma-separated); SCRAPERAPI_KEY (single) is a fallback.

const PER_KEY_CONC = Math.max(1, parseInt(process.env.SCRAPERAPI_PER_KEY_CONCURRENCY || '5', 10) || 5);

interface KeyState { key: string; inFlight: number; retired: boolean; }

const KEY_POOL: KeyState[] = (() => {
  const raw = (process.env.SCRAPERAPI_KEYS || process.env.SCRAPERAPI_KEY || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(raw)].map(key => ({ key, inFlight: 0, retired: false }));
})();

let rrCursor = 0;

// Pick the next usable key with spare per-key capacity, round-robin. Returns null if
// every live key is currently at its concurrency cap (caller should wait + retry),
// or undefined-via-allRetired if every key is exhausted.
function acquireKey(): KeyState | null {
  const n = KEY_POOL.length;
  for (let i = 0; i < n; i++) {
    const ks = KEY_POOL[(rrCursor + i) % n];
    if (!ks.retired && ks.inFlight < PER_KEY_CONC) {
      rrCursor = (rrCursor + i + 1) % n;
      ks.inFlight++;
      return ks;
    }
  }
  return null; // all live keys busy (or none live — check allKeysExhausted)
}

function allKeysExhausted(): boolean {
  return KEY_POOL.length === 0 || KEY_POOL.every(k => k.retired);
}

// ScraperAPI signals a depleted free key with HTTP 403 (and/or a body mentioning
// credits/limit). 429 = momentary concurrency cap (retry, don't retire).
function isCreditExhausted(status: number, body: string): boolean {
  if (status === 403) return true;
  if (status === 401) return true; // bad/disabled key
  return /credit|exceeded the .* limit|out of .* requests|payment required/i.test(body.slice(0, 500));
}

// ─── Desktop (Electron) fetch bridge — FREE, no ScraperAPI ────────────────────
//
// On the DESKTOP build the Next server runs as a child process forked by Electron
// (electron/main.cjs). Rather than spend ScraperAPI credits, we fetch eBay's sold HTML for
// FREE through the Electron main process: it holds a dedicated ANONYMOUS eBay partition
// (guest cookies only — NEVER the user's account) plus a Chromium net.request, and answers
// {type:'ebay-search'} messages over the fork IPC channel (see processEbaySearch/
// fetchEbayHtml in main.cjs — already shipping). This keeps every desktop user off our
// ScraperAPI budget entirely. The WEB build has no Electron parent (process.send is
// undefined and the flag is unset), so it stays on the ScraperAPI path below — the SAME
// file drives both, gated purely by env, so web + desktop ebay.ts remain byte-identical.
const IS_DESKTOP = process.env.FLIPSONAR_DESKTOP === '1' && typeof process.send === 'function';

const ipcPending = new Map<number, (v: RawResponse | null) => void>();
let ipcSeq = 0;
let ipcReady = false;
function ensureIpcListener(): void {
  if (ipcReady) return;
  ipcReady = true;
  // Electron main replies with { id, data: { status, ok, html } | null }; match it to the
  // pending request by id and ignore anything else on the channel.
  process.on('message', (msg: any) => {
    const resolve = msg && typeof msg.id === 'number' ? ipcPending.get(msg.id) : undefined;
    if (!resolve) return;
    const d = msg.data;
    resolve(d ? { status: d.status, ok: !!d.ok, html: d.html || '' } : null);
  });
}

// Ask Electron main to fetch one eBay URL; returns the same {status, ok, html} | null shape
// as the ScraperAPI fetchRaw so the rest of the pipeline is unchanged. The safety timeout is
// generous because main warms up eBay's guest cookies on the FIRST request (one-time), which
// can take several seconds before the fetch itself runs.
function fetchViaElectron(targetUrl: string, timeoutMs: number): Promise<RawResponse | null> {
  ensureIpcListener();
  return new Promise((resolve) => {
    const id = ++ipcSeq;
    let done = false;
    const finish = (v: RawResponse | null) => {
      if (done) return;
      done = true;
      ipcPending.delete(id);
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs + 12000);
    ipcPending.set(id, finish);
    try {
      (process.send as (m: any) => void)({ type: 'ebay-search', id, url: targetUrl, timeoutMs });
    } catch {
      finish(null);
    }
  });
}

if (IS_DESKTOP) console.log('[ebay] comp engine = Electron (desktop) — free, no ScraperAPI');

function fetchRaw(targetUrl: string, timeoutMs: number): Promise<RawResponse | null> {
  if (isStopSignaled()) return Promise.resolve(null);
  if (IS_DESKTOP) return fetchViaElectron(targetUrl, timeoutMs); // desktop: free, from the user's machine
  if (allKeysExhausted()) return Promise.resolve({ status: 402, ok: false, html: 'all-keys-exhausted' });

  const ks = acquireKey();
  if (!ks) return Promise.resolve(null); // every key at capacity → caller retries (throttled)

  // render=false is CRITICAL for speed: eBay's sold-results HTML is server-rendered, so
  // we don't need ScraperAPI to spin up a headless browser. Benchmarked on a live eBay
  // sold search: default (render on) ≈ 9900ms/request; render=false ≈ 1200ms/request —
  // ~8x faster with IDENTICAL results (same 62 sold cards). This is the main scan-speed
  // lever. country_code=us keeps results consistent (and avoids geo-routing delays).
  const endpoint =
    'https://api.scraperapi.com/?api_key=' + encodeURIComponent(ks.key) +
    '&render=false&country_code=us' +
    '&url=' + encodeURIComponent(targetUrl);


  return (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, { signal: controller.signal });
      const status = res.status;
      const html = await res.text();
      if (isCreditExhausted(status, html)) {
        ks.retired = true; // retire this key for the session; caller will retry on next key
        console.log('[ebay] ScraperAPI key retired (status=%d). %d/%d keys live.',
          status, KEY_POOL.filter(k => !k.retired).length, KEY_POOL.length);
        return null; // treat as retryable so the scheduler re-issues on a fresh key
      }
      return { status, ok: res.ok, html };
    } catch {
      return null; // timeout / network → retryable error
    } finally {
      clearTimeout(timer);
      ks.inFlight--;
    }
  })();
}



// ─── HTML parsing (cheerio, in-process) ──────────────────────────────────────

function parsePrice(raw: string): number | null {
  if (!raw || raw.indexOf(' to ') !== -1) return null; // skip price ranges like "$5 to $9"
  const m = raw.match(/[\d,]+\.?\d*/);
  if (!m) return null;
  const p = parseFloat(m[0].replace(/,/g, ''));
  return p >= 1 && p < 5000 ? p : null;
}

// eBay's "SORRY / Error Page" / bot challenge / consent interstitials. When we get one
// the data is worthless AND it signals throttling — the scheduler must back off, not
// cache a false "0 comps".
function isThrottlePage(html: string, $: Cheerio$): boolean {

  const title = ($('title').first().text() || '').toLowerCase();
  if (/error page|interruption|are you a human|robot|access denied|pardon our interruption|unusual traffic/.test(title)) return true;
  if (/pardon the interruption|verify you('| a)re a human|unusual activity from your/i.test(html.slice(0, 4000))) return true;
  return false;
}

// eBay's SIGN-IN WALL on sold/completed searches.
//
// As of 2026-08 eBay gates completed-listing results (LH_Sold / LH_Complete) behind a
// login: a signed-out request to a sold search 200s but returns the "Sign in or Register"
// page instead of results. Verified to be SESSION-based, not IP- or proxy-based — a
// residential IP with a warmed cookie jar and full browser headers gets the same wall,
// while the identical search WITHOUT the sold filters still returns results normally.
//
// This is the single nastiest failure mode this file can have, because the wall is a
// 200 with zero result cards — indistinguishable from "this product genuinely never sold"
// unless we look for it. Left undetected it makes the scanner report NO MARKET on every
// product of a store with daily sales, which is exactly backwards from the truth and is
// worse than an outright error: the user acts on it.
function isSignInWall(html: string, $: Cheerio$): boolean {
  const title = ($('title').first().text() || '').toLowerCase();
  if (/sign in or register/.test(title)) return true;
  // Redirect landed on the signin host (captured in the canonical/og URL of the page).
  if (/https:\/\/signin\.ebay\.[a-z.]+\//i.test(html.slice(0, 4000))) return true;
  return false;
}

// When a search has FEW or NO exact matches, eBay pads the page with a
// "Results matching fewer words" / "No exact matches found" section of FUZZY filler —
// different brands and generic same-category items. A search for an LGNDRY "Lana" long
// sleeve crop top with ZERO exact sold matches gets padded with random $8 Gymshark /
// Free People crop tops; counting those as comps invents a whole fake sold history
// (fake median, fake "52 sold", fake ROI) for a product that has no eBay resale market.
// This filler must NEVER be treated as sold comps.
//
// eBay renders that divider as a section HEADING *between* result cards (a
// `section-notice__main` span), NOT inside an `<li.s-card>`, so the per-card text check
// in parseItems never sees it and every filler card after it gets scraped. Real exact
// matches are always rendered BEFORE the divider, so we cut the HTML at the first divider
// marker before parsing: good queries (no divider) keep every card unchanged; zero/low-
// match queries drop all the filler. Verified on live eBay — bad query → 0 comps (correct),
// 62-match query has no divider → all kept (no regression).
const FUZZY_DIVIDER = /No exact matches found|Results matching fewer words|Results that closely match|matching fewer words/i;
function stripFuzzyFiller(html: string): string {
  const m = FUZZY_DIVIDER.exec(html);
  return m ? html.slice(0, m.index) : html;
}

// Pull (title, price) pairs from the sold-results HTML. eBay serves THREE card layouts
// depending on the session/rollout, and we must handle all of them or comps silently go to
// zero when eBay flips a layout:
//   • legacy  <li class="s-item">          (title .s-item__title, price .s-item__price)
//   • interim <li class="s-card">          (title .s-card__title,  price .s-card__price)
//   • newer   <div class="su-card-container"> (title .su-item-card__title, price .su-item-card__price)
// The anonymous Electron/desktop session tends to get the NEW su-card layout; ScraperAPI
// tends to get the legacy one — but eBay A/B-tests these, so we parse whichever appears.
// The caller passes HTML already truncated at the fuzzy-match divider (see stripFuzzyFiller);
// we additionally break on the divider per-card as defense-in-depth, and skip the "Shop on
// eBay" promo placeholder card.
function parseItems(html: string, $: Cheerio$): EbayItem[] {

  const items: EbayItem[] = [];
  const cards = $('li.s-card, li.s-item, .su-card-container');

  cards.each((_, el) => {
    const $el = $(el);
    const etext = $el.text();
    if (/Results matching fewer words/i.test(etext) || /Results that closely match/i.test(etext)) {
      return false; // break: stop at the relevance divider
    }
    const title = (
      $el.find('.s-card__title, .s-item__title, .su-item-card__title').first().text() ||
      $el.find('[class*="title"]').first().text() ||
      ''
    ).trim();
    if (!title || /Shop on eBay/i.test(title)) return;

    const priceText = (
      $el.find('.s-card__price, .s-item__price, .su-item-card__price').first().text() ||
      $el.find('[class*="price"]').first().text() ||
      ''
    ).trim();
    const price = parsePrice(priceText);
    if (price == null) return;

    items.push({ title, price });
  });

  return items;
}

// ─── Relevance scoring (replaces the single brand-word `includes` gate) ──────
//
// The old gate kept a comp only if it contained the brand word — too loose (any
// "equip ..." listing passed, even unrelated products) AND too strict (multi-word
// brands, collabs, or sites where the domain ≠ the eBay brand dropped everything).
// New approach: token-overlap. A comp is relevant if it shares ENOUGH of the query's
// significant words with the listing title. This naturally requires the brand AND
// product identity (flavor/model) without hard-coding either.

const STOP = new Set(['the', 'and', 'with', 'for', 'your', 'a', 'an', 'of', 'to', 'in', 'on', 'new', 'lot', 'oz', 'ct', 'pack']);

// Generic commodity / branded-merch nouns. These describe an item whose RESALE value
// comes entirely from its brand, not the noun itself — a "beanie", "mug" or "tote" is
// worthless as a comp unless it's the SAME brand. Every store/team/company makes one,
// so a bare-noun match collides wildly (a coffee roaster's "Redhawk Beanie" matching
// college "Seattle Redhawks" beanies). When a product is described ONLY by words in this
// set, we stop treating the brand as optional and REQUIRE it (see relevantPrices). This
// does NOT touch distinctive products (supplements, gadgets, specific models), where the
// product tokens carry real identity and the brand can stay a soft bonus (private-label
// stores whose brand never appears on eBay still match).
const GENERIC_MERCH = new Set([
  'beanie', 'hat', 'cap', 'caps', 'visor', 'headband',
  'shirt', 'shirts', 'tshirt', 'tshirts', 'tee', 'tees', 'top', 'tank',
  'hoodie', 'hoodies', 'sweatshirt', 'sweater', 'crewneck', 'jacket', 'pullover',
  'sock', 'socks', 'shorts', 'pants', 'leggings', 'apron', 'glove', 'gloves', 'scarf',
  'mug', 'mugs', 'cup', 'cups', 'tumbler', 'bottle', 'flask', 'koozie', 'coaster', 'glass',
  'tote', 'bag', 'bags', 'backpack', 'pouch', 'wallet',
  'sticker', 'stickers', 'decal', 'pin', 'pins', 'button', 'patch', 'magnet', 'keychain',
  'lanyard', 'towel', 'blanket', 'flag', 'banner', 'poster', 'pennant', 'pen', 'notebook',
]);

// Low-information descriptor words: colors, sizes, and packaging/condition terms. These
// appear across countless unrelated listings, so a comp that overlaps the query ONLY on
// these isn't the same product (a "black large" anything matches a "black large" anything).
// They get a small weight in coverage (below) so matches are driven by real product words,
// not incidental color/size agreement. NOT materials — a material (leather, ceramic) often
// defines the item's value, so those keep full weight.
const COMMON = new Set([
  'black', 'white', 'red', 'blue', 'green', 'gray', 'grey', 'pink', 'purple', 'orange',
  'yellow', 'brown', 'tan', 'navy', 'beige', 'gold', 'silver', 'teal', 'maroon', 'cream',
  'small', 'medium', 'large', 'xl', 'xxl', 'xs', 'mini', 'big', 'size', 'sized',
  'piece', 'pieces', 'count', 'sealed', 'nwt', 'bnib', 'ml', 'gram', 'grams', 'color',
  'colour', 'style', 'edition', 'pcs', 'each', 'fl', 'set', 'bundle',
]);

// Weight a product token by how much identity it carries. Common descriptors (color/size)
// are near-noise and barely count; everything else carries real weight — including
// generic-merch nouns, because the category noun ("wallet", "mug") IS what the item is and
// a comp must match it, not just a modifier. (The merch SET still matters separately: it
// drives the brand gate and is excluded from the distinctive-word guard below.) Long words
// lean specific (flavors, models, terms) so they weigh slightly more.
function tokenWeight(t: string): number {
  if (COMMON.has(t)) return 0.4;
  if (t.length >= 8) return 1.3;
  return 1.0;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w));
}

// Keep comps whose title covers a sufficient share of the PRODUCT tokens, treating the
// brand (first query token) as a soft bonus rather than a hard gate.
//
// WHY brand can't be mandatory: the query's first token is usually the store's brand,
// often derived from the domain and CONCATENATED ("maxxnutrients.com" → "maxxnutrients").
// No real eBay listing contains that exact token — sellers write "Maxx Nutrients" or just
// the product — so a hard `titleTokens.has(brand)` gate dropped 100% of comps for any
// private-label / small-brand store (every product showed "No eBay comps found"). The
// resale market for such products is the generic product itself (e.g. "ashwagandha plus"),
// so we require strong coverage of the product tokens and let a brand match only RELAX the
// threshold slightly. Major brands that ARE on eBay still match via the bonus + naturally
// rank in eBay's own results.
// Weighted-coverage relevance. A comp is kept only if its title covers enough of the
// product's IDENTITY WEIGHT (not just a raw token count) AND shares at least one genuinely
// distinctive word — so matches are driven by the words that actually identify the product,
// across every category, not by incidental agreement on "black", "large", or a bare noun.
//
//   • Common descriptors (color/size) are near-weightless; generic-merch nouns are partial;
//     ordinary/long words carry full weight (see tokenWeight).
//   • Distinctive guard: if the product has any non-generic word, the comp must contain at
//     least one of them (a "leather wallet" comp can't be kept on the word "wallet" alone).
//   • Generic-merch gate: when a product is described ONLY by commodity nouns/descriptors
//     ("redhawk beanie"), the brand is its sole identity, so a brand match is REQUIRED —
//     this is what drops college "Redhawks" beanies matched to a coffee roaster's beanie.
//   • Brand stays a soft bonus for distinctive products, so private-label stores whose brand
//     never appears on eBay (the maxxnutrients case) still match on their product words.
const COVER_MIN = 0.55;        // fraction of identity weight a title must cover
const COVER_BRAND_RELAX = 0.15; // a real brand match relaxes the coverage bar this much

function relevantPrices(items: EbayItem[], queryTokens: string[]): number[] {
  if (!queryTokens.length) return items.map(i => i.price);
  const brand = queryTokens[0];
  const hasBrand = brand.length > 2;
  // Product identity = everything after the brand (fall back to all tokens for a
  // single-token query). Coverage is computed over these, not the brand.
  const productTokens = queryTokens.length > 1 ? queryTokens.slice(1) : queryTokens;

  const weights = productTokens.map(tokenWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const distinctiveTokens = productTokens.filter(t => !COMMON.has(t) && !GENERIC_MERCH.has(t));
  // No distinctive word at all → identity lives entirely in the brand → require it.
  const brandRequired = distinctiveTokens.length === 0 && hasBrand;

  const out: number[] = [];
  for (const it of items) {
    const titleTokens = new Set(tokenize(it.title));
    let matched = 0;
    for (let i = 0; i < productTokens.length; i++) {
      if (titleTokens.has(productTokens[i])) matched += weights[i];
    }
    const coverage = matched / totalWeight;
    const brandHit = hasBrand && titleTokens.has(brand);

    if (brandRequired) {
      // Commodity item: same brand or it's a different product entirely.
      if (brandHit && coverage >= 0.5) out.push(it.price);
      continue;
    }

    // Must share a real identifying word — never keep a comp on generic words alone.
    const distinctiveHit = distinctiveTokens.some(t => titleTokens.has(t));
    if (!distinctiveHit) continue;

    const bar = brandHit ? COVER_MIN - COVER_BRAND_RELAX : COVER_MIN;
    if (coverage >= bar) out.push(it.price);
  }
  return out;
}

// Exposed for offline unit tests (validates the relevance gate without any network).
export const __test = { relevantPrices, tokenize, cleanWords, tokenWeight };

// Trim price outliers before computing the median: eBay sold results mix singles with
// bulk/case lots and mispriced listings, which skew a raw median. We drop values
// outside 1.5×IQR (Tukey fences) when we have enough data; tiny samples pass through.
function trimOutliers(prices: number[]): number[] {
  if (prices.length < 5) return prices;
  const s = [...prices].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const kept = s.filter(p => p >= lo && p <= hi);
  return kept.length >= 3 ? kept : s;
}

export function calcComps(rawPrices: number[], scanned: number): SoldComps {
  const matched = rawPrices.length;
  const prices = trimOutliers(rawPrices);
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    found: true,
    count: sorted.length,
    median,
    low: sorted[0],
    high: sorted[sorted.length - 1],
    avgSoldPerMonth: parseFloat((sorted.length / 3).toFixed(1)),
    matched,
    scanned,
  };
}

// ─── Query building ──────────────────────────────────────────────────────────

const NOISE_WORDS = new Set([
  'gift', 'gifts', 'set', 'sets', 'bundle', 'bundles', 'pack', 'packs', 'variety',
  'sample', 'samples', 'single', 'serve', 'option', 'options', 'video', 'value',
  'satisfaction', 'guarantee', 'guaranteed', 'days', 'day', 'free', 'shipping',
  'bonus', 'deal', 'sale', 'official', 'authentic', 'brand', 'the', 'and', 'with',
  'for', 'your',
]);

function cleanWords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !/^\d+$/.test(w) && !NOISE_WORDS.has(w));
}

function buildSearchUrl(keywords: string): string {
  const qs = new URLSearchParams({
    _nkw: keywords, LH_Complete: '1', LH_Sold: '1',
    _sacat: '0', _ipg: '60', _sop: '13', // _sop=13 = ended recently (fresher comps)
  });
  return `https://www.ebay.com/sch/i.html?${qs}`;
}

// ─── Single search with classification ───────────────────────────────────────
// Returns a status the scheduler acts on. No internal retry here — retry/backoff is
// the scheduler's job so it can globally slow down rather than each call hammering.

async function searchOnce(keywords: string, queryTokens: string[], timeoutMs: number): Promise<EbayResult> {
  if (isStopSignaled()) return { status: 'error', comps: EMPTY };

  // Goes through the CACHED item fetch, so a repeat store query costs 0 ScraperAPI requests.
  const { status, items } = await fetchSoldItems(keywords, timeoutMs);
  if (status !== 'ok') return { status, comps: EMPTY };

  const prices = relevantPrices(items, queryTokens).filter(p => p > 0);
  if (!prices.length) return { status: 'empty', comps: EMPTY };

  return { status: 'ok', comps: calcComps(prices, items.length) };
}

// ─── Public: raw sold-item fetch (year-preserving, no store relevance) ────────
//
// The store-product path (getSoldComps) word-cleans the query and DROPS bare numbers,
// which is correct for supplements but wrong for CAR PARTS, where the model year
// ("2013") and model code are the whole identity. The vehicle scanner needs the raw
// eBay results so it can apply its OWN year/model-aware relevance (see car-comps.ts).
// This reuses the exact same ScraperAPI key pool + HTML parser as getSoldComps — it just
// stops BEFORE relevance filtering and passes `keywords` verbatim into _nkw (year intact).
export interface SoldItemsResult { status: FetchStatus; items: EbayItem[]; }

// ─── eBay Marketplace Insights API (official SOLD data) — preferred WHEN GRANTED ──────
//
// FlipSonar scores on SOLD comps — what items ACTUALLY sold for. Active/asking prices are
// worthless for arbitrage (most never sell), so we never use them. Only two sources give
// real sold data: scraping eBay's "Sold" pages (the ScraperAPI path below) and eBay's
// official Marketplace Insights API. Insights is free + accurate but eBay must GRANT the app
// the `buy.marketplace.insights` scope — this app is NOT yet approved (client_credentials for
// that scope → invalid_scope, verified). So Insights stays OFF by default and comps come from
// the ScraperAPI sold-page scrape. Once eBay approves the app, set EBAY_MARKETPLACE_INSIGHTS=1
// and comps switch to the official sold endpoint with no other change. (The Browse API is
// deliberately NOT used anywhere — it only returns active listings, not sold prices.)
const EBAY_CID = process.env.EBAY_CLIENT_ID || '';
const EBAY_SECRET = process.env.EBAY_CLIENT_SECRET || '';
const EBAY_INSIGHTS = process.env.EBAY_MARKETPLACE_INSIGHTS === '1' && !!(EBAY_CID && EBAY_SECRET);
const INSIGHTS_SCOPE = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

// Cache the app OAuth token in-process (client_credentials tokens last ~2h).
let ebayToken: { value: string; exp: number } | null = null;
async function ebayAppToken(): Promise<string | null> {
  if (ebayToken && Date.now() < ebayToken.exp) return ebayToken.value;
  const basic = Buffer.from(`${EBAY_CID}:${EBAY_SECRET}`).toString('base64');
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=' + encodeURIComponent(INSIGHTS_SCOPE),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j.access_token) return null;
    ebayToken = { value: j.access_token, exp: Date.now() + ((j.expires_in ? j.expires_in - 60 : 6600) * 1000) };
    return ebayToken.value;
  } catch { return null; }
}

// Official SOLD comps via Marketplace Insights (item_sales/search → lastSoldPrice).
async function fetchInsightsItems(keywords: string, timeoutMs: number): Promise<SoldItemsResult> {
  const tok = await ebayAppToken();
  if (!tok) return { status: 'error', items: [] };
  const url = 'https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search'
    + '?limit=100&q=' + encodeURIComponent(keywords);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tok}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: controller.signal,
    });
    if (res.status === 401) { ebayToken = null; return { status: 'throttled', items: [] }; } // stale token → retry
    if (res.status === 429) return { status: 'throttled', items: [] };                          // rate cap → back off
    if (!res.ok) return { status: 'error', items: [] };
    const j: any = await res.json();
    const items: EbayItem[] = (j.itemSales || [])
      .map((it: any) => {
        const p = parseFloat(it?.lastSoldPrice?.value);
        return { title: String(it?.title || ''), price: p > 0 ? p : 0 };
      })
      .filter((it: EbayItem) => it.price >= 1 && it.price < 5000);
    return { status: items.length ? 'ok' : 'empty', items };
  } catch {
    return { status: 'error', items: [] }; // timeout / network → retryable
  } finally {
    clearTimeout(timer);
  }
}

// The uncached fetch: exactly ONE upstream request → parsed (title, price) items.
// Prefers eBay's official SOLD endpoint (Marketplace Insights) when granted+enabled;
// otherwise scrapes eBay's Sold pages via ScraperAPI — both are real SOLD data.
async function fetchSoldItemsUncached(keywords: string, timeoutMs: number): Promise<SoldItemsResult> {
  const kw = (keywords || '').trim();
  if (!kw) return { status: 'empty', items: [] };

  if (EBAY_INSIGHTS) {
    const r = await fetchInsightsItems(kw, timeoutMs);
    if (r.status === 'ok' || r.status === 'empty') return r; // else fall through to the scrape
  }

  const raw = await fetchRaw(buildSearchUrl(kw), timeoutMs);
  if (!raw) return { status: 'error', items: [] };
  if (raw.status === 402) return { status: 'exhausted', items: [] };
  if (raw.status === 429 || raw.status === 403) return { status: 'throttled', items: [] };
  if (!raw.ok || !raw.html) return { status: 'error', items: [] };

  const $ = cheerio.load(raw.html);
  if (isSignInWall(raw.html, $)) return { status: 'blocked', items: [] };
  if (isThrottlePage(raw.html, $)) return { status: 'throttled', items: [] };

  // Parse ONLY the exact-match region — drop eBay's "fewer words" fuzzy filler so we never
  // fabricate comps for a product that has no real sold history (see stripFuzzyFiller).
  const items = parseItems(raw.html, cheerio.load(stripFuzzyFiller(raw.html)));
  return { status: items.length ? 'ok' : 'empty', items };
}

// ─── Persistent comp cache (Next.js Data Cache — NO external datastore) ────────
//
// eBay lookups are the ONLY thing that costs money (ScraperAPI credits), and the same
// vehicles + parts get scanned over and over (every yard is full of F-150s / Civics). So we
// cache the parsed eBay items BY QUERY across requests, deployments, AND users — a repeat
// lookup is then served from the Data Cache with ZERO ScraperAPI requests. On Vercel this is
// the shared Data Cache; on the self-hosted desktop it persists to .next/cache on disk.
// We cache ONLY real successful pages: the inner fn THROWS on anything else, and Next never
// persists a thrown result, so throttles/errors/empties are re-fetched next time and never
// poison the cache. Bump the version key ('…-v1') to invalidate everything at once.
const COMP_CACHE_TTL = 60 * 60 * 24 * 14; // 14 days — sold prices barely move in two weeks

const cachedItems = unstable_cache(
  async (keywords: string): Promise<EbayItem[]> => {
    const res = await fetchSoldItemsUncached(keywords, 9000);
    if (res.status !== 'ok' || !res.items.length) throw new Error('NOCACHE:' + res.status);
    return res.items;
  },
  ['ebay-sold-items-v4'], // v4: drop eBay "fewer words" fuzzy filler (was fabricating comps for no-market items); v3 SOLD data; v2 held active-listing data — never serve it as sold
  { revalidate: COMP_CACHE_TTL, tags: ['ebay-comps'] },
);

export async function fetchSoldItems(keywords: string, _timeoutMs = 12000): Promise<SoldItemsResult> {
  if (isStopSignaled()) return { status: 'error', items: [] };
  const kw = (keywords || '').trim();
  if (!kw) return { status: 'empty', items: [] };
  try {
    const items = await cachedItems(kw);   // cache HIT → no ScraperAPI request
    return { status: 'ok', items };
  } catch (e: any) {
    const m = String(e?.message || '');
    if (m.startsWith('NOCACHE:')) return { status: m.slice(8) as FetchStatus, items: [] };
    return { status: 'error', items: [] };
  }
}

// ─── Public: getSoldComps with bounded tiers + scheduler-driven retry hook ────
//
// Two query tiers (full cleaned query, then first 4 words) keep the brand up front so
// results stay relevant; we never broaden to a brand-free query (that invents false
// comps). `attemptFetch` lets the caller (scan engine) inject retry-on-throttle/error
// with global backoff; default does a single attempt.

export interface CompsOptions {
  timeoutMs?: number;
  // Called once per low-level attempt. Should return the result, applying any
  // retry/backoff policy. Defaults to a single searchOnce call.
  run?: (fn: () => Promise<EbayResult>) => Promise<EbayResult>;
}

export async function getSoldComps(query: string, opts: CompsOptions = {}): Promise<EbayResult> {
  if (isStopSignaled()) return { status: 'error', comps: EMPTY };

  const words = cleanWords(query);
  if (!words.length) return { status: 'empty', comps: EMPTY };

  const timeoutMs = opts.timeoutMs ?? 12000;
  const run = opts.run ?? ((fn) => fn());

  // ONE request per product (speed). We previously did a 2nd "first-4-words" fallback
  // query whenever the full query came back empty — but on large catalogs that nearly
  // DOUBLED the ScraperAPI request count (every genuinely-empty product paid for two
  // calls), which is the main thing that made a 400-item scan take ~10 min. The full
  // brand-prefixed query is already the most relevant; a broader fallback also tends to
  // pull in false comps. So we keep the single best query. (To re-enable a fallback for
  // accuracy on small scans, gate it behind opts.)
  const kw = words.slice(0, 6).join(' '); // cap length; brand stays first
  if (isStopSignaled()) return { status: 'error', comps: EMPTY };
  const tokens = cleanWords(kw);
  return run(() => searchOnce(kw, tokens, timeoutMs));
}

