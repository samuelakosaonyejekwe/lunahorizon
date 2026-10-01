// Offline support. App code: network-first, so updates show up immediately.
// Data: cache-first, since it is large and immutable per version.
// Bump VERSION whenever anything under data/ changes: data files are served cache-first.
const VERSION = 'lh-v6';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/ui.js', 'js/astro.js', 'js/engine.js', 'js/charts.js', 'js/worker.js', 'js/jobs.js', 'js/gz.js', 'js/install.js',
  'js/views/home.js', 'js/views/map.js', 'js/views/site.js', 'js/views/compare.js', 'js/views/planner.js', 'js/views/learn.js', 'js/views/view3d.js',
  'data/sites.json', 'data/horizons10.json', 'data/meta.json', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
const LAZY = ['data/basemap.jpg', 'data/basemap_zoom.jpg', 'data/overlay.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => caches.open(VERSION)).then((c) => c.addAll(LAZY).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = url.pathname.includes('/data/') && !url.pathname.endsWith('.json');
  if (isData) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    })));
  } else {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});
