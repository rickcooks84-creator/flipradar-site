# FlipSonar eBay Connector — how the web scanner reads sold prices

## The problem it solves

In July 2026 eBay stopped serving sold/completed listings to signed-out sessions. A sold
search now 200s and returns "Sign in or Register" with zero result cards — indistinguishable
from "this product never sold" unless you look for it.

Every server-side way around it is dead, verified:

| path | status |
|---|---|
| Signed-out scrape, any IP | dead — session-based, not IP-based |
| ScraperAPI (plain and `premium=true`) | dead — returns the sign-in page |
| Marketplace Insights API | denied — `invalid_scope` (a grant problem, not credentials) |
| Finding API `findCompletedItems` | retired — HTTP 418 |
| Browse API | wrong data — active listings, not sold |

Reading sold data requires a signed-in eBay session, and **a website can never borrow one**:

- eBay's cookies are `HttpOnly` and scoped to `.ebay.com`, so flipsonar.io's JavaScript can
  never read them.
- eBay's search pages send no `Access-Control-Allow-Origin`, so the browser blocks the page
  from reading a cross-origin response even when the cookies ride along.
- A Vercel function has no user session at all — which is why `IS_DESKTOP` is false there
  and the site falls back to the walled ScraperAPI path.

A browser extension with host permissions is the one context in the browser that can make
that request. That's what this is.

> **"Sign in with eBay" (OAuth) does not solve this.** A user token unlocks Browse (active
> listings) and the user's own selling data. The only official sold endpoint is Marketplace
> Insights, and that grant was refused.

## How it works

```
  flipsonar.io/scan
        │  postMessage  { keywords }
        ▼
  bridge.js  (content script, runs only on flipsonar.io)
        │  chrome.runtime.sendMessage
        ▼
  background.js  (service worker — the ONLY component that touches eBay)
        │  fetch(sold search, credentials: 'include')   ← the user's own session
        ▼
  raw HTML back to the page
        │
        ▼
  app/lib/ext-client.ts   parses with DOMParser + app/lib/ebay-dom.js
        │  POST { query, cost, status, items }
        ▼
  /api/comp-items  →  relevance gate + comp maths + score   (server-side)
```

Two design decisions are load-bearing:

**Parsing lives on the site, not in the extension.** eBay has changed its result-card
layout three times and each change silently zeroed out comps. If the parser shipped inside
the extension, every one of those would need a Chrome Web Store review — days of every user
reading zero comps. Returning raw HTML means a layout fix is a site deploy that takes effect
immediately, for everyone.

**Scoring stays server-side.** The extension supplies listings; the relevance gate, the
sub-assembly price floor and the comp maths run in `/api/comp-items` and
`/api/vehicle-comp-items`. Items arriving from a browser are treated as untrusted input.

**The page sends keywords, never a URL.** The service worker builds the eBay URL itself. An
extension that fetched arbitrary URLs with the user's cookies attached would be a
general-purpose credentialed proxy for anything running on flipsonar.io.

## Credentials

The eBay session stays in the browser's own cookie jar. Nothing is read out of it, copied,
or sent to a FlipSonar server. FlipSonar never sees an eBay password — the user signs in on
eBay's own site, exactly as they normally would.

## Pacing

A scan fires one lookup per product, far more eBay searches in a row than ordinary browsing.
The service worker enforces a **350 ms floor between requests and at most 3 concurrent**,
which is why the site's client pool of 6 simply queues behind it. Pacing lives in the
extension because that is where requests actually leave the browser — a user with two tabs
open still gets one shared rate. The site additionally rests between scans (250 ms per
lookup, 30 s floor, 15 m cap, persisted to `localStorage`).

Users are advised to scan with a **separate eBay account**, not their selling account.

## Files

| file | role |
|---|---|
| `extension/manifest.json` | MV3 manifest. Host permission: `https://*.ebay.com/*` only. |
| `extension/background.js` | Service worker. Paced fetch, returns raw HTML. No parsing. |
| `extension/bridge.js` | Content script on flipsonar.io. Message relay, no eBay logic. |
| `extension/popup.js` | Runs a real sold search and reports connected / signed out / throttled. |
| `extension/lib/ebay-dom.js` | **Generated** from `app/lib/ebay-dom.js` by `npm run ext:build`. |
| `app/lib/ebay-dom.js` | The single source of truth for eBay's page shape. Edit HERE. |
| `app/lib/ebay-cheerio.ts` | Server-side parser using that same contract. |
| `app/lib/ext-client.ts` | Browser half: talks to the extension, parses, classifies. |

## Commands

```bash
npm run ext:build     # sync the shared parser into extension/, zip to public/
npm run build         # runs ext:build first, so the download can never go stale
npm run test:parser   # cheerio parser vs DOMParser — must agree exactly
npm run test:ext      # loads the real extension in real Chrome, drives the whole path
```

`test:ext` needs a Chrome that will load an unpacked extension. **Branded Google Chrome
refuses `--load-extension`** (locked down because malware abused it), so use a testing build:

```bash
npx @puppeteer/browsers install chrome@stable --path /tmp/browsers
CHROME_PATH=/tmp/browsers/chrome/.../chrome.exe npm run test:ext
```

## What is verified, and what is not

**Verified** (2026-08-20, real Chrome for Testing 152, signed OUT of eBay):

- The MV3 extension loads and the content script injects on a matching origin.
- The page → bridge → service worker → eBay → page round trip works.
- The service worker builds and requests the correct sold-search URL, and a body comes back.
- The cheerio parser and the DOMParser parser produce **byte-identical** output on a fixture
  covering all three card layouts, the promo placeholder, price ranges, missing prices, and
  eBay's fuzzy filler.
- Sign-in wall and bot-challenge pages are classified correctly by both sides.

**NOT verified — do this first:**

> **Nobody has confirmed that eBay serves sold data to an automated _signed-in_ session.**

Everything here rests on it. The test machine is signed out, and eBay currently answers it
with `403 / "Error Page"` regardless of session — this network is being challenged on its
own, so a local test would not settle the question anyway.

To settle it, on a normal machine:

1. `npm run ext:build`, then load `extension/` via `chrome://extensions` → Developer mode →
   Load unpacked.
2. Sign in to eBay in that browser — **use a burner buyer account, not a selling account.**
3. Click the extension's toolbar icon.

Three outcomes:

- **"eBay connected"** → unwalled. Comps are free and unlimited on the web, and the metered-API
  pricing problem goes away.
- **"Not signed in to eBay"** while genuinely signed in → eBay is refusing automated
  signed-in reads. This whole approach dies and the only remaining option is a metered
  sold-comps API at ~$0.0015/lookup, which forces a pricing conversation.
- **"eBay is throttling"** → challenged; try from a different network before concluding
  anything.

## Distribution

`public/flipsonar-ebay-connector.zip` is generated by the build and served for a
Developer-mode install. For a Chrome Web Store listing, upload the same zip; note that once
listed, **the parser still lives on the site**, so layout fixes never wait on store review.
