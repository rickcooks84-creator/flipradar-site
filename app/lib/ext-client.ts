'use client';

// ─── Talking to the FlipSonar eBay Connector extension ───────────────────────
//
// The browser-side half of the eBay unwall. eBay only serves sold listings to a
// signed-in session, and a website can never reach one: eBay's cookies are HttpOnly and
// scoped to ebay.com, and its search pages send no CORS headers, so flipsonar.io's own
// JavaScript is locked out twice over. The extension's service worker is the one place in
// the browser allowed to make that request, so the page asks it to.
//
// The extension returns RAW HTML and nothing else. Reading it — spotting a sign-in wall,
// cutting eBay's fuzzy filler, pulling out titles and prices — happens here, using the
// same app/lib/ebay-dom module the server parses with. That split is deliberate: eBay has
// changed its card layout three times, and with the parser on this side each change is
// fixed by deploying the site rather than by shipping an extension update through Chrome
// Web Store review while every user reads zero comps.
//
// NOTE: this module must never import from app/lib/ebay.ts — that file pulls in cheerio
// and next/cache, which do not belong in a browser bundle. Shared logic lives in
// app/lib/ebay-dom.js, which is dependency-free for exactly this reason.

import {
  buildQuery,
  classifyPage,
  stripFuzzyFiller,
  parseItemsFromDocument,
} from './ebay-dom.js';

// Mirrors FetchStatus in app/lib/ebay.ts. Duplicated rather than imported so that this
// client module doesn't drag the server's eBay engine into the browser bundle.
export type ExtStatus = 'ok' | 'empty' | 'throttled' | 'error' | 'blocked';

export interface ExtItem { title: string; price: number; }
export interface ExtLookup { status: ExtStatus; items: ExtItem[]; }

const PROTOCOL = 1;
const PING_TIMEOUT_MS = 1200;
const FETCH_TIMEOUT_MS = 25_000;   // above the extension's own 15s, so it reports first

let seq = 0;
type Pending = { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<number, Pending>();
let listening = false;

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const d = ev.data;
    if (!d || d.__fs !== PROTOCOL || d.dir !== 'res') return;
    const p = pending.get(d.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(d.id);
    p.resolve(d);
  });
}

/**
 * Send one request to the content script and wait for its matching reply.
 * Resolves to null on timeout, which is how "no extension installed" looks from here —
 * there is nothing on the other end to say no.
 */
function ask(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<any | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  ensureListener();
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    window.postMessage({ __fs: PROTOCOL, dir: 'req', id, type, ...payload }, window.location.origin);
  });
}

/** Extension version if it's installed and its bridge is running on this page, else null. */
export async function pingExtension(): Promise<string | null> {
  const res = await ask('ping', {}, PING_TIMEOUT_MS);
  return res?.ok ? String(res.version || '?') : null;
}

/**
 * One sold-comp lookup through the user's eBay session.
 *
 * Every failure keeps its own name. 'blocked' in particular must never be softened into
 * 'empty' on the way back: empty means "eBay has no record of this selling", blocked
 * means "eBay refused to show us", and the difference decides whether a user walks away
 * from stock that actually moves.
 */
export async function lookupSold(query: string): Promise<ExtLookup> {
  const { keywords } = buildQuery(query);
  if (!keywords) return { status: 'empty', items: [] };

  const res = await ask('fetchSold', { keywords }, FETCH_TIMEOUT_MS);
  if (!res) return { status: 'error', items: [] };
  if (!res.ok || typeof res.html !== 'string') return { status: 'error', items: [] };

  // A redirect that landed on the sign-in host is the wall, whatever the body says.
  if (/^https:\/\/signin\.ebay\./i.test(String(res.finalUrl || ''))) return { status: 'blocked', items: [] };

  const html: string = res.html;
  // parseFromString builds an INERT document: no scripts run, no resources load. eBay's
  // markup is never inserted into the live page.
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const refusal = classifyPage(html, doc.title || '');
  if (refusal) return { status: refusal as ExtStatus, items: [] };

  // HTTP 403/429 with no recognisable refusal page is still a refusal — back off, don't
  // record a zero.
  if (res.httpStatus === 403 || res.httpStatus === 429) return { status: 'throttled', items: [] };

  // Cut eBay's "results matching fewer words" filler before parsing, exactly as the
  // server does, or a product with no market gets comps invented for it out of unrelated
  // listings that happen to share a category.
  const trimmed = stripFuzzyFiller(html);
  const items = parseItemsFromDocument(
    trimmed.length === html.length ? doc : new DOMParser().parseFromString(trimmed, 'text/html'),
  );

  return { status: items.length ? 'ok' : 'empty', items };
}

/**
 * Is the user's eBay session actually serving sold data right now?
 *
 * Runs a deliberately ordinary search — a common product with a deep sold history, so an
 * empty result means something is wrong rather than that the query was obscure.
 */
export async function probeEbaySession(): Promise<ExtStatus> {
  const { status } = await lookupSold('nike air max 90');
  return status;
}
