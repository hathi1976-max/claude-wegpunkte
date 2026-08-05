/* Persistenz in localStorage. Einziger Ort, der Speicherschluessel kennt.

   Jeder Schreibvorgang geht durch persist(): localStorage ist begrenzt
   (ueblich 5 MB), und ein voller Speicher darf nicht still Daten
   verschlucken – der Aufrufer bekommt false und der Nutzer eine Meldung. */

export const LS_SETTINGS = 'weglog.settings';
export const LS_ACTIVE = 'weglog.active';
export const LS_HISTORY = 'weglog.history';
export const LS_GEOCACHE = 'weglog.geocache';

/* Was Browser ueblicherweise je Herkunft zulassen. Nur fuer die Anzeige –
   die tatsaechliche Grenze meldet erst der Fehler beim Schreiben. */
export const UEBLICHE_GRENZE = 5 * 1024 * 1024;

/* Deckel fuer den Ortscache. Er waechst ueber alle Fahrten hinweg und wird
   sonst nie kleiner. */
export const GEOCACHE_MAX = 2000;

export const defaultSettings = {
  walkInt: 5,   // Min, Geschwindigkeit < walkMax
  bikeInt: 2,   // Min, walkMax..bikeMax
  carInt: 1,    // Min, > bikeMax
  pauseMin: 3,  // Min Stillstand bis 'Pause'
  useGeocode: true,
};

/* Der Speicher ist injizierbar, damit Tests gegen eine Attrappe laufen
   koennen, ohne echte Aufzeichnungen anzufassen. */
let store = typeof localStorage !== 'undefined' ? localStorage : null;
export function setzeSpeicher(s){ store = s; }

/* Wird von app.js auf ui.zeigeBanner gesetzt. storage.js selbst kennt kein
   DOM – sonst waeren die Tests darauf angewiesen. */
let melder = null;
export function setzeMelder(fn){ melder = fn; }
function melde(text, art){ if (melder) melder(text, art); }

export function istQuotaFehler(e){
  if (!e) return false;
  return e.name === 'QuotaExceededError'
    || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'   // Firefox
    || e.code === 22 || e.code === 1014;
}

/* Liefert true, wenn geschrieben wurde. Bei false ist der Wert nur im
   Arbeitsspeicher – der Aufrufer darf ihn nicht als gesichert behandeln. */
export function persist(key, wert){
  try {
    store.setItem(key, JSON.stringify(wert));
    return true;
  } catch (e){
    if (istQuotaFehler(e)){
      melde('Speicher voll – die letzte Änderung wurde NICHT gespeichert. '
        + 'Bitte unter ⚙︎ sichern und alte Aufzeichnungen löschen.', 'error');
    } else {
      melde('Speichern fehlgeschlagen: ' + (e && e.message ? e.message : e), 'error');
    }
    console.error('Speichern fehlgeschlagen', key, e);
    return false;
  }
}

function lies(key, fallback){
  try { return JSON.parse(store.getItem(key) ?? fallback); }
  catch { return JSON.parse(fallback); }
}

export function loadSettings(){
  try { return { ...defaultSettings, ...JSON.parse(store.getItem(LS_SETTINGS) || '{}') }; }
  catch { return { ...defaultSettings }; }
}
export function saveSettings(settings){ return persist(LS_SETTINGS, settings); }

export function loadActive(){ return lies(LS_ACTIVE, 'null'); }
export function saveActive(active){
  if (active) return persist(LS_ACTIVE, active);
  try { store.removeItem(LS_ACTIVE); return true; }
  catch (e){ console.error('Entfernen fehlgeschlagen', LS_ACTIVE, e); return false; }
}

export function loadHistory(){ return lies(LS_HISTORY, '[]'); }
export function saveHistory(aufzeichnungen){ return persist(LS_HISTORY, aufzeichnungen); }

/* Ortscache: {schluessel: {ort, t}}. Fruehere Staende hielten nur den
   Ortsnamen als Zeichenkette – ohne Zeitstempel laesst sich nicht sagen,
   welcher Eintrag der aelteste ist. Die werden hier normalisiert. */
export function loadGeocache(){
  const roh = lies(LS_GEOCACHE, '{}');
  const cache = {};
  for (const [k, v] of Object.entries(roh || {})){
    if (typeof v === 'string') cache[k] = { ort: v, t: 0 };
    else if (v && typeof v.ort === 'string') cache[k] = { ort: v.ort, t: Number(v.t) || 0 };
  }
  return cache;
}
export function saveGeocache(geocache){ return persist(LS_GEOCACHE, geocache); }

/* Aeltestes zuerst verwerfen, bis der Deckel eingehalten ist. Rein, damit
   sich das Ausduennen nachrechnen laesst. */
export function deckleGeocache(geocache, max = GEOCACHE_MAX){
  const schluessel = Object.keys(geocache);
  if (schluessel.length <= max) return geocache;
  schluessel.sort((a, b) => (geocache[a].t || 0) - (geocache[b].t || 0));
  const behalten = {};
  for (const k of schluessel.slice(schluessel.length - max)) behalten[k] = geocache[k];
  return behalten;
}

/* ---------- Hausputz ---------- */

/* Belegung in Zeichen. localStorage rechnet in UTF-16-Einheiten, deshalb ist
   die Zeichenzahl das passende Mass – nicht die Byte-Zahl nach UTF-8. */
export function belegung(){
  const eintraege = [LS_HISTORY, LS_ACTIVE, LS_GEOCACHE, LS_SETTINGS].map(k => {
    let roh = null;
    try { roh = store.getItem(k); } catch { roh = null; }
    return { schluessel: k, zeichen: roh ? roh.length : 0 };
  });
  return { zeichen: eintraege.reduce((s, e) => s + e.zeichen, 0), eintraege };
}

/* Liefert {behalten, entfernt}: Aufzeichnungen, deren Ende (ersatzweise
   Beginn) laenger als 'tage' zurueckliegt, gelten als alt. */
export function teileNachAlter(aufzeichnungen, tage, jetzt = Date.now()){
  const grenze = jetzt - tage * 86400000;
  const behalten = [], entfernt = [];
  for (const s of aufzeichnungen){
    const ende = s.endTime || s.startTime || 0;
    (ende < grenze ? entfernt : behalten).push(s);
  }
  return { behalten, entfernt };
}
