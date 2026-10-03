// "Install as an app" on every device: detects the browser, captures the Chromium install prompt, and drives the
// Install button in the top bar, the Install dialog, the Home-page banner and the Settings section.
import { h, toast } from './ui.js';
import { offlinePanel } from './offline.js';

const KEY = 'lh.installTip';
let deferred = null;                       // Chrome/Edge/Samsung/Opera "beforeinstallprompt" event, kept for one-tap install
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();                      // our own button replaces the browser's mini-infobar
  deferred = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  dismiss();
  notify();
  toast('LunaHorizon installed. Open it from your home screen, Start menu, Launchpad or app list.');
});

export function isInstalled() {
  const mm = (q) => window.matchMedia && matchMedia(q).matches;
  return mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || mm('(display-mode: minimal-ui)') || mm('(display-mode: window-controls-overlay)') || navigator.standalone === true;
}

/** Browser, OS and version details that decide which install route works */
export function detect() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);   // iPadOS 13+ reports a Mac
  const m = ua.match(/OS (\d+)_(\d+)/);
  const iosVer = ios ? (m ? +m[1] + +m[2] / 100 : 99) : 0;                                         // iPadOS desktop UA hides it: assume current
  const android = /Android/.test(ua);
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|TikTok|musical_ly|Snapchat|LinkedInApp|Pinterest|; wv\)|GSA\//.test(ua);
  let browser = 'other';
  if (ios) browser = /CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : /OPiOS|OPT\//.test(ua) ? 'opera' : /Safari/.test(ua) ? 'safari' : 'other';
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/Edg\//.test(ua) || /EdgA\//.test(ua)) browser = 'edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'opera';
  else if (/Firefox\//.test(ua)) browser = 'firefox';
  else if (/MiuiBrowser|XiaoMi/.test(ua)) browser = 'mi';
  else if (/UCBrowser/.test(ua)) browser = 'uc';
  else if (/YaBrowser/.test(ua)) browser = 'yandex';
  else if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) browser = 'chrome';     // also Brave and Vivaldi, which hide their names
  else if (/Safari\//.test(ua)) browser = 'safari';
  const sv = ua.match(/Version\/(\d+)/);
  const os = ios ? 'ios' : android ? 'android' : /CrOS/.test(ua) ? 'chromeos' : /Mac OS X|Macintosh/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'other';
  return { ios, iosVer, android, inApp, browser, os, safariVer: sv ? +sv[1] : 0, mobile: ios || android };
}

/** Kept for callers that only need the family */
export function platform() {
  const d = detect();
  if (d.ios) return 'ios';
  if (d.browser === 'samsung') return 'samsung';
  if (d.android) return d.browser === 'firefox' ? 'firefox' : 'android';
  return 'desktop';
}

const dismissed = () => { try { return localStorage.getItem(KEY) === 'dismissed'; } catch { return false; } };
function dismiss() { try { localStorage.setItem(KEY, 'dismissed'); } catch { /* private mode */ } }

/** Open the app's start page in Chrome on Android (an intent URL may contain only one '#', so the route is dropped) */
function chromeIntent() {
  const u = new URL(location.href);
  const page = u.origin + u.pathname;
  return `intent://${u.host}${u.pathname}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(page)};end`;
}
const startUrl = () => { const u = new URL(location.href); return u.origin + u.pathname; };

async function copyLink() {
  try { await navigator.clipboard.writeText(startUrl()); toast('Link copied. Paste it into the browser named above.'); }
  catch { toast(startUrl(), 8000); }
}

export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred; deferred = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  notify();
  return !!choice && choice.outcome === 'accepted';
}

const SHARE = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

/**
 * Install route for this browser: a short line (banner), numbered steps (dialog) and an optional action.
 * Every route ends in a real app icon; where a browser cannot install apps the steps point to one that can.
 */
export function route(d = detect()) {
  const r = (title, steps, action, note) => ({ title, steps, action, note, text: steps.length === 1 ? steps[0] : steps.map((s, i) => `${i + 1}. ${s}`).join(' ') });
  if (deferred) return r('Install in one tap', ['Tap Install, then confirm.'], { label: 'Install', run: promptInstall }, 'Opens full screen in its own window and works offline.');
  if (d.inApp) {
    return d.android
      ? r('Open in your browser first', ['This page is inside another app, which cannot install apps. Tap "Open in Chrome", then install from there.'], { label: 'Open in Chrome', href: chromeIntent() })
      : r('Open in Safari first', ['This page is inside another app, which cannot install apps.', 'Tap the ••• or share menu and choose "Open in Safari" (or copy the link and paste it into Safari).', 'Then tap Share ' + SHARE + ' and "Add to Home Screen".'], { label: 'Copy link', run: copyLink });
  }
  if (d.ios) {
    if (d.browser === 'safari' || d.iosVer >= 16.4) {
      const where = d.browser === 'safari' ? 'Tap the Share button ' + SHARE + ' (bottom bar on iPhone, top bar on iPad).'
        : d.browser === 'chrome' ? 'Tap the Share button ' + SHARE + ' in the address bar.'
          : 'Open the browser menu and tap Share ' + SHARE + '.';
      return r('Add to your Home Screen', [where, 'Scroll down and tap "Add to Home Screen".', 'Tap "Add". Open LunaHorizon from its new icon.'], null,
        d.iosVer < 11.3 ? 'On this iOS version the icon opens the site full screen; offline use needs iOS 11.3 or newer.' : 'Open it from the icon once while online so it saves itself for offline use.');
    }
    return r('Use Safari to install', ['On iOS before 16.4 only Safari can add apps to the Home Screen.', 'Copy the link, open Safari and paste it.', 'Tap Share ' + SHARE + ', then "Add to Home Screen".'], { label: 'Copy link', run: copyLink });
  }
  if (d.android) {
    switch (d.browser) {
      case 'samsung': return r('Install from Chrome', ['Samsung Internet\'s "Install as web app" is blocked on newer Android versions.', 'Tap "Open in Chrome", then ⋮ → "Install app".', 'Or here: ☰ → "Add page to" → "Home screen" (a shortcut).'], { label: 'Open in Chrome', href: chromeIntent() });
      case 'firefox': return r('Install from Firefox', ['Tap the ⋮ menu.', 'Tap "Install" (or "Add to Home screen").', 'Confirm "Add".']);
      case 'edge': return r('Install from Edge', ['Tap the ⋯ menu at the bottom.', 'Tap "Add to phone" (or "Install app").', 'Confirm.']);
      case 'opera': return r('Install from Opera', ['Tap the ⋮ menu.', 'Tap "Add to" → "Home screen".', 'Confirm.']);
      case 'chrome': return r('Install from Chrome', ['Tap the ⋮ menu (top right).', 'Tap "Install app" or "Add to Home screen" → "Install".', 'Confirm. If neither appears, the page is still loading: wait a few seconds and reopen the menu.']);
      default: return r('Install from your browser', ['Open the browser menu.', 'Choose "Add to Home screen" or "Install app".', 'If the menu has neither, tap "Open in Chrome" and install there.'], { label: 'Open in Chrome', href: chromeIntent() });
    }
  }
  // computers
  if (d.browser === 'safari') {
    return d.os === 'mac' && d.safariVer >= 17
      ? r('Add to your Dock', ['In Safari\'s menu bar choose File → "Add to Dock…".', 'Click "Add". LunaHorizon opens in its own window from the Dock or Launchpad.'])
      : r('Install with Chrome or Edge', ['This Safari version cannot install web apps (Safari 17 on macOS Sonoma or newer can: File → Add to Dock).', 'Open this page in Chrome or Edge and click the install icon in the address bar.'], { label: 'Copy link', run: copyLink });
  }
  if (d.browser === 'firefox') return r('Install with Chrome or Edge', ['Firefox on computers does not install web apps.', 'Open this page in Chrome, Edge or Brave and click the install icon at the right of the address bar.', 'Or keep using it here: everything works in a normal tab.'], { label: 'Copy link', run: copyLink });
  if (d.browser === 'edge') return r('Install from Edge', ['Click the "App available" icon at the right of the address bar (or open ⋯ → Apps → "Install this site as an app").', 'Click "Install". It appears in the Start menu, Launchpad or app list.']);
  return r('Install from your browser', ['Click the install icon (a monitor with a down arrow) at the right of the address bar. No icon? Open ⋮ → "Cast, save and share" → "Install page as app" (older Chrome: ⋮ → "Install LunaHorizon").', 'Click "Install". It appears in the Start menu, Launchpad, app list or shelf.']);
}

function actionButton(a, small) {
  if (!a) return null;
  const cls = small ? '.btn.small.primary' : '.btn.primary';
  if (a.href) return h('a' + cls, { href: a.href, rel: 'noopener' }, a.label);
  return h('button' + cls, { onclick: async () => { const ok = await a.run(); if (a.run === promptInstall && !ok) toast('Install cancelled. Use the Install button any time.'); } }, a.label);
}

/** Numbered steps for one route */
function stepsList(x) {
  return h('ol.isteps', x.steps.map((s) => h('li', { html: s })));
}

/** Every platform at a glance, for people installing on another device */
const ALL = [
  ['iPhone and iPad', 'Safari: Share → "Add to Home Screen". iOS 16.4+: the same from Chrome, Edge or Firefox.'],
  ['Android', 'Chrome: ⋮ → "Install app". Firefox: ⋮ → "Install". Edge: ⋯ → "Add to phone". Samsung Internet: open in Chrome.'],
  ['Windows, Linux, ChromeOS', 'Chrome, Edge or Brave: the install icon at the right of the address bar.'],
  ['Mac', 'Chrome or Edge: install icon in the address bar. Safari 17+: File → "Add to Dock".'],
];

/** The Install dialog: this device's steps first, then every other platform */
export function openInstallDialog() {
  let d = document.getElementById('install');
  if (!d) { d = h('dialog#install', { 'aria-labelledby': 'install-title' }); document.body.append(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
  const render = () => {
    if (isInstalled()) {
      d.replaceChildren(head(), h('div.dlg-b', h('p', 'LunaHorizon is already installed on this device. Open it from your home screen or app list.'),
        h('section', h('h3', { style: { margin: '0 0 8px' } }, 'Use it offline and in airplane mode'), offlinePanel())));
      return;
    }
    const x = route();
    d.replaceChildren(head(),
      h('div.dlg-b',
        h('section', h('h3', { style: { margin: '0 0 8px' } }, x.title), stepsList(x),
          x.action ? h('div', { style: { marginTop: '10px' } }, actionButton(x.action)) : null,
          x.note ? h('p.muted', { style: { margin: '10px 0 0', fontSize: '13px' } }, x.note) : null),
        h('section', h('h3', { style: { margin: '0 0 8px' } }, 'Why install'),
          h('p', { style: { margin: 0, color: 'var(--text-2)' } }, 'Its own icon and full-screen window, a faster start, and it works with no connection.')),
        h('section', h('h3', { style: { margin: '0 0 8px' } }, 'Use it offline and in airplane mode'), offlinePanel()),
        h('details.allplat', h('summary', 'Installing on a different device'),
          h('dl', ALL.map(([k, v]) => [h('dt', k), h('dd', v)]))),
        h('small.muted', 'Installing is optional: the full app also works in any browser tab.')));
  };
  function head() {
    return h('div.dlg-h', h('h2#install-title', 'Install LunaHorizon'),
      h('button.iconbtn', { 'aria-label': 'Close', onclick: () => d.close(), html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }));
  }
  render();
  listeners.add(render);
  d.addEventListener('close', () => listeners.delete(render), { once: true });
  if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
  else { d.classList.add('fallback'); d.setAttribute('open', ''); d.close = () => { d.removeAttribute('open'); d.dispatchEvent(new Event('close')); }; }
}

/** Top-bar Install button: always offered until the app runs installed */
export function wireInstallButton(btn) {
  const sync = () => { btn.hidden = isInstalled(); btn.classList.toggle('ready', !!deferred); };
  btn.addEventListener('click', () => { if (deferred) promptInstall(); else openInstallDialog(); });
  listeners.add(sync);
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', sync);
  sync();
}

/** True when the Home install banner is not showing (installed or dismissed) */
export const installBannerHidden = () => isInstalled() || dismissed();

/** One-time Home-page banner on every device (hidden once installed or dismissed) */
export function installBanner() {
  const box = h('div');
  const render = () => {
    if (isInstalled() || dismissed()) { box.replaceChildren(); return; }
    const x = route();
    box.replaceChildren(h('div.installtip', { role: 'region', 'aria-label': 'Install LunaHorizon' },
      h('div.ic', { html: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3M10 18h4"/></svg>' }),
      h('div.tx', h('b', 'Install LunaHorizon'), h('span', deferred ? 'Its own icon and window, and it works offline.' : `${x.title}. ${detect().mobile ? 'Tap' : 'Click'} "How" for the steps.`)),
      h('div.act', deferred ? actionButton(x.action, true) : h('button.btn.small.primary', { onclick: openInstallDialog }, 'How'),
        h('button.iconbtn', { 'aria-label': 'Dismiss', title: 'Don\'t show again', onclick: () => { dismiss(); render(); }, html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }))));
  };
  listeners.add(render);
  render();
  return { el: box, destroy: () => listeners.delete(render) };
}

/** Settings section (always available) */
export function installSection() {
  if (isInstalled()) return h('p.muted', { style: { margin: 0 } }, 'LunaHorizon is installed on this device.');
  const x = route();
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('p', { style: { margin: 0, color: 'var(--text-2)' } }, h('b', x.title), ': ', h('span', { html: x.text })),
    h('div', h('button.btn.small.primary', { onclick: () => { document.getElementById('settings')?.close(); openInstallDialog(); } }, x.action?.run === promptInstall ? 'Install' : 'Show steps')),
    h('small', 'Installing is optional: the full app also works in any browser tab.'));
}
