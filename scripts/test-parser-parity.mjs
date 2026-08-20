// ─── Do the two eBay parsers read the same page the same way? ────────────────
//
//   node scripts/test-parser-parity.mjs
//
// FlipSonar reads eBay's sold page twice over: server-side with cheerio (app/lib/ebay.ts)
// and in the browser with DOMParser (app/lib/ebay-dom.js, via the extension). They share
// selectors, but they are different engines walking different tree implementations, and
// the failure they'd produce if they diverged is the quiet kind — a product scoring one
// way through the extension and another through the server, with nothing logged.
//
// So this asserts the property directly: same HTML in, byte-identical items out. It also
// pins the reject rules (promo cards, price ranges, missing prices, fuzzy filler), which
// are the parts that have actually caused wrong numbers in the past.
//
// The DOM half runs in real headless Chrome — the same engine the extension runs in —
// rather than a DOM shim, because a shim agreeing with cheerio would prove nothing about
// what happens in the browser.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

import { parseItems, isSignInWall, isThrottlePage } from '../app/lib/ebay-cheerio.ts';
import { stripFuzzyFiller, classifyPage } from '../app/lib/ebay-dom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts', 'ebay-fixture.html');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  PASS  ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
}

const html = fs.readFileSync(FIXTURE, 'utf8');

// What a correct read of the fixture looks like. Written out in full rather than compared
// only across the two parsers — two parsers agreeing on the WRONG answer is a real
// possibility when they share selectors.
const EXPECTED = [
  { title: 'Nike Air Max 90 Mens Size 10 White Black', price: 84.5 },
  { title: 'Nike Air Max 90 Infrared OG', price: 1240 },
  { title: 'Nike Air Max 90 Essential Triple Black', price: 97 },
  { title: 'Nike Air Max 90 Womens UK 5 Pink', price: 62.99 },
  { title: 'Nike Air Max 90 Premium Leather Brown', price: 110 },
  { title: 'Nike Air Max 90 Ultra Moire Grey', price: 45.25 },
];

// ─── 1. Server parser (cheerio) ──────────────────────────────────────────────
const trimmed = stripFuzzyFiller(html);
const serverItems = parseItems(trimmed, cheerio.load(trimmed));

console.log('\nserver parser (cheerio)');
check('reads the fixture correctly', serverItems, EXPECTED);

// ─── 2. Extension parser (DOMParser in real Chrome) ──────────────────────────
const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.log('\nSKIP: no Chrome found — the DOM half of this test needs a real browser.');
  process.exit(failures ? 1 : 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-parity-'));
// The harness page imports the SHIPPED module from disk — not a copy — so the test can
// only pass if the real file works in a browser.
fs.copyFileSync(path.join(ROOT, 'app', 'lib', 'ebay-dom.js'), path.join(tmp, 'ebay-dom.js'));
fs.writeFileSync(path.join(tmp, 'fixture.html'), html);
fs.writeFileSync(path.join(tmp, 'harness.html'), `<!doctype html><html><body><pre id="out">PENDING</pre>
<script type="module">
  import { stripFuzzyFiller, parseItemsFromDocument } from './ebay-dom.js';
  const res = await fetch('./fixture.html');
  const html = await res.text();
  const doc = new DOMParser().parseFromString(stripFuzzyFiller(html), 'text/html');
  document.getElementById('out').textContent = JSON.stringify(parseItemsFromDocument(doc));
</script></body></html>`);

const dom = execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${path.join(tmp, 'profile')}`,
  '--allow-file-access-from-files',   // the harness fetches the fixture from file://
  '--virtual-time-budget=5000',
  '--dump-dom', `file:///${path.join(tmp, 'harness.html').replace(/\\/g, '/')}`,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 });

const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
const raw = m ? m[1].trim() : 'NO OUTPUT';
let extensionItems;
try { extensionItems = JSON.parse(raw); } catch { extensionItems = raw; }

console.log('\nextension parser (DOMParser, real Chrome)');
check('reads the fixture correctly', extensionItems, EXPECTED);

console.log('\nparity');
check('both parsers agree exactly', extensionItems, serverItems);

// ─── 3. Refusal detection — shared by both sides ─────────────────────────────
console.log('\nrefusal detection');
check('sign-in wall', classifyPage('<html></html>', 'Sign in or Register | eBay'), 'blocked');
check('signin redirect in head', classifyPage('<link rel="canonical" href="https://signin.ebay.com/ws/eBayISAPI.dll"/>', 'eBay'), 'blocked');
check('bot challenge', classifyPage('<html></html>', 'Error Page | eBay'), 'throttled');
check('real results page', classifyPage(html, 'nike air max 90: Search Result | eBay'), null);
check('server agrees: wall', isSignInWall('<html></html>', cheerio.load('<title>Sign in or Register</title>')), true);
check('server agrees: challenge', isThrottlePage('<html></html>', cheerio.load('<title>Error Page | eBay</title>')), true);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
