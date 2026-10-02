// Offline support. App code: network-first, so updates show up immediately.
// Data: cache-first, since it is large and immutable per version.
// Two caches, so an app update never throws away terrain a user downloaded for offline use:
//   VERSION: the app shell, replaced on every release.
//   DATA:    data/ files (tiles, maps, terrain). Bump it ONLY when anything under data/ changes, since data is served cache-first.
const VERSION = 'lh-v8';
const DATA = 'lh-data-6';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/ui.js', 'js/astro.js', 'js/engine.js', 'js/charts.js', 'js/worker.js', 'js/jobs.js', 'js/gz.js', 'js/install.js',
  'js/views/home.js', 'js/views/map.js', 'js/views/site.js', 'js/views/compare.js', 'js/views/planner.js', 'js/views/learn.js', 'js/views/view3d.js',
  'data/sites.json', 'data/horizons10.json', 'data/meta.json', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
const LAZY = ['data/basemap.jpg', 'data/basemap_zoom.jpg', 'data/overlay.png'];
// Browsers without a built-in gzip decoder (Safari before 16.4, Chrome before 80) need the bundled one to read terrain offline
const FALLBACK = typeof DecompressionStream === 'undefined' ? ['vendor/fflate.js'] : [];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll([...SHELL, ...FALLBACK]))
    .then(() => caches.open(DATA)).then((c) => Promise.all(LAZY.map((u) => c.match(u).then((hit) => hit || c.add(u)))).catch(() => {}))
    .then(() => self.skipWaiting()));
});
// Before the shell and data caches were split (lh-v6) everything lived in one cache; keep its downloads (same data as DATA)
async function migrate() {
  if (!(await caches.has('lh-v6'))) return;
  const [old, data] = await Promise.all([caches.open('lh-v6'), caches.open(DATA)]);
  for (const req of await old.keys()) {
    const p = new URL(req.url).pathname;
    if (p.includes('/data/') && !p.endsWith('.json') && !(await data.match(req))) await data.put(req, await old.match(req));
  }
}
self.addEventListener('activate', (e) => {
  e.waitUntil(migrate().catch(() => {}).then(() => caches.keys()).then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = url.pathname.includes('/data/') && !url.pathname.endsWith('.json');
  if (isData) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(DATA).then((c) => c.put(e.request, copy))); }
      return res;
    }).catch(() => new Response('', { status: 503, statusText: 'Offline' }))));   // not downloaded yet and no connection
  } else {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(VERSION).then((c) => c.put(e.request, copy))); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});
