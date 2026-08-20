// ─── FlipSonar eBay Connector — page bridge (content script) ─────────────────
//
// Runs only on flipsonar.io (see manifest content_scripts matches) and does one thing:
// carry messages between the page and the service worker, which is the only component
// allowed to touch eBay.
//
// The page and a content script share a DOM but not a JavaScript context, so they cannot
// call each other directly — window.postMessage is the only channel, and this file is
// both ends of it. It carries no eBay logic of its own: keywords in, raw HTML out.

const PROTOCOL = 1;

/** Reply to the page. Same-window, same-origin only — never a wildcard target. */
function reply(payload) {
  window.postMessage({ __fs: PROTOCOL, dir: 'res', ...payload }, window.location.origin);
}

window.addEventListener('message', (ev) => {
  // Only accept messages this page sent to itself. Anything from an iframe, an opener,
  // or another origin is ignored — this bridge fetches with the user's eBay cookies
  // attached, so it must never be reachable by embedded third-party content.
  if (ev.source !== window || ev.origin !== window.location.origin) return;

  const req = ev.data;
  if (!req || req.__fs !== PROTOCOL || req.dir !== 'req') return;

  const { id, type, keywords } = req;

  // Answered here rather than in the service worker so presence detection is instant
  // even when Chrome has let the worker go idle.
  if (type === 'ping') {
    reply({ id, type, ok: true, version: chrome.runtime.getManifest().version });
    return;
  }

  if (type === 'fetchSold') {
    try {
      chrome.runtime.sendMessage({ type: 'fs:fetchSold', keywords }, (res) => {
        // Set when the worker died mid-flight or the extension was reloaded/updated
        // underneath a page that is still open.
        const err = chrome.runtime.lastError;
        if (err) return reply({ id, type, ok: false, error: err.message });
        reply({ id, type, ...(res || { ok: false, error: 'no response' }) });
      });
    } catch (e) {
      // Thrown when the extension context is gone entirely (updated or disabled while
      // the page stayed open). The page turns this into "reconnect", not a scan error.
      reply({ id, type, ok: false, error: 'extension reloaded — refresh the page' });
    }
    return;
  }

  reply({ id, type, ok: false, error: 'unknown request' });
});

// Announce on load. Chrome does NOT inject content scripts into tabs that were already
// open when the extension was installed, so a fresh install still needs a page refresh —
// this covers re-injection and page navigations, and the page also pings on mount, which
// is what actually drives detection.
window.postMessage(
  { __fs: PROTOCOL, dir: 'evt', type: 'ready', version: chrome.runtime.getManifest().version },
  window.location.origin,
);
