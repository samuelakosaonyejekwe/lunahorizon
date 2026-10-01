// "Install as an app" help: detects the browser, captures Chrome's install prompt, and renders the
// Home-page banner and the Settings section with instructions that work on that browser.
import { h, toast } from './ui.js';

const KEY = 'lh.installTip';
let deferred = null;                       // Chrome/Edge/Samsung "beforeinstallprompt" event, kept for the Install button
const listeners = new Set();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();                      // we show our own button instead of the mini-infobar
  deferred = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  dismiss();
  listeners.forEach((fn) => fn());
  toast('LunaHorizon installed. Open it from your home screen.');
});

export function isInstalled() {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
}

/** Which browser family we are in, for the right instructions */
export function platform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Android/.test(ua) && /Firefox/.test(ua)) return 'firefox';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const dismissed = () => { try { return localStorage.getItem(KEY) === 'dismissed'; } catch { return false; } };
function dismiss() { try { localStorage.setItem(KEY, 'dismissed'); } catch { /* private mode */ } }

/** Open the app's start page in Chrome on Android (an intent URL may contain only one '#', so the route is dropped) */
function chromeIntent() {
  const u = new URL(location.href);
  const page = u.origin + u.pathname;
  return `intent://${u.host}${u.pathname}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(page)};end`;
}

async function promptInstall() {
  if (!deferred) return false;
  const e = deferred; deferred = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  listeners.forEach((fn) => fn());
  return choice && choice.outcome === 'accepted';
}

/** Instruction lines and actions for this browser */
function help() {
  const p = platform();
  if (deferred) return { text: 'Works offline and opens full screen, like a regular app.', action: { label: 'Install', run: promptInstall } };
  if (p === 'ios') return { text: 'Tap the Share button (square with an arrow), then "Add to Home Screen".' };
  if (p === 'samsung') return {
    text: 'Samsung Internet\'s "Install as web app" is blocked on newer Android versions. Open this page in Chrome to install it, or tap ☰ → Add page to → Home screen.',
    action: { label: 'Open in Chrome', href: chromeIntent() },
  };
  if (p === 'firefox') return { text: 'Tap the ⋮ menu, then "Install".' };
  if (p === 'android') return { text: 'Tap the ⋮ menu, then "Install app" (or "Add to Home screen").' };
  return { text: 'In Chrome or Edge, use the install icon in the address bar. On a phone, use the browser menu → "Add to Home screen".' };
}

function actionButton(a, small) {
  if (!a) return null;
  const cls = small ? 'a.btn.small.primary' : 'a.btn.primary';
  if (a.href) return h(cls, { href: a.href, rel: 'noopener' }, a.label);
  return h(small ? 'button.btn.small.primary' : 'button.btn.primary', { onclick: async () => { const ok = await a.run(); if (!ok) toast('Install cancelled. You can install any time from Settings.'); } }, a.label);
}

/** One-time Home-page banner (phones and tablets only, hidden once installed or dismissed) */
export function installBanner() {
  const box = h('div');
  const render = () => {
    if (isInstalled() || dismissed() || !isTouchDevice()) { box.replaceChildren(); return; }
    const x = help();
    box.replaceChildren(h('div.installtip', { role: 'region', 'aria-label': 'Install LunaHorizon' },
      h('div.ic', { html: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3M10 18h4"/></svg>' }),
      h('div.tx', h('b', 'Install LunaHorizon'), h('span', x.text)),
      h('div.act', actionButton(x.action, true),
        h('button.iconbtn', { 'aria-label': 'Dismiss', title: 'Don\'t show again', onclick: () => { dismiss(); render(); }, html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }))));
  };
  listeners.add(render);
  render();
  return { el: box, destroy: () => listeners.delete(render) };
}

/** Settings section (always available) */
export function installSection() {
  if (isInstalled()) return h('p.muted', { style: { margin: 0 } }, 'LunaHorizon is installed on this device.');
  const x = help();
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('p', { style: { margin: 0, color: 'var(--text-2)' } }, x.text),
    x.action ? h('div', actionButton(x.action, true)) : null,
    h('small', 'Installing is optional: the full app also works in any browser tab.'));
}
