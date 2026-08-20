import * as cheerio from 'cheerio';
import {
  CARD_SELECTOR, TITLE_SELECTOR, PRICE_SELECTOR, TITLE_FALLBACK, PRICE_FALLBACK,
  DIVIDER_IN_CARD, SIGNIN_TITLE, SIGNIN_HOST, THROTTLE_TITLE, THROTTLE_BODY,
  itemFromCard,
} from './ebay-dom.js';

export interface EbayItem { title: string; price: number; }

// Match whatever the installed cheerio version's load() returns (older @types/cheerio
// returns `Root`, newer returns `CheerioAPI`) so this stays version-agnostic.
type Cheerio$ = ReturnType<typeof cheerio.load>;

// ─── The cheerio-backed half of the eBay page contract ───────────────────────
//
// app/lib/ebay-dom.js says WHAT to look for on an eBay sold page; this file reads it that
// way on the server, and parseItemsFromDocument in that same module reads it that way in
// the browser extension. Keeping this separate from ebay.ts is what lets the parity test
// (scripts/test-parser-parity.mjs) import it directly — ebay.ts pulls in next/cache and
// only loads inside a Next runtime, so a parser welded to it could not be tested offline,
// and a parser that can't be tested is how three silent layout breaks got shipped.

// ─── HTML parsing (cheerio, in-process) ──────────────────────────────────────

// parsePrice, the card selectors and the refusal regexes all come from ./ebay-dom, which
// the browser extension imports too — see that file for why they live in one place.

// eBay's "SORRY / Error Page" / bot challenge / consent interstitials. When we get one
// the data is worthless AND it signals throttling — the scheduler must back off, not
// cache a false "0 comps".
export function isThrottlePage(html: string, $: Cheerio$): boolean {

  const title = ($('title').first().text() || '').toLowerCase();
  return THROTTLE_TITLE.test(title) || THROTTLE_BODY.test(html.slice(0, 4000));
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
export function isSignInWall(html: string, $: Cheerio$): boolean {
  const title = ($('title').first().text() || '').toLowerCase();
  // SIGNIN_HOST also catches a redirect that landed on the signin host (captured in the
  // canonical/og URL of the page) when the title itself looks ordinary.
  return SIGNIN_TITLE.test(title) || SIGNIN_HOST.test(html.slice(0, 4000));
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
// (FUZZY_DIVIDER + stripFuzzyFiller live in ./ebay-dom — the extension cuts filler too.)

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
export function parseItems(html: string, $: Cheerio$): EbayItem[] {

  const items: EbayItem[] = [];
  const cards = $(CARD_SELECTOR);

  cards.each((_, el) => {
    const $el = $(el);
    if (DIVIDER_IN_CARD.test($el.text())) return false; // break: stop at the relevance divider

    const titleText = $el.find(TITLE_SELECTOR).first().text() || $el.find(TITLE_FALLBACK).first().text();
    const priceText = $el.find(PRICE_SELECTOR).first().text() || $el.find(PRICE_FALLBACK).first().text();
    const item = itemFromCard(titleText, priceText);
    if (item) items.push(item);
  });

  return items;
}
