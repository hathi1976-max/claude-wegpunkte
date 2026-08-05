/* WegLog Service Worker

   Drei Caches mit drei Strategien:

   - CACHE   (eigene Dateien): Netz zuerst, damit Updates sofort ankommen;
             der Cache ist der Offline-Rückfall.
   - VENDOR  (Leaflet vom CDN): Cache zuerst. Die URL ist auf eine feste
             Version gepinnt, da ändert sich nichts mehr. Wird beim Install
             mitgeholt, damit die Karte auch offline eine Bibliothek hat.
   - KACHELN (OSM-Kartenkacheln): Cache zuerst, mit Deckel. Damit ist die
             Karte auf schon einmal betrachteten Strecken auch im Funkloch da.

   Nominatim wird nie gecacht – Ortsnamen sind Live-Abfragen. */

const VERSION = 'v5';
const CACHE = 'weglog-' + VERSION;
const VENDOR = 'weglog-vendor-leaflet-1.9.4';
const KACHELN = 'weglog-kacheln-v1';

/* Deckel für den Kachelcache. Eine OSM-Kachel liegt bei 15–40 kB, 600 Stück
   sind also grob 10–25 MB. */
const KACHEL_MAX = 600;
/* Prüfen kostet ein keys() über den ganzen Cache – nicht bei jeder Kachel. */
const KACHEL_PRUEFINTERVALL = 25;

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
  './js/export.js',
  './js/ui.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
];

/* Muss mit den Verweisen in index.html übereinstimmen – tests/version.test.js
   hält das fest. */
const VENDOR_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // Fremde Dateien dürfen die Installation nicht scheitern lassen: ohne
    // Leaflet ist die Karte kaputt, die Aufzeichnung aber nicht.
    const v = await caches.open(VENDOR);
    await Promise.all(VENDOR_URLS.map(async url => {
      if (await v.match(url)) return;
      try {
        const resp = await fetch(url, { mode: 'cors' });
        if (resp.ok) await v.put(url, resp);
      } catch { /* offline installiert – kommt beim ersten Online-Aufruf nach */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const behalten = [CACHE, VENDOR, KACHELN];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !behalten.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Ortsnamen sind Live-Abfragen und gehören in keinen Cache
  if (url.hostname.includes('nominatim')) return;

  if (istKachel(url)){ e.respondWith(kachel(e.request)); return; }
  if (istVendor(url)){ e.respondWith(vendor(e.request)); return; }
  if (url.origin === self.location.origin){ e.respondWith(eigenes(e.request)); }
});

function istKachel(url){
  return /(^|\.)tile\./.test(url.hostname);
}

function istVendor(url){
  return url.hostname === 'unpkg.com';
}

/* Eigene Dateien: Netz zuerst, Cache als Rückfall. Nur erfolgreiche Antworten
   werden abgelegt – ein gecachtes 404 wäre schlimmer als gar keins. */
async function eigenes(request){
  try {
    const resp = await fetch(request);
    if (resp.ok){
      const kopie = resp.clone();
      caches.open(CACHE).then(c => c.put(request, kopie)).catch(() => {});
    }
    return resp;
  } catch {
    const hit = await caches.match(request);
    return hit || await caches.match('./index.html');
  }
}

/* Leaflet: Cache zuerst. Die Version steckt in der URL, ein Update kommt also
   nur über eine geänderte URL – dann ist der Cache-Eintrag ein Fehltreffer und
   wird neu geholt. */
async function vendor(request){
  const c = await caches.open(VENDOR);
  const hit = await c.match(request);
  if (hit) return hit;
  const resp = await fetch(request);
  if (resp.ok) c.put(request, resp.clone()).catch(() => {});
  return resp;
}

/* Kacheln: Cache zuerst, mit Deckel.

   Verworfen wird nach Einfügereihenfolge (FIFO), nicht nach letzter Nutzung.
   Der Review schlug LRU vor; echtes LRU hieße, jede getroffene Kachel neu zu
   schreiben oder einen Index nebenher zu führen. Für den Zweck – dieselbe
   Strecke mehrfach fahren – verwerfen FIFO und LRU praktisch dieselben
   Kacheln, und die Cache-API liefert keys() ohnehin in Einfügereihenfolge. */
let kachelZaehler = 0;

async function kachel(request){
  const c = await caches.open(KACHELN);
  const hit = await c.match(request);
  if (hit) return hit;
  const resp = await fetch(request);
  if (resp.ok){
    await c.put(request, resp.clone());
    if (++kachelZaehler % KACHEL_PRUEFINTERVALL === 0) beschneideKacheln(c);
  }
  return resp;
}

async function beschneideKacheln(c){
  try {
    const keys = await c.keys();
    const zuviel = keys.length - KACHEL_MAX;
    if (zuviel <= 0) return;
    // Etwas mehr wegnehmen als nötig, damit nicht bei jeder Kachel aufgeräumt wird
    const weg = keys.slice(0, zuviel + Math.floor(KACHEL_MAX * 0.1));
    await Promise.all(weg.map(k => c.delete(k)));
  } catch { /* Aufräumen ist Kür, nie Pflicht */ }
}
