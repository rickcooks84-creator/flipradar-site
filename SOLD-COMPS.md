# Sold comps on the web — why "just use the user's eBay" is harder than it sounds

_Last updated 2026-08-25._

This is the canonical answer to the question that keeps coming back: **the user is signed into
eBay, so why can't flipsonar.io just use that session to pull sold prices?**

It's a fair question with a specific answer, and the answer is not "eBay won't let us."

---

## The blocker is reading the response, not signing in

Since **2026-07-22** eBay serves sold/completed listings only to signed-in sessions. A
signed-out request to `/sch/i.html?…&LH_Sold=1&LH_Complete=1` returns **HTTP 200 with a
"Sign in or Register" page and zero result cards** — indistinguishable from "this product
never sold" unless you look for it. That much is just a login wall.

The part that actually blocks us is what happens when the user *is* signed in.

When JavaScript on flipsonar.io calls that sold-search URL:

1. The request goes out.
2. eBay answers it, with the user's session applied.
3. **The browser refuses to hand the answer to our page.**

Step 3 is the [same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy).
eBay's search pages send no `Access-Control-Allow-Origin` header, so the browser blocks
flipsonar.io from reading a cross-origin response — even though the cookies rode along and
even though eBay was happy to answer. In `no-cors` mode you get an opaque response: a result
you are not permitted to look at.

This rule exists precisely to stop site A from reading site B's logged-in data. It runs on the
user's machine, enforced by their browser. eBay cannot waive it for us and neither can we.

**Verified, not assumed** (see `EXTENSION.md` for the full test matrix):

| attempted path | result |
|---|---|
| Signed-out scrape, any IP | dead — the wall is session-based, not IP-based |
| ScraperAPI, incl. `premium=true` / `render=true` | dead — returns the sign-in page |
| Residential home IP + warmed cookie jar + full browser headers | dead — same wall |
| `.co.uk`, `.ca` | dead — global, not a US A/B test |
| Finding API `findCompletedItems` | retired — HTTP 418 |
| Browse API | wrong data — active listings, not sold |
| Marketplace Insights API | not granted — `invalid_scope` |

Hammering it escalates to eBay's `splashui/challenge` interstitial.

## Why the OAuth connection doesn't rescue it

FlipSonar now supports connecting an eBay account on the web (`/api/ebay/connect`, shipped
2026-08-25). It's a real connection and worth having — but it does not produce sold comps, and
that's structural rather than unfinished:

- **OAuth authorizes API calls.** There is no sold-comps API to authorize. eBay's only official
  sold endpoint is Marketplace Insights.
- **Marketplace Insights is scoped to the app, not the user.** eBay grants
  `buy.marketplace.insights` to a developer application after review. A user consenting cannot
  grant a permission eBay never gave the app. Our request returns `invalid_scope`.

So a user can connect successfully and still get no comps. The UI reports `connected` and
`insights` as two separate facts for exactly this reason.

### Is Marketplace Insights realistic?

It's a **Limited Release** API — partner/enterprise gated, reviewed case by case over
days-to-weeks, and solo apps are commonly declined. EPN membership is the main lever that
moves the odds.

Worth knowing: `invalid_scope` means the grant was **never issued**. It is not evidence that an
application was submitted and rejected. Applying costs ~20 minutes and the justification text is
already drafted (see the application guide). Treat it as a free lottery ticket, not a plan.

## The real question: what code is allowed to read eBay's response?

Every workable answer is still "use the user's own eBay." They differ only in *where the request
runs* — which decides whether anything is allowed to read the reply.

| context | can read eBay's response? | why | status |
|---|---|---|---|
| flipsonar.io JavaScript | **no** | same-origin policy, no CORS headers | permanently dead |
| Desktop app (Electron) | **yes** | not a web page; `net.request` on a real partition | **works today** |
| Browser extension | **yes** | host permissions are the documented exception to CORS | **built and shipped, then pulled** (`403c97c`) |
| Hosted browser (Browserbase) | **yes** | a real browser we drive server-side; the user signs in | open — needs an API key |

Two paths are deliberately excluded:

- **Collecting eBay usernames/passwords.** Against eBay's terms, defeated by 2FA and captchas,
  gets accounts banned, and makes us hold credentials we should never hold. Not on the table.
- **Having users paste their eBay cookies.** Same credential problem with worse UX, and it
  breaks on every session rotation.

## Where this leaves the decision

- **The extension already solved this.** The user signs into eBay normally, the extension's
  service worker fetches the sold page with their own session, and the site parses it —
  `app/lib/ebay-dom.js` is the shared parser. It is the only option with no per-scan cost. It
  was pulled from `/scan` in `403c97c`; the code is still in `extension/`.
- **Browserbase does the same job for money.** A cloud browser per user, billed on proxy
  bandwidth at roughly $10–12/GB, on every scan, forever. `npm run spike:browserbase` is ready
  and waiting on an API key. Note the user still has to sign into eBay either way — so if the
  objection to the extension was "users shouldn't have to do a setup step," this does not fix
  that.
- **The desktop app works today** and needs no decision.

The open question is not technical. It's whether the extension's install step or Browserbase's
per-scan bill is the more acceptable cost.

## Related docs

- `EXTENSION.md` — the extension's design and the full test matrix behind the table above.
- `app/lib/ebay-oauth.ts` — the eBay account connection, and what it does and doesn't unlock.
- `app/lib/ebay.ts` — the comps engine; `fetchInsightsItems` is the path that lights up if
  Insights is ever granted.
