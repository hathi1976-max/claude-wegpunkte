/* WegLog – Wegpunkte-Tracker

   Verdrahtet Geraet (GPS, Wake Lock), Speicher und Anzeige. Die Rechenwege
   liegen in geo.js und tracking.js, die Persistenz in storage.js. */

import { sessionDistanceKm } from './geo.js';
import {
  neuerZustand, leerZustand, zustandAusAufzeichnung, baueWegpunkt, schrittPosition,
} from './tracking.js';
import * as speicher from './storage.js';
import { erstelleGeocoder } from './geocode.js';
import { alsSicherung, leseSicherung, vereine, zeitstempelName } from './export.js';
import * as ui from './ui.js';

let settings = speicher.loadSettings();
let aufzeichnungen = speicher.loadHistory();
let geocache = speicher.loadGeocache();

// {id, startTime, points:[...], zustand:{...}} oder null
let laufendeAufzeichnung = speicher.loadActive();
// Altbestand ohne gespeicherten Zustand aus dem letzten Wegpunkt herstellen
if (laufendeAufzeichnung) laufendeAufzeichnung.zustand = zustandAusAufzeichnung(laufendeAufzeichnung);
// Der Aufzeichnungszustand gehoert zur Aufzeichnung und wird mit ihr gespeichert.
// Ausserhalb einer Aufzeichnung merkt sich diese Variable nur die letzte Rohposition.
let ruheZustand = leerZustand();
let watchId = null;
let wakeLockSentinel = null;

function holeZustand(){
  return laufendeAufzeichnung ? laufendeAufzeichnung.zustand : ruheZustand;
}

// ---------- Geocoding ----------
const geocoder = erstelleGeocoder({
  getSettings: () => settings,
  getCache: () => geocache,
  setCacheEintrag: (key, wert) => { geocache[key] = wert; speicher.saveGeocache(geocache); },
  onPointUpdated: () => {
    speicher.saveActive(laufendeAufzeichnung);
    ui.renderLive();
    if (ui.kartenAnsichtOffen()) ui.renderMap();
  },
});

// ---------- Anbindung der Anzeige ----------
ui.verbinde({
  getAktive: () => laufendeAufzeichnung,
  getAufzeichnungen: () => aufzeichnungen,
  getSettings: () => settings,
  getZustand: holeZustand,
  sessionById,
  onSessionLoeschen: session => {
    aufzeichnungen = aufzeichnungen.filter(s => s.id !== session.id);
    speicher.saveHistory(aufzeichnungen);
    ui.renderHistory();
    ui.fillMapSessionOptions();
  },
});

function sessionById(id){
  if (laufendeAufzeichnung && String(laufendeAufzeichnung.id) === String(id)) return laufendeAufzeichnung;
  return aufzeichnungen.find(s => String(s.id) === String(id));
}

// ---------- Tracking ----------
function nimmWegpunktAuf(point){
  laufendeAufzeichnung.points.push(point);
  speicher.saveActive(laufendeAufzeichnung);
  ui.renderLive();
  geocoder.requestGeocode(point);
}

function handlePosition(pos){
  const coords = pos.coords;
  const now = Date.now();
  const raw = { lat: coords.latitude, lon: coords.longitude, acc: coords.accuracy, t: now };
  ui.setGpsPill(true, coords.accuracy);

  if (!laufendeAufzeichnung){
    ruheZustand = { ...ruheZustand, lastRaw: raw };
    return;
  }

  const vorher = laufendeAufzeichnung.zustand;
  const ergebnis = schrittPosition(vorher, coords, now, settings);
  laufendeAufzeichnung.zustand = ergebnis.zst;
  if (!ergebnis.ausgewertet) return;

  ergebnis.punkte.forEach(nimmWegpunktAuf);

  const zustandGewechselt = ergebnis.zst.zustand !== vorher.zustand;
  const pauseUhrGewechselt = (ergebnis.zst.pauseSince === null) !== (vorher.pauseSince === null);
  if (zustandGewechselt) ui.updateLiveState();
  // Wegpunkte schreiben ohnehin; sonst nur bei echten Zustandswechseln speichern,
  // damit nicht jede einzelne GPS-Position einen localStorage-Schreibvorgang kostet.
  if (ergebnis.punkte.length === 0 && (zustandGewechselt || pauseUhrGewechselt)){
    speicher.saveActive(laufendeAufzeichnung);
  }
  ui.updateStatSpeed(ergebnis.speedKmh);
}

function handlePositionError(err){
  ui.setGpsPill(false);
  console.warn('GPS-Fehler', err);
}

function startTracking(){
  const now = Date.now();
  laufendeAufzeichnung = { id: now, startTime: now, points: [], zustand: neuerZustand(now) };
  speicher.saveActive(laufendeAufzeichnung);

  navigator.geolocation.getCurrentPosition(
    pos => {
      if (!laufendeAufzeichnung) return;   // zwischenzeitlich gestoppt
      const t = Date.now();
      nimmWegpunktAuf(baueWegpunkt('start', pos.coords, 0, t));
      laufendeAufzeichnung.zustand.lastRaw =
        { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, t };
    },
    handlePositionError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  attachWatcher();
  if (ui.$('#wakeLock').checked) requestWakeLock();
  ui.updateLiveState();
  ui.renderLive();
}

function stopTracking(){
  if (!laufendeAufzeichnung) return;
  const finish = coords => {
    const now = Date.now();
    nimmWegpunktAuf(baueWegpunkt('stop', coords, 0, now));
    laufendeAufzeichnung.endTime = now;
    laufendeAufzeichnung.distanceKm = sessionDistanceKm(laufendeAufzeichnung.points);
    ruheZustand = { ...leerZustand(), lastRaw: laufendeAufzeichnung.zustand.lastRaw };
    delete laufendeAufzeichnung.zustand;   // Laufzeitzustand gehoert nicht in den Verlauf
    aufzeichnungen.unshift(laufendeAufzeichnung);
    speicher.saveHistory(aufzeichnungen);
    laufendeAufzeichnung = null;
    speicher.saveActive(null);
    detachWatcher();
    releaseWakeLock();
    ui.updateLiveState();
    ui.renderLive();
    ui.renderHistory();
    ui.fillMapSessionOptions();
  };
  const lastRaw = laufendeAufzeichnung.zustand.lastRaw;
  if (lastRaw){
    finish({ latitude: lastRaw.lat, longitude: lastRaw.lon, accuracy: lastRaw.acc });
  } else {
    navigator.geolocation.getCurrentPosition(
      pos => finish(pos.coords),
      () => finish({ latitude: 0, longitude: 0, accuracy: 9999 })
    );
  }
}

function attachWatcher(){
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
    enableHighAccuracy: true, maximumAge: 2000, timeout: 20000,
  });
}
function detachWatcher(){
  if (watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
}

async function requestWakeLock(){
  try { wakeLockSentinel = await navigator.wakeLock.request('screen'); }
  catch { wakeLockSentinel = null; }
}
function releaseWakeLock(){
  if (wakeLockSentinel){ wakeLockSentinel.release().catch(() => {}); wakeLockSentinel = null; }
}

// ---------- Einstellungen ----------
function bindRange(id, valId, key, isBool){
  const input = ui.$('#' + id);
  if (isBool){
    input.checked = settings[key];
    input.addEventListener('change', () => { settings[key] = input.checked; speicher.saveSettings(settings); });
    return;
  }
  input.value = settings[key];
  ui.$('#' + valId).textContent = settings[key];
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    ui.$('#' + valId).textContent = input.value;
    speicher.saveSettings(settings);
  });
}
bindRange('walkInt', 'walkIntVal', 'walkInt');
bindRange('bikeInt', 'bikeIntVal', 'bikeInt');
bindRange('carInt', 'carIntVal', 'carInt');
bindRange('pauseMin', 'pauseMinVal', 'pauseMin');
bindRange('useGeocode', null, 'useGeocode', true);

// ---------- Sichern und Einlesen ----------
ui.$('#btnSichern').addEventListener('click', () => {
  ui.starteDownload(
    alsSicherung(aufzeichnungen, laufendeAufzeichnung),
    `weglog-sicherung-${zeitstempelName(Date.now())}.json`,
    'application/json',
  );
});

ui.$('#btnEinlesen').addEventListener('click', () => ui.$('#dateiEinlesen').click());

ui.$('#dateiEinlesen').addEventListener('change', async ev => {
  const datei = ev.target.files && ev.target.files[0];
  ev.target.value = '';   // damit dieselbe Datei erneut waehlbar bleibt
  if (!datei) return;
  try {
    const eingelesen = leseSicherung(await datei.text());
    // Die gerade laufende Aufzeichnung darf nicht als abgeschlossene Kopie
    // im Verlauf landen, wenn die Sicherung waehrend der Fahrt entstand.
    const ohneLaufende = laufendeAufzeichnung
      ? eingelesen.filter(s => String(s.id) !== String(laufendeAufzeichnung.id))
      : eingelesen;
    const vorher = aufzeichnungen.length;
    aufzeichnungen = vereine(aufzeichnungen, ohneLaufende);
    speicher.saveHistory(aufzeichnungen);
    ui.renderHistory();
    ui.fillMapSessionOptions();
    const neu = aufzeichnungen.length - vorher;
    ui.zeigeBanner(
      `Sicherung eingelesen: ${neu} neu, ${eingelesen.length - neu} schon vorhanden.`,
      'ok', 8000);
  } catch (e){
    ui.zeigeBanner('Sicherung nicht lesbar: ' + e.message, 'error', 12000);
  }
});

// ---------- Start / Stopp ----------
ui.$('#btnStart').addEventListener('click', startTracking);
ui.$('#btnStop').addEventListener('click', stopTracking);

// ---------- Berechtigung & Initialisierung ----------
function initApp(){
  ui.$('#permGate').hidden = true;
  ui.$('#app').hidden = false;
  ui.renderLive();
  ui.renderHistory();
  ui.fillMapSessionOptions();
  ui.updateLiveState();

  if (laufendeAufzeichnung){
    // App wurde neu geladen, waehrend eine Aufzeichnung lief -> fortsetzen.
    // Der Zustand steckt in der Aufzeichnung selbst (C3), es gibt nichts zu raten.
    attachWatcher();
    ui.updateLiveState();
  }
}

ui.$('#btnEnable').addEventListener('click', () => {
  ui.$('#permHint').textContent = 'Standort wird angefragt …';
  navigator.geolocation.getCurrentPosition(
    () => initApp(),
    err => {
      ui.$('#permHint').textContent = 'Standort wurde nicht erlaubt. Bitte in den Browser-/App-Einstellungen freigeben und erneut versuchen.';
      console.warn(err);
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

// Falls Berechtigung schon erteilt wurde (z.B. nach Reload), Gate ueberspringen
if (navigator.permissions && navigator.permissions.query){
  navigator.permissions.query({ name: 'geolocation' }).then(status => {
    if (status.state === 'granted') initApp();
  }).catch(() => {});
}

if ('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
