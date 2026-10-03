// App shell: router, settings dialog, theme, share, service worker.
import { $, $$, h, settings, updateSettings, loadSites, toast, setUrlOwner, SETTING_RANGES } from './ui.js';
import { RELAYS } from './astro.js';
import { installSection, wireInstallButton } from './install.js';   // also captures the browser's install prompt early
import { offlinePanel, wireNetworkIndicator } from './offline.js';

const ROUTES = {
  '': () => import('./views/home.js'),
  map: () => import('./views/map.js'),
  site: () => import('./views/site.js'),
  compare: () => import('./views/compare.js'),
  planner: () => import('./views/planner.js'),
  learn: () => import('./views/learn.js'),
  '3d': () => import('./views/view3d.js'),
};
const TITLES = { '': 'Home', map: 'Site Map', site: 'Explorer', compare: 'Compare Sites', planner: 'Landing Window Finder', learn: 'Learn', '3d': '3D South Pole' };

let current = null, currentKey = null, navSeq = 0, shownSeq = 0;
const main = $('#main');

function parseHash() {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const dec = (p) => { try { return decodeURIComponent(p); } catch { return p; } };   // a mangled link (bad % escape) must not stop the router
  const parts = path.split('/').filter(Boolean).map(dec);
  return { name: parts[0] || '', params: parts.slice(1) };
}

async function route() {
  const { name, params } = parseHash();
  // The whole hash is the key: in-page state changes use history.replaceState, which fires no hashchange,
  // so a hashchange with a new query is a real navigation (a shared link, a button) and must remount.
  const key = location.hash || '#/';
  // Same page as the one on screen, and no other page still loading: just update it. (While another page loads, going
  // back to the current one must still win, or the slower page would mount under this page's URL.)
  if (key === currentKey && current && shownSeq === navSeq) { current.update?.(params); return; }
  const loader = ROUTES[name] || ROUTES[''];
  const my = ++navSeq;
  setUrlOwner(null);              // the old page may no longer touch the URL
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  let mod;
  try { mod = await loader(); } catch (e) { main.replaceChildren(h('div.page', h('div.card', 'Could not load this page. Check your connection and reload.'))); return; }
  if (my !== navSeq) return;
  try { current?.unmount?.(); } catch { /* ignore */ }
  const page = h('div.page');
  main.replaceChildren(page);
  document.title = `${TITLES[name] || 'Home'} · LunaHorizon`;
  currentKey = key; shownSeq = my;
  setUrlOwner(ROUTES[name] ? name : '');
  current = mod.mount(page, params) || {};
  if (!location.hash.includes('?')) window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ settings dialog
function num(label, key, unit, hint) {
  const [min, max, step] = SETTING_RANGES[key];
  const out = h('output', fmtV(settings[key]));
  function fmtV(v) { return `${v}${unit || ''}`; }
  const inp = h('input', { type: 'range', min, max, step, value: settings[key], 'aria-label': label,
    oninput: () => { out.textContent = fmtV(+inp.value); }, onchange: () => updateSettings({ [key]: +inp.value }) });
  return h('label.field', h('span', label, out), inp, hint ? h('small', hint) : null);
}
function openSettings() {
  const d = $('#settings');
  const sel = (key, opts) => h('select', { onchange: (e) => { updateSettings({ [key]: e.target.value }); if (key === 'theme') applyTheme(); } },
    opts.map(([v, l]) => h('option', { value: v, selected: settings[key] === v }, l)));
  d.replaceChildren(
    h('div.dlg-h', h('h2#settings-title', 'Settings'), h('button.iconbtn', { 'aria-label': 'Close', onclick: () => d.close(), html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' })),
    h('div.dlg-b',
      h('fieldset', h('legend', 'Display'),
        h('div.formgrid',
          h('label.field', h('span', 'Time zone'), sel('tz', [['utc', 'UTC (mission standard)'], ['local', 'My local time']])),
          h('label.field', h('span', 'Theme'), sel('theme', [['auto', 'Match system'], ['dark', 'Dark'], ['light', 'Light']]))))
      ,
      h('fieldset', h('legend', 'Visibility rules'),
        h('div.formgrid',
          h('label.field', h('span', 'Solar array & antenna height'), h('select', { onchange: (e) => updateSettings({ mastM: +e.target.value }) },
            [[2, '2 m above ground (lander deck)'], [10, '10 m above ground (mast or tower)']].map(([v, l]) => h('option', { value: v, selected: settings.mastM === v }, l))),
            h('small', 'Nearby slopes block a low Sun; a taller mast sees past them')),
          num('Sun counts as "up" at', 'sunMinFrac', '', 'Fraction of the solar disk above terrain'),
          num('Earth terrain clearance', 'earthMarginDeg', '°', 'Line-of-sight margin for the antenna'),
          num('DSN antenna mask', 'dsnMinEl', '°', 'Min Moon elevation at a DSN station')),
        h('label.check', { style: { marginTop: '10px' } }, h('input', { type: 'checkbox', checked: settings.requireDSN, onchange: (e) => updateSettings({ requireDSN: e.target.checked }) }),
          'Direct-to-Earth requires a Deep Space Network station in view')),
      h('fieldset', h('legend', 'Relay satellite'),
        h('div.formgrid',
          h('label.field', h('span', 'Relay orbiter'), sel('relay', Object.entries(RELAYS).map(([k, r]) => [k, r.name]))),
          num('Relay terrain clearance', 'relayMaskDeg', '°', 'Min angle above the skyline')),
        h('p.muted', { style: { fontSize: '12px', margin: '8px 0 0' } }, 'Representative orbits for coverage studies, not official ephemerides. With a relay, communications count when either Earth or the relay (which must itself see Earth) is in view.')),
      h('fieldset', h('legend', 'Power system'),
        h('div.formgrid',
          h('label.field', h('span', 'Solar array'), sel('panel', [['vtrack', 'Vertical, Sun-tracking'], ['vfixed', 'Vertical, fixed azimuth'], ['horizontal', 'Horizontal (deck)']])),
          num('Array azimuth (fixed)', 'panelAz', '°'),
          num('Array area', 'panelArea', ' m²'),
          num('Cell efficiency', 'panelEff', ''),
          num('Platform load', 'loadW', ' W'),
          num('Battery (usable)', 'batteryWh', ' Wh'))),
      h('fieldset', h('legend', 'Install as an app'), installSection()),
      h('fieldset', h('legend', 'Offline & airplane mode'), offlinePanel()),
      h('div.row', h('button.btn', { onclick: () => { localStorage.removeItem('lh.settings'); location.reload(); } }, 'Reset to defaults'),
        h('span.spacer', { style: { flex: 1 } }), h('button.btn.primary', { onclick: () => d.close() }, 'Done')),
    ),
  );
  if (typeof d.showModal === 'function') d.showModal();
  else { d.classList.add('fallback'); d.setAttribute('open', ''); d.close = () => d.removeAttribute('open'); }
}

function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  window.dispatchEvent(new Event('themechange'));
}

$('#btn-settings').addEventListener('click', openSettings);
wireInstallButton($('#btn-install'));
wireNetworkIndicator($('#net-offline'));
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') e.target.close(); });
$('#btn-theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  updateSettings({ theme: dark ? 'light' : 'dark' });
  applyTheme();
});
$('#btn-share').addEventListener('click', async () => {
  const url = location.href;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: document.title, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied: it reopens this exact view'); }
  } catch (e) { if (e && e.name !== 'AbortError') toast(url, 6000); }   // closing the share sheet is not an error
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => window.dispatchEvent(new Event('themechange')));

// ------------------------------------------------------------------ boot
window.addEventListener('hashchange', route);
loadSites().then(route).catch((e) => {
  main.replaceChildren(h('div.page', h('div.card', h('h2', 'Could not load site data'), h('p', String(e.message)), h('p.muted', 'Serve the app folder over HTTP (for example: python3 -m http.server) and reload.'))));
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker?.register('sw.js').catch(() => {}));
}
