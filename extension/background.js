// ─── FlipSonar eBay Connector — background service worker ────────────────────
//
// This is the ONLY part of FlipSonar that talks to eBay on the web, and it is
// deliberately the dumbest component in the system: it fetches one eBay sold-search page
// and hands back the raw HTML. It does not parse, score, store, or transmit anything.
//
// WHY IT HAS TO BE HERE, AND ONLY HERE
// eBay stopped serving sold/completed listings to signed-out sessions in 2026-07. Reading
// them needs a signed-in eBay session, and there is no way for a website to borrow one:
// eBay's cookies are HttpOnly and scoped to ebay.com, so flipsonar.io's own JavaScript
// can never read them, and eBay's search pages send no Access-Control-Allow-Origin, so
// the browser blocks the page from reading a cross-origin response even when the cookies
// ride along. An extension with host permissions is the one context in the browser that
// can do this — and MV3 removed the content-script CORS bypass, so it must be the
// service worker specifically, not the content script.
//
// WHAT THAT MEANS FOR THE USER'S CREDENTIALS
// The session stays where it already is: in their browser's eBay cookie jar. Nothing is
// read out of it, nothing is copied, nothing is sent to a FlipSonar server. The fetch
// carries the cookies because Chrome attaches them, the same way it would if the user
// opened the search themselves.
//
// PARSING LIVES ON THE SITE, NOT IN HERE — ON PURPOSE
// eBay has changed its result-card layout three times, and each change silently zeroed
// out comps. If the parser lived in this extension, every one of those would need a
// Chrome Web Store review — days of every user reading zero comps. Returning raw HTML
// means a layout fix is a site deploy that takes effect immediately, for everyone,
// with no extension update at all.

import { buildSearchUrl } from './lib/ebay-dom.js';

// ─── Request pacing ──────────────────────────────────────────────────────────
//
// A scan fires one lookup per product, which is far more eBay searches in a row than
// ordinary browsing. Pacing it is what keeps a real account from looking automated, and
// it belongs HERE rather than in the page: this is where the requests actually leave the
// browser, so a user with two tabs open still gets one shared, honest rate.
const MIN_INTERVAL_MS = 350;   // floor between two eBay requests
const MAX_CONCURRENT = 3;      // a human with a few tabs open, not a crawler
const TIMEOUT_MS = 15_000;

let inFlight = 0;
let lastStart = 0;
/** @type {(() => void)[]} */
const waiting = [];

function pump() {
  if (inFlight >= MAX_CONCURRENT || !waiting.length) return;
  const wait = Math.max(0, lastStart + MIN_INTERVAL_MS - Date.now());
  setTimeout(() => {
    if (inFlight >= MAX_CONCURRENT || !waiting.length) return;
    const next = waiting.shift();
    inFlight++;
    lastStart = Date.now();
    next();
  }, wait);
}

/** Take a slot in the paced queue. Resolves when it's this request's turn. */
function acquire() {
  return new Promise((resolve) => {
    waiting.push(resolve);
    pump();
  });
}

function release() {
  inFlight--;
  pump();
}

// ─── The fetch ───────────────────────────────────────────────────────────────

/**
 * Fetch one eBay sold-search page inside the user's own session.
 *
 * The page sends KEYWORDS, never a URL. That is a security boundary, not a style
 * preference: an extension that fetched arbitrary URLs with the user's cookies attached
 * would be a general-purpose credentialed proxy for anything running on flipsonar.io.
 * Building the URL here means this can only ever read an eBay sold search.
 *
 * @param {string} keywords
 * @returns {Promise<{ok: boolean, httpStatus?: number, finalUrl?: string, html?: string, error?: string}>}
 */
async function fetchSold(keywords) {
  const kw = String(keywords || '').trim();
  if (!kw) return { ok: false, error: 'no keywords' };

  await acquire();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(buildSearchUrl(kw), {
      credentials: 'include',      // the user's own eBay session — the whole point
      redirect: 'follow',          // a redirect to signin.ebay.com is how the wall shows up
      signal: ctl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    const html = await res.text();
    // A non-2xx still returns its body: eBay's bot challenge is a 403 with a readable
    // page, and the site needs to see it to tell "throttled" from "no sales".
    return { ok: true, httpStatus: res.status, finalUrl: res.url, html };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
    release();
  }
}

// ─── Message API (from bridge.js only — see manifest content_scripts matches) ─

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'fs:hello') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (msg?.type === 'fs:fetchSold') {
    fetchSold(msg.keywords).then(sendResponse);
    return true; // async response
  }
  return false;
});
