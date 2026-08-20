// ─── Does a HOSTED browser get eBay sold data? ───────────────────────────────
//
//   BROWSERBASE_API_KEY=bb_... BROWSERBASE_PROJECT_ID=... node scripts/browserbase-spike.mjs
//   ...add --proxy to repeat the test through residential proxies.
//
// This is a SPIKE, not a feature. It exists to answer the two questions that decide
// whether "connect your eBay account on flipsonar.io" is buildable at all, before any of
// it gets built:
//
//   1. Does eBay serve sold listings to an automated SIGNED-IN session?
//      Still unanswered since 2026-07. Everything rests on it.
//
//   2. If yes — does it tolerate a DATACENTER IP, or must we pay for residential proxies?
//      This is the whole economics of the feature:
//        • datacenter OK   → ~$0.03 per 500-product scan (browser time only)
//        • proxies needed  → ~$2.40 per scan at $10–12/GB, which is WORSE than the
//                            metered sold-comps API it was meant to replace
//
// It answers both by doing the real thing: open a hosted browser, hand YOU the live view
// to sign in to eBay by hand, then run an actual sold search through that session and
// report what came back — measuring bytes on the way so the proxy bill can be predicted
// rather than guessed.
//
// USE A BURNER EBAY ACCOUNT. Not the selling account.
//
// Nothing here touches flipsonar.io or any customer. The Context it creates is deleted at
// the end unless --keep is passed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import * as cheerio from 'cheerio';

import { parseItems, isSignInWall, isThrottlePage } from '../app/lib/ebay-cheerio.ts';
import { buildSearchUrl, stripFuzzyFiller, classifyPage } from '../app/lib/ebay-dom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Read the keys from .env.local too, so they never have to be pasted on a command line
// (shell history is a bad place for a credential).
function envFromDotLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const dot = envFromDotLocal();
const API_KEY = process.env.BROWSERBASE_API_KEY || dot.BROWSERBASE_API_KEY;
const PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || dot.BROWSERBASE_PROJECT_ID;

const USE_PROXY = process.argv.includes('--proxy');
const KEEP = process.argv.includes('--keep');
const QUERY = 'nike air max 90'; // ordinary product, thousands of sold listings
const SIGNIN_WAIT_MS = 10 * 60_000;
const POLL_MS = 15_000;

if (!API_KEY || !PROJECT_ID) {
  console.log(`
Missing credentials.

  1. Sign up free at https://browserbase.com (no card for the free tier: 1 browser hour,
     which is far more than this spike needs).
  2. Copy the API key and Project ID from Settings.
  3. Put them in flipradar-site/.env.local:

       BROWSERBASE_API_KEY=bb_live_...
       BROWSERBASE_PROJECT_ID=...

  4. node scripts/browserbase-spike.mjs
`);
  process.exit(1);
}

const api = async (method, url, body) => {
  const res = await fetch(`https://api.browserbase.com${url}`, {
    method,
    headers: { 'X-BB-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

console.log(`\nBrowserbase spike — proxies ${USE_PROXY ? 'ON (residential)' : 'OFF (datacenter IP)'}\n`);

// A Context is what makes this a real test of the product design: the eBay session it
// captures lives encrypted on Browserbase, and FlipSonar would store only this id — never
// the customer's cookies.
const context = await api('POST', '/v1/contexts', { projectId: PROJECT_ID });
console.log(`context: ${context.id}`);

const session = await api('POST', '/v1/sessions', {
  projectId: PROJECT_ID,
  browserSettings: { context: { id: context.id, persist: true } },
  proxies: USE_PROXY,
});
console.log(`session: ${session.id}`);

const debugInfo = await api('GET', `/v1/sessions/${session.id}/debug`);
const liveUrl = debugInfo.debuggerFullscreenUrl;

const browser = await puppeteer.connect({ browserWSEndpoint: session.connectUrl, defaultViewport: null });
const page = (await browser.pages())[0] || (await browser.newPage());

// Block images/media/fonts/stylesheets. Two reasons: it is what a production scan would
// do, and it makes the measured byte count an honest basis for the proxy bill.
let bytes = 0;
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (['image', 'media', 'font', 'stylesheet'].includes(req.resourceType())) req.abort().catch(() => {});
  else req.continue().catch(() => {});
});
page.on('response', async (res) => {
  const len = Number(res.headers()['content-length'] || 0);
  if (len) bytes += len;
});

/** Run one real sold search through this session and classify what comes back. */
async function trySoldSearch() {
  const before = bytes;
  await page.goto(buildSearchUrl(QUERY), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const html = await page.content();
  const title = await page.title().catch(() => '');
  const url = page.url();

  const refusal = classifyPage(html, title);
  const signin = /signin\.ebay\./i.test(url) || isSignInWall(html, cheerio.load(html));
  const trimmed = stripFuzzyFiller(html);
  const items = parseItems(trimmed, cheerio.load(trimmed));

  return {
    url, title,
    kb: Math.round((bytes - before) / 1024),
    verdict: signin ? 'SIGNED OUT / WALLED'
      : refusal === 'throttled' || isThrottlePage(html, cheerio.load(html)) ? 'CHALLENGED'
      : items.length ? 'SOLD DATA' : 'EMPTY (layout or zero results)',
    items: items.length,
    sample: items.slice(0, 3),
  };
}

console.log('\n── first look, before you sign in ──');
const cold = await trySoldSearch();
console.log(`  ${cold.verdict}  ·  ${cold.items} items  ·  ${cold.kb} KB  ·  ${JSON.stringify(cold.title)}`);

if (cold.verdict === 'SOLD DATA') {
  console.log('\n  !! eBay served sold data with NO sign-in at all. Re-verify the wall before');
  console.log('     building anything — the premise may have changed.');
}

console.log(`
── now sign in to eBay ──

  Open this live view and sign in BY HAND. Use a BURNER buyer account:

  ${liveUrl}

  I'll re-check every ${POLL_MS / 1000}s and stop as soon as eBay serves sold data.
`);

const deadline = Date.now() + SIGNIN_WAIT_MS;
let final = cold;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  try {
    final = await trySoldSearch();
  } catch (e) {
    console.log(`  (retrying — ${String(e.message).slice(0, 80)})`);
    continue;
  }
  const left = Math.round((deadline - Date.now()) / 1000);
  console.log(`  ${final.verdict}  ·  ${final.items} items  ·  ${final.kb} KB  ·  ${left}s left`);
  if (final.verdict === 'SOLD DATA') break;
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────────');
if (final.verdict === 'SOLD DATA') {
  const perScan = (final.kb / 1024) * 500;
  console.log(`ANSWER: eBay DOES serve sold data to a signed-in hosted browser.`);
  console.log(`        ${final.items} sold listings parsed. Sample:`);
  final.sample.forEach((i) => console.log(`          $${i.price}  ${i.title.slice(0, 60)}`));
  console.log('');
  console.log(`        ${final.kb} KB per lookup → ~${perScan.toFixed(2)} MB for a 500-product scan.`);
  if (USE_PROXY) {
    console.log(`        Through residential proxies that is ~$${((perScan / 1024) * 11).toFixed(2)} per scan`);
    console.log('        at $10–12/GB — compare against ~$0.75/scan for a metered sold API.');
    console.log('        Re-run WITHOUT --proxy: if the datacenter IP also works, the cost');
    console.log('        drops to browser time alone (~$0.03/scan) and this path wins outright.');
  } else {
    console.log('        On the DATACENTER IP, so no proxy bandwidth is billed — browser time');
    console.log('        only, roughly $0.02–0.04 per scan. This path is viable and cheap.');
  }
} else if (final.verdict === 'SIGNED OUT / WALLED') {
  console.log('ANSWER: still walled after sign-in (or sign-in never completed).');
  console.log('        If you definitely signed in, eBay is refusing automated signed-in');
  console.log('        reads — which kills the hosted-browser path AND the extension path,');
  console.log('        and leaves a metered sold-comps API as the only remaining option.');
} else if (final.verdict === 'CHALLENGED') {
  console.log('ANSWER: eBay challenged this browser (bot interstitial).');
  console.log(USE_PROXY
    ? '        Even through residential proxies. That points at the automation fingerprint,\n        not the IP — hosted browsers may simply not be usable here.'
    : '        Expected on a datacenter IP. Re-run with --proxy to see whether residential\n        egress clears it. If it does, budget ~$2+/scan in bandwidth.');
} else {
  console.log(`ANSWER: inconclusive — ${final.verdict}.`);
  console.log(`        title: ${JSON.stringify(final.title)}`);
  console.log(`        url:   ${final.url}`);
  console.log('        Zero items with no refusal usually means eBay changed its card layout;');
  console.log('        fix app/lib/ebay-dom.js and re-run.');
}
console.log(`\ntotal bytes this run: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log('──────────────────────────────────────────────────────────────\n');

await browser.close().catch(() => {});
if (!KEEP) {
  // The context holds a real eBay session. Don't leave it lying around after a spike.
  await api('DELETE', `/v1/contexts/${context.id}`).catch(() => {});
  console.log('context deleted (pass --keep to retain it for a follow-up run)\n');
} else {
  console.log(`context kept: ${context.id}\n`);
}
