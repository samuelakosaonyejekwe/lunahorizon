// "Use offline / in airplane mode": save every file the app needs (data/offline.json) through the service worker, show
// how much is saved, protect the saved copy from automatic clean-up, and show when the device is offline.
import { h, toast } from './ui.js';

const KEY = 'lh.offlineTip';
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
let state = { saved: 0, total: 0, bytes: 0, busy: false, done: 0, failed: 0, persisted: false, checked: false };

export const supported = () => 'serviceWorker' in navigator && 'caches' in window && location.protocol !== 'file:';

async function manifest() {
  const r = await fetch('data/offline.json', { cache: 'no-cache' }).catch(() => null) || await caches.match('data/offline.json');
  if (!r || !r.ok) throw new Error('offline list unavailable');
  const m = await r.json();
  const files = m.files.map(([p]) => p).filter((p) => p !== 'vendor/fflate.js' || typeof DecompressionStream === 'undefined');
  return { urls: ['./', 'data/offline.json', ...files], bytes: m.bytes };
}

/** How much of the app is saved on this device: one listing per cache (fast; nothing left running if the page closes) */
let leaving = false;
addEventListener('pagehide', () => { leaving = true; });
export async function refresh() {
  if (!supported()) { state.checked = true; notify(); return state; }
  try {
    const m = await manifest();
    const have = new Set();
    for (const name of (await caches.keys()).filter((k) => k.startsWith('lh-'))) {   // this app's caches only
      if (leaving) return state;
      for (const req of await (await caches.open(name)).keys()) have.add(new URL(req.url).pathname);
    }
    if (leaving) return state;
    const saved = m.urls.filter((u) => have.has(new URL(u, location.href).pathname)).length;
    state = { ...state, saved, total: m.urls.length, bytes: m.bytes, checked: true };
    state.persisted = !!(await navigator.storage?.persisted?.());
  } catch (e) { state.checked = true; }
  if (!leaving) notify();
  return state;
}
export const isSaved = () => state.total > 0 && state.saved >= state.total;

/** Download everything not yet saved, in small batches through the service worker */
export async function saveAll() {
  if (!supported() || state.busy) return;
  state.busy = true; state.done = 0; state.failed = 0; notify();
  try {
    // ask for protection from automatic clean-up, but never wait for it: Firefox shows the user a permission prompt and
    // its promise stays pending until they answer, which would stall the download
    try { navigator.storage?.persist?.().then((ok) => { state.persisted = !!ok; notify(); }, () => {}); } catch (e) { /* not supported */ }
    const reg = await navigator.serviceWorker.ready;
    const sw = navigator.serviceWorker.controller || reg.active;
    const m = await manifest(); const urls = m.urls;
    state.total = urls.length;
    for (let i = 0; i < urls.length; i += 20) {
      const batch = urls.slice(i, i + 20);
      const res = await new Promise((resolve) => {
        let timer;
        const finish = (r) => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('message', onMsg); resolve(r); };
        // no reply within 90 s (service worker replaced by an update, or the browser stopped it): report and let the user retry
        const arm = () => { clearTimeout(timer); timer = setTimeout(() => finish({ failed: batch.length, timedOut: true }), 90000); };
        const onMsg = (e) => {
          if (e.data?.type !== 'save-offline') return;
          state.done = i + e.data.done; notify(); arm();
          if (e.data.finished) finish(e.data);
        };
        navigator.serviceWorker.addEventListener('message', onMsg);
        arm(); sw.postMessage({ type: 'save-offline', urls: batch });
      });
      state.failed += res.failed;
      if (res.timedOut) break;
    }
  } catch (e) { state.failed = state.failed || 1; }
  state.busy = false;
  await refresh();
  toast(isSaved() ? 'Saved: LunaHorizon now works fully offline and in airplane mode.' : 'Some files could not be saved. Check the connection and tap Save again; it resumes where it stopped.', 6000);
}

const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;

/** The "Offline & airplane mode" panel used in the Install dialog and in Settings */
export function offlinePanel() {
  const box = h('div.offpanel');
  let shown = false;
  const render = () => {
    if (shown && !box.isConnected) { listeners.delete(render); return; }   // Settings closed and rebuilt: drop the old panel
    shown = box.isConnected;
    if (!supported()) {
      box.replaceChildren(h('p', { style: { margin: 0 } }, 'This browser cannot keep the app for offline use. Use Safari on iOS 11.3 or newer, or a current Chrome, Edge, Firefox or Samsung Internet.'));
      return;
    }
    const pct = state.busy ? Math.round(100 * state.done / Math.max(1, state.total)) : Math.round(100 * state.saved / Math.max(1, state.total));
    const status = !state.checked ? 'Checking what is saved on this device…'
      : state.busy ? `Saving… ${state.done} of ${state.total} files`
        : isSaved() ? `Ready for airplane mode ✓ Everything is saved on this device (${mb(state.bytes)}).`
          : `${state.saved} of ${state.total} files saved. Pages you have opened already work offline; save everything to use every page, map year and terrain spot with no connection.`;
    box.replaceChildren(
      h('p', { style: { margin: 0 } }, status),
      h('div.offbar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('span', { style: { width: pct + '%' } })),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        isSaved() && !state.busy ? h('button.btn.small', { onclick: saveAll }, 'Check for updates') : h('button.btn.small.primary', { disabled: state.busy, onclick: saveAll }, state.busy ? 'Saving…' : `Save everything for offline (${state.bytes ? mb(state.bytes) : 'about 12 MB'})`),
        state.persisted ? h('small.muted', 'Protected from automatic clean-up') : null),
      h('small.muted', 'Offline use: open the app once with a connection, save, then it works in airplane mode. On iPhone, save inside the installed app (its storage is separate from Safari).'));
  };
  listeners.add(render); render();
  if (!state.checked) refresh();
  return box;
}

/** Home banner: shown on every device until everything is saved (or dismissed) */
export function offlineBanner() {
  const box = h('div');
  const dismissed = () => { try { return localStorage.getItem(KEY) === 'dismissed'; } catch (e) { return false; } };
  const render = () => {
    if (!supported() || !state.checked || isSaved() || dismissed()) { box.replaceChildren(); return; }
    box.replaceChildren(h('div.installtip', { role: 'region', 'aria-label': 'Use offline' },
      h('div.ic', { html: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M2 16l20-6-4 10-5-4-3 3v-5z"/></svg>' }),
      h('div.tx', h('b', 'Use it offline and in airplane mode'),
        h('span', state.busy ? `Saving… ${state.done} of ${state.total} files` : `Save the whole app on this device (${state.bytes ? mb(state.bytes) : 'about 12 MB'}) and every page works with no connection.`)),
      h('div.act', h('button.btn.small.primary', { disabled: state.busy, onclick: saveAll }, state.busy ? 'Saving…' : 'Save'),
        h('button.iconbtn', { 'aria-label': 'Dismiss', title: 'Don\'t show again', onclick: () => { try { localStorage.setItem(KEY, 'dismissed'); } catch (e) { /* private mode */ } render(); }, html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }))));
  };
  listeners.add(render); render();
  if (!state.checked) refresh();
  return { el: box, destroy: () => listeners.delete(render) };
}

/** Top-bar "Offline" pill and notices when the connection drops or returns */
export function wireNetworkIndicator(pill) {
  const sync = async (announce) => {
    const off = navigator.onLine === false;
    pill.hidden = !off; document.documentElement.classList.toggle('is-offline', off);
    if (!announce) return;
    if (off) await refresh();                                            // check what is saved only when it matters
    toast(off ? (isSaved() ? 'Offline: LunaHorizon keeps working from the copy saved on this device.' : 'Offline: pages you have opened keep working. Save everything (Settings) to use the whole app offline.') : 'Back online.', 5000);
  };
  addEventListener('offline', () => sync(true));
  addEventListener('online', () => sync(true));
  sync(false);
}
