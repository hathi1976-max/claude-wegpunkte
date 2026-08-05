/* B4: Nominatim-Anbindung.

   Es geht hier nie eine echte Anfrage ins Netz – Nominatim ist ein fremder,
   gedrosselter Dienst. fetchFn, Uhr und Wartefunktion werden hineingereicht. */

import { gruppe, test, gleich, wahr } from './lauf.js';
import {
  erstelleGeocoder, baueUrl, geocodeKey, ortAusAntwort, istAbfuhr,
  MIN_ABSTAND_MS, SPERRE_MS,
} from '../js/geocode.js';

const ruhe = () => new Promise(r => setTimeout(r, 0));

/* Uhr und Wartefunktion unter Kontrolle: sonst dauerte ein Test der
   Drosselung mehrere Sekunden. */
function fakeUhr(){
  let jetzt = 0;
  const auftraege = [];
  return {
    jetzt: () => jetzt,
    warte: (fn, ms) => auftraege.push({ fn, faellig: jetzt + ms }),
    offen: () => auftraege.length,
    async vor(ms){
      jetzt += ms;
      for (let runde = 0; runde < 50; runde++){
        const i = auftraege.findIndex(a => a.faellig <= jetzt);
        if (i < 0) break;
        const [a] = auftraege.splice(i, 1);
        a.fn();
        await ruhe();
      }
    },
  };
}

function antwort(status, koerper){
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => koerper,
  };
}

/* Baut einen Geocoder samt Mitschrieb. */
function bau({ settings = { useGeocode: true, kontakt: '' }, antworten = [], cache = {} } = {}){
  const uhr = fakeUhr();
  const aufrufe = [];
  const meldungen = [];
  const geocoder = erstelleGeocoder({
    getSettings: () => settings,
    getCache: () => cache,
    setCacheEintrag: (k, ort) => { cache[k] = { ort, t: uhr.jetzt() }; },
    onPointUpdated: () => meldungen.push(uhr.jetzt()),
    fetchFn: async url => {
      aufrufe.push(url);
      const naechste = antworten.shift();
      if (naechste instanceof Error) throw naechste;
      return naechste || antwort(200, { address: { village: 'Nirgendwo' } });
    },
    warte: uhr.warte,
    jetzt: uhr.jetzt,
  });
  return { geocoder, uhr, aufrufe, meldungen, cache };
}

function punkt(lat = 52.5, lon = 13.4){
  return { t: 0, lat, lon, acc: 10, speedKmh: 0, type: 'log', place: null };
}

gruppe('geocode: URL und Auswertung', () => {
  test('ohne Kontakt bleibt der email-Parameter weg', () => {
    const url = baueUrl(52.5, 13.4, '');
    gleich(url.includes('email='), false);
    wahr(url.startsWith('https://nominatim.openstreetmap.org/reverse?'), url);
    wahr(url.includes('lat=52.5&lon=13.4'), url);
  });

  test('mit Kontakt wird er angehaengt und kodiert', () => {
    gleich(baueUrl(1, 2, 'a b+c@x.de').endsWith('&email=a%20b%2Bc%40x.de'), true);
  });

  test('Leerraum um den Kontakt zaehlt nicht als Kontakt', () => {
    gleich(baueUrl(1, 2, '   ').includes('email='), false);
    gleich(baueUrl(1, 2, undefined).includes('email='), false);
  });

  test('geocodeKey rastert auf drei Nachkommastellen', () => {
    gleich(geocodeKey(52.50049, 13.39951), '52.500,13.400');
    gleich(geocodeKey(-0.0004, 0), '-0.000,0.000');
  });

  test('ortAusAntwort haelt die Rangfolge ein', () => {
    gleich(ortAusAntwort({ address: { village: 'V', town: 'T', city: 'C' } }), 'V');
    gleich(ortAusAntwort({ address: { town: 'T', city: 'C' } }), 'T');
    gleich(ortAusAntwort({ address: { county: 'K' }, display_name: 'D' }), 'K');
    gleich(ortAusAntwort({ display_name: 'D' }), 'D');
    gleich(ortAusAntwort({ address: {} }), null);
    gleich(ortAusAntwort(null), null);
  });

  test('istAbfuhr erkennt 429 und 403', () => {
    gleich(istAbfuhr(429), true);
    gleich(istAbfuhr(403), true);
    gleich(istAbfuhr(200), false);
    gleich(istAbfuhr(500), false);
  });
});

gruppe('geocode: Warteschlange', () => {
  test('ein Treffer im Cache loest keine Anfrage aus', async () => {
    const { geocoder, aufrufe, meldungen } = bau({ cache: { '52.500,13.400': { ort: 'Berlin', t: 1 } } });
    const p = punkt();
    geocoder.requestGeocode(p);
    await ruhe();
    gleich(aufrufe.length, 0, 'es wurde trotz Cache gefragt');
    gleich(p.place, 'Berlin');
    gleich(meldungen.length, 1);
  });

  test('abgeschaltetes Nachschlagen fragt gar nicht erst', async () => {
    const { geocoder, aufrufe } = bau({ settings: { useGeocode: false, kontakt: '' } });
    geocoder.requestGeocode(punkt());
    await ruhe();
    gleich(aufrufe.length, 0);
    gleich(geocoder.warteschlangeLaenge(), 0);
  });

  test('eine Antwort setzt Ortsname und Cache', async () => {
    const { geocoder, cache, aufrufe } = bau({
      antworten: [antwort(200, { address: { town: 'Kleinstadt' } })] });
    const p = punkt();
    geocoder.requestGeocode(p);
    await ruhe();
    gleich(aufrufe.length, 1);
    gleich(p.place, 'Kleinstadt');
    gleich(cache['52.500,13.400'].ort, 'Kleinstadt');
  });

  test('unbrauchbare Antwort wird als (unbekannt) vermerkt, aber nicht gecacht', async () => {
    // Sonst schriebe ein einzelner Serverfehler '(unbekannt)' fuer dieses
    // Rasterfeld dauerhaft fest
    const { geocoder, cache } = bau({ antworten: [antwort(500, null)] });
    const p = punkt();
    geocoder.requestGeocode(p);
    await ruhe();
    gleich(p.place, '(unbekannt)');
    gleich(Object.keys(cache).length, 0);
  });

  test('ein Netzfehler wird als (offline) vermerkt und nicht gecacht', async () => {
    const { geocoder, cache } = bau({ antworten: [new Error('kein Netz')] });
    const p = punkt();
    geocoder.requestGeocode(p);
    await ruhe();
    gleich(p.place, '(offline)');
    gleich(Object.keys(cache).length, 0);
  });

  test('zwei Punkte werden mit Mindestabstand abgefragt', async () => {
    const { geocoder, uhr, aufrufe } = bau();
    geocoder.requestGeocode(punkt(52.5, 13.4));
    geocoder.requestGeocode(punkt(52.6, 13.4));
    await ruhe();
    gleich(aufrufe.length, 1, 'beide Anfragen gingen sofort raus');
    await uhr.vor(MIN_ABSTAND_MS - 1);
    gleich(aufrufe.length, 1, 'zu frueh nachgelegt');
    await uhr.vor(1);
    gleich(aufrufe.length, 2);
  });
});

gruppe('geocode: Abfuhr durch Nominatim (429)', () => {
  test('bei 429 wird pausiert und der Punkt nicht verworfen', async () => {
    const { geocoder, uhr, aufrufe } = bau({
      antworten: [antwort(429, null), antwort(200, { address: { city: 'Spaetstadt' } })] });
    const p = punkt();
    geocoder.requestGeocode(p);
    await ruhe();
    gleich(aufrufe.length, 1);
    gleich(p.place, null, 'trotz Abfuhr ein Ortsname gesetzt');
    gleich(geocoder.warteschlangeLaenge(), 1, 'der Punkt ist verlorengegangen');
    gleich(geocoder.gesperrt(), true);
  });

  test('nach der Sperre wird derselbe Punkt erneut versucht', async () => {
    const { geocoder, uhr, aufrufe } = bau({
      antworten: [antwort(429, null), antwort(200, { address: { city: 'Spaetstadt' } })] });
    const p = punkt();
    geocoder.requestGeocode(p);
    await ruhe();
    await uhr.vor(SPERRE_MS + MIN_ABSTAND_MS);
    gleich(aufrufe.length, 2, 'kein zweiter Versuch');
    gleich(p.place, 'Spaetstadt');
    gleich(geocoder.gesperrt(), false);
    gleich(geocoder.warteschlangeLaenge(), 0);
  });

  test('waehrend der Sperre wird nicht weitergepumpt', async () => {
    const { geocoder, uhr, aufrufe } = bau({ antworten: [antwort(429, null)] });
    geocoder.requestGeocode(punkt(52.5, 13.4));
    geocoder.requestGeocode(punkt(52.7, 13.4));
    await ruhe();
    await uhr.vor(SPERRE_MS - 1000);
    gleich(aufrufe.length, 1, 'trotz Sperre nachgelegt');
  });
});
