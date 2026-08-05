/* Persistenz in localStorage. Einziger Ort, der Speicherschluessel kennt. */

export const LS_SETTINGS = 'weglog.settings';
export const LS_ACTIVE = 'weglog.active';
export const LS_HISTORY = 'weglog.history';
export const LS_GEOCACHE = 'weglog.geocache';

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

function lies(key, fallback){
  try { return JSON.parse(store.getItem(key) ?? fallback); }
  catch { return JSON.parse(fallback); }
}

export function loadSettings(){
  try { return { ...defaultSettings, ...JSON.parse(store.getItem(LS_SETTINGS) || '{}') }; }
  catch { return { ...defaultSettings }; }
}
export function saveSettings(settings){ store.setItem(LS_SETTINGS, JSON.stringify(settings)); }

export function loadActive(){ return lies(LS_ACTIVE, 'null'); }
export function saveActive(active){
  if (active) store.setItem(LS_ACTIVE, JSON.stringify(active));
  else store.removeItem(LS_ACTIVE);
}

export function loadHistory(){ return lies(LS_HISTORY, '[]'); }
export function saveHistory(aufzeichnungen){ store.setItem(LS_HISTORY, JSON.stringify(aufzeichnungen)); }

export function loadGeocache(){ return lies(LS_GEOCACHE, '{}'); }
export function saveGeocache(geocache){ store.setItem(LS_GEOCACHE, JSON.stringify(geocache)); }
