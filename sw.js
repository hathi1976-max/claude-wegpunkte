/* WegLog Service Worker
   Strategie: network-first für die eigene App (damit Updates sofort ankommen),
   Cache dient nur als Offline-Fallback. Karten-Tiles, Leaflet-CDN und Nominatim
   nie cachen – die müssen live sein bzw. sind zu groß/volatil für den Cache. */
const CACHE = 'weglog-v2';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/geo.js',
  './js/format.js',
  './js/storage.js',
  './js/tracking.js',
  './js/geocode.js',
  './js/ui.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Externe Dienste immer live aus dem Netz, nie aus dem Cache
  if (url.hostname.includes('openstreetmap') || url.hostname.includes('unpkg.com') || url.hostname.includes('tile.')) return;

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
  }
});
