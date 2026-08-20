// ─── Popup: is the eBay session actually working? ────────────────────────────
//
// "Am I signed in to eBay?" is not a question the user can answer by looking at eBay —
// the site looks normal signed out, and only the SOLD filters are gated. So the popup
// answers it the only way that means anything: it runs a real sold search through the
// same path a scan uses and reports what came back.
//
// It classifies with the shared app/lib/ebay-dom module rather than its own regexes, so
// the popup can never disagree with the scan about what "connected" means.

import { classifyPage } from './lib/ebay-dom.js';

const PROBE = 'nike air max 90'; // ordinary product, deep sold history — empty means broken

const dot = document.getElementById('dot');
const headline = document.getElementById('headline');
const detail = document.getElementById('detail');
const actions = document.getElementById('actions');

function render(state, title, text, buttons = []) {
  dot.className = `dot ${state}`;
  headline.textContent = title;
  detail.textContent = text;
  actions.innerHTML = '';
  for (const b of buttons) {
    const a = document.createElement('a');
    a.className = b.ghost ? 'btn ghost' : 'btn';
    a.textContent = b.label;
    a.href = b.href;
    a.target = '_blank';
    a.rel = 'noreferrer';
    actions.appendChild(a);
  }
}

const SIGN_IN = { label: 'Sign in to eBay →', href: 'https://signin.ebay.com/ws/eBayISAPI.dll?SignIn' };
const OPEN_SCAN = { label: 'Open FlipSonar', href: 'https://www.flipsonar.io/scan', ghost: true };

chrome.runtime.sendMessage({ type: 'fs:fetchSold', keywords: PROBE }, (res) => {
  if (chrome.runtime.lastError || !res?.ok) {
    render('bad', "Couldn't reach eBay", chrome.runtime.lastError?.message || res?.error || 'Network error.', [OPEN_SCAN]);
    return;
  }

  const doc = new DOMParser().parseFromString(res.html, 'text/html');
  const refusal = classifyPage(res.html, doc.title || '');

  if (refusal === 'blocked' || /^https:\/\/signin\.ebay\./i.test(res.finalUrl || '')) {
    render('bad', 'Not signed in to eBay', 'eBay only shows sold prices to signed-in users. Sign in once and this turns green.', [SIGN_IN, OPEN_SCAN]);
    return;
  }
  if (refusal === 'throttled' || res.httpStatus === 403 || res.httpStatus === 429) {
    render('warn', 'eBay is throttling', 'eBay is challenging requests from this session right now. Wait a few minutes before scanning.', [OPEN_SCAN]);
    return;
  }
  render('ok', 'eBay connected', 'Sold prices are readable. FlipSonar scans will use this session.', [OPEN_SCAN]);
});
