// ─── End-to-end: does the extension actually work in a real Chrome? ──────────
//
//   node scripts/test-extension-e2e.mjs
//
// The parity test proves the parser is right. This proves the PLUMBING is right, which is
// the part no amount of type-checking can tell you about: an MV3 manifest Chrome refuses,
// a content script whose matches never fire, a postMessage protocol whose two halves
// disagree, or a service worker that can't reach eBay all look fine in source and fail
// only once loaded.
//
// So it loads the real extension into a real Chrome, serves a page on
// http://localhost:3000 (which the manifest's content_scripts matches), and drives the
// whole path from the page's point of view:
//
//     page → postMessage → bridge.js → service worker → eBay → back again
//
// Results come back by POSTing to this script's own server rather than by scraping the
// DOM, because the eBay leg is real network I/O and a --dump-dom snapshot races it.
//
// WHAT THIS CANNOT TELL YOU: the browser it runs in is signed OUT of eBay, so the fetch
// leg comes back refused. That is a PASS here — it proves the request went out and the
// refusal was identified. Whether eBay serves sold data to a signed-IN automated session
// is the one question only a human with a real eBay login can answer. See EXTENSION.md.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = path.join(ROOT, 'extension');
const PORT = 3000; // must match a content_scripts match pattern in the manifest
const OVERALL_TIMEOUT_MS = 90_000;

// CHROME_PATH wins when set — branded Chrome refuses to load unpacked extensions, so a
// testing build usually has to be pointed at explicitly.
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const chrome = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!chrome) {
  console.log('SKIP: no Chrome found — this test needs a real browser.');
  process.exit(0);
}

// ─── Preflight: will this Chrome even load an unpacked extension? ────────────
//
// Branded Google Chrome (since ~v137) ignores --load-extension outright — the flag was
// locked down because malware abused it. Detect that FIRST: without the extension present
// every check below fails for a reason that has nothing to do with the code, and a test
// that cries wolf gets ignored the one time it's right. A short foreground run is used
// because a detached launch doesn't reliably surface Chrome's startup warnings.
function loadExtensionBlocked(bin) {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-probe-'));
  const r = spawnSync(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--enable-logging=stderr', '--v=0',
    `--user-data-dir=${probeDir}`,
    `--load-extension=${EXT_DIR}`,
    '--virtual-time-budget=1000', '--dump-dom', 'about:blank',
  ], { encoding: 'utf8', timeout: 45_000 });
  const combined = String(r.stdout || '') + String(r.stderr || '');
  try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}
  return /--load-extension is not allowed/.test(combined);
}

if (loadExtensionBlocked(chrome)) {
  console.log('');
  console.log('extension end-to-end');
  console.log('  SKIP  this Chrome refuses --load-extension:');
  console.log(`        ${chrome}`);
  console.log('        Branded Google Chrome blocks the flag. To run this test, install a');
  console.log('        testing build and add its path to CHROME_CANDIDATES:');
  console.log('          npx @puppeteer/browsers install chrome@stable');
  console.log('');
  console.log('        Until then the extension must be checked by hand:');
  console.log('        chrome://extensions -> Developer mode -> Load unpacked -> extension/');
  console.log('');
  process.exit(0);
}

// ─── The page under test ─────────────────────────────────────────────────────
//
// Deliberately written against the SAME postMessage protocol app/lib/ext-client.ts speaks,
// so a change to one that isn't mirrored in the other surfaces here as a timeout rather
// than in production as a dead Connect button.
const HARNESS = `<!doctype html><html><body><h1>FlipSonar extension test</h1><script>
const PROTOCOL = 1;
let seq = 0;
const pending = new Map();
window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.origin !== window.location.origin) return;
  const d = ev.data;
  if (!d || d.__fs !== PROTOCOL || d.dir !== 'res') return;
  const r = pending.get(d.id);
  if (r) { pending.delete(d.id); r(d); }
});
function ask(type, payload, ms) {
  const id = ++seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => { pending.delete(id); resolve(null); }, ms);
    pending.set(id, (v) => { clearTimeout(t); resolve(v); });
    window.postMessage(Object.assign({ __fs: PROTOCOL, dir: 'req', id, type }, payload), window.location.origin);
  });
}
(async () => {
  const out = {};
  const ping = await ask('ping', {}, 5000);
  out.ping = ping ? { ok: ping.ok, version: ping.version } : null;
  if (ping && ping.ok) {
    const sold = await ask('fetchSold', { keywords: 'nike air max 90' }, 40000);
    out.fetch = sold ? {
      ok: sold.ok,
      httpStatus: sold.httpStatus,
      error: sold.error,
      htmlBytes: typeof sold.html === 'string' ? sold.html.length : 0,
      title: typeof sold.html === 'string' ? (sold.html.match(/<title>([^<]*)<\\/title>/i) || ['', ''])[1] : '',
      wentToEbay: typeof sold.finalUrl === 'string' && sold.finalUrl.indexOf('ebay.') !== -1,
      finalUrl: sold.finalUrl,
    } : null;
  }
  await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
})();
</script></body></html>`;

let resolveResult;
const resultPromise = new Promise((r) => { resolveResult = r; });

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(204).end();
      try { resolveResult(JSON.parse(body)); } catch { resolveResult({ parseError: body }); }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' }).end(HARNESS);
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-e2e-'));
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  `--disable-extensions-except=${EXT_DIR}`,
  `--load-extension=${EXT_DIR}`,
  `http://localhost:${PORT}/`,
], { stdio: 'ignore' });

const result = await Promise.race([
  resultPromise,
  new Promise((r) => setTimeout(() => r('TIMEOUT'), OVERALL_TIMEOUT_MS)),
]);

proc.kill();
server.close();
// Windows holds file locks briefly after Chrome exits, and a temp profile we couldn't
// delete must never fail the test.
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

// ─── Report ──────────────────────────────────────────────────────────────────

let failures = 0;
function check(name, pass, detail = '') {
  if (pass) console.log(`  PASS  ${name}${detail ? '  — ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}

console.log('');
console.log('extension end-to-end (real Chrome, signed OUT of eBay)');

if (result === 'TIMEOUT') {
  console.log('  FAIL  harness never reported back — extension did not load, or the bridge never answered');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
check('extension loads and the bridge injects', !!result.ping?.ok, result.ping ? `v${result.ping.version}` : 'no ping response');
check('manifest version matches the loaded one', result.ping?.version === manifest.version, `manifest ${manifest.version}`);

const f = result.fetch;
if (!f) {
  check('service worker answered the fetch request', false, 'no response');
} else {
  check('service worker answered the fetch request', f.ok === true || !!f.error, f.error ? `error: ${f.error}` : `http ${f.httpStatus}`);
  check('the request actually reached eBay', f.wentToEbay === true, f.finalUrl || 'no final URL');
  check('a page body came back', (f.htmlBytes ?? 0) > 0, `${f.htmlBytes} bytes, title: ${JSON.stringify(f.title)}`);
}

console.log('');
if (failures) {
  console.log(`${failures} FAILED`);
} else {
  console.log('all passed — the full page -> bridge -> worker -> eBay path works.');
  console.log('Signed OUT, eBay refuses (expected). Whether a signed-IN session serves');
  console.log('sold data is the one thing only a human with a real eBay login can confirm.');
}
console.log('');
process.exit(failures ? 1 : 0);
