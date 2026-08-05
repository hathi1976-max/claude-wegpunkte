/* Alles, was das DOM anfasst. Die Daten kommen von aussen herein – dieses
   Modul haelt keinen Anwendungszustand ausser der offenen Detailansicht. */

import { sessionDistanceKm } from './geo.js';
import { typeIcon, typeLabel, fmtTime, fmtDateTime, fmtDuration, fmtKm } from './format.js';
import { alsGpx, alsCsv, dateiname } from './export.js';

export const $ = sel => document.querySelector(sel);

let ctx = null;              // von verbinde() gesetzt
let sheetContext = null;     // {kind:'point'|'session', ...}
let currentMap = null;
let currentMapLayer = null;

export function verbinde(kontext){
  ctx = kontext;

  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetDelete').addEventListener('click', () => {
    if (sheetContext?.kind === 'session') ctx.onSessionLoeschen(sheetContext.session);
    closeSheet();
  });
  $('#sheetMapBtn').addEventListener('click', () => {
    if (sheetContext?.kind === 'session'){
      setActiveTab('map');
      $('#mapSession').value = String(sheetContext.session.id);
      renderMap();
    }
    closeSheet();
  });
  $('#sheetGpx').addEventListener('click', () => {
    if (sheetContext?.kind !== 'session') return;
    const s = sheetContext.session;
    starteDownload(alsGpx(s), dateiname(s, 'gpx'), 'application/gpx+xml');
  });
  $('#sheetCsv').addEventListener('click', () => {
    if (sheetContext?.kind !== 'session') return;
    const s = sheetContext.session;
    // BOM voran, sonst zeigt Excel Umlaute in Ortsnamen falsch an
    starteDownload('\uFEFF' + alsCsv(s), dateiname(s, 'csv'), 'text/csv;charset=utf-8');
  });
  $('#mapSession').addEventListener('change', renderMap);
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => setActiveTab(t.dataset.view)));
}

/* Herunterladen ueber einen kurzlebigen Blob-Link – ohne Server, ohne Bibliothek. */
export function starteDownload(inhalt, name, mime){
  const url = URL.createObjectURL(new Blob([inhalt], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Banner ----------
let bannerTimer = null;

/* art: 'ok' | 'warn' | 'error'. dauerMs = 0 laesst den Hinweis stehen. */
export function zeigeBanner(text, art = 'warn', dauerMs = 0){
  const kasten = $('#banner');
  kasten.className = 'banner ' + art;
  kasten.textContent = text;             // Fremdtext nie als HTML (B1)
  kasten.hidden = false;
  clearTimeout(bannerTimer);
  if (dauerMs) bannerTimer = setTimeout(() => { kasten.hidden = true; }, dauerMs);
}

export function versteckeBanner(){
  clearTimeout(bannerTimer);
  $('#banner').hidden = true;
}

// ---------- Speicheranzeige ----------
export function zeigeSpeicher({ zeichen, grenze, aufzeichnungen, wegpunkte }){
  const anteil = Math.min(100, Math.round(zeichen / grenze * 100));
  const fuellung = $('#speicherFuellung');
  fuellung.style.width = anteil + '%';
  $('#speicherBalken').classList.toggle('voll', anteil >= 80);
  $('#speicherText').textContent =
    `Belegt: ${kb(zeichen)} von etwa ${kb(grenze)} (übliche Browser-Grenze), ${anteil} % · `
    + `${aufzeichnungen} Aufzeichnungen, ${wegpunkte} Wegpunkte`;
}

function kb(zeichen){
  if (zeichen >= 1024 * 1024) return (zeichen / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  return Math.round(zeichen / 1024) + ' KB';
}

// ---------- Statusanzeigen ----------
export function setGpsPill(ok, acc){
  const pill = $('#gpsState');
  if (ok){
    pill.className = 'pill pill-ok';
    pill.textContent = 'GPS ±' + Math.round(acc || 0) + 'm';
  } else {
    pill.className = 'pill pill-warn';
    pill.textContent = 'GPS Fehler';
  }
}

export function updateLiveState(){
  const active = ctx.getAktive();
  const zustand = ctx.getZustand();
  const label = $('#liveStateLabel');
  const since = $('#liveSince');
  $('#btnStart').hidden = !!active;
  $('#btnStop').hidden = !active;
  $('#trackState').className = 'pill ' + (active ? 'pill-ok' : 'pill-off');
  $('#trackState').textContent = active ? 'An' : 'Aus';

  if (!active){
    label.textContent = 'Bereit'; label.className = 'state-label state-idle';
    since.textContent = '';
  } else if (zustand.zustand === 'paused'){
    label.textContent = 'Pause'; label.className = 'state-label state-paused';
    since.textContent = 'seit ' + fmtTime(zustand.pauseSince || active.startTime);
  } else {
    label.textContent = 'Läuft'; label.className = 'state-label state-moving';
    since.textContent = 'seit ' + fmtTime(active.startTime);
  }
}

export function updateStatSpeed(speedKmh){
  $('#statSpeed').textContent = speedKmh.toFixed(1);
}

// ---------- Live-Liste ----------
export function renderLive(){
  const active = ctx.getAktive();
  const list = $('#liveList');
  list.replaceChildren();
  if (!active){
    $('#statCount').textContent = '0';
    $('#statDist').textContent = '0,0';
    return;
  }
  $('#statCount').textContent = String(active.points.length);
  $('#statDist').textContent = fmtKm(sessionDistanceKm(active.points));
  [...active.points].reverse().forEach(p => list.appendChild(pointItemEl(p)));
}

/* Ortsnamen kommen von Nominatim und sind damit von beliebigen Personen
   editierbarer Fremdtext. Deshalb wird hier nirgends innerHTML gesetzt,
   sondern gebaut – dann ist ein Name mit Markup schlicht ein Name (B1). */
export function el(tag, klasse, text){
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

export function ortText(p, settings){
  if (p.place) return p.place;
  if (settings && settings.useGeocode) return 'Ort wird ermittelt …';
  return p.lat.toFixed(4) + ', ' + p.lon.toFixed(4);
}

export function pointItemEl(p, settings = ctx.getSettings()){
  const e = el('div', 'item ' + p.type);
  e.appendChild(el('span', 'ico', typeIcon(p.type)));
  const body = el('span', 'body');
  body.appendChild(el('span', 'name', typeLabel(p.type) + ' · ' + fmtTime(p.t)));
  body.appendChild(el('span', 'sub', ortText(p, settings)));
  e.appendChild(body);
  e.appendChild(el('span', 'dist', p.speedKmh.toFixed(1) + ' km/h'));
  e.addEventListener('click', () => openPointSheet(p));
  return e;
}

// ---------- Verlauf ----------
export function renderHistory(){
  const aufzeichnungen = ctx.getAufzeichnungen();
  const list = $('#historyList');
  list.replaceChildren();
  if (aufzeichnungen.length === 0){
    list.appendChild(el('p', 'muted', 'Noch keine abgeschlossenen Aufzeichnungen.'));
    return;
  }
  aufzeichnungen.forEach(session => list.appendChild(sessionItemEl(session)));
}

export function sessionItemEl(session){
  const e = el('div', 'item');
  const dauer = fmtDuration((session.endTime || Date.now()) - session.startTime);
  e.appendChild(el('span', 'ico', '🧭'));
  const body = el('span', 'body');
  body.appendChild(el('span', 'name', fmtDateTime(session.startTime)));
  body.appendChild(el('span', 'sub',
    `${dauer} · ${fmtKm(session.distanceKm)} km · ${session.points.length} Wegpunkte`));
  e.appendChild(body);
  e.addEventListener('click', () => openSessionSheet(session));
  return e;
}

// ---------- Detail-Sheet ----------
export function openPointSheet(p){
  sheetContext = { kind: 'point', point: p };
  $('#sheetName').textContent = typeLabel(p.type) + ' · ' + fmtTime(p.t);
  setzeMeta([
    ['Ort', p.place || '–'],
    ['Koordinaten', p.lat.toFixed(5) + ', ' + p.lon.toFixed(5)],
    ['Geschwindigkeit', p.speedKmh.toFixed(1) + ' km/h'],
    ['GPS-Genauigkeit', '±' + Math.round(p.acc || 0) + ' m'],
  ]);
  zeigeSheetKnoepfe(false);
  $('#sheet').hidden = false;
}

/* Baut die Schluessel/Wert-Zeilen des Sheets. Der Wert kann Fremdtext sein. */
export function metaZeile(schluessel, wert){
  const zeile = el('div');
  zeile.appendChild(el('span', 'k', schluessel));
  zeile.appendChild(el('span', null, wert));
  return zeile;
}

export function setzeMeta(paare){
  const ziel = $('#sheetMeta');
  ziel.replaceChildren(...paare.map(([k, v]) => metaZeile(k, v)));
}

function zeigeSheetKnoepfe(fuerAufzeichnung){
  $('#sheetMapBtn').hidden = !fuerAufzeichnung;
  $('#sheetDelete').hidden = !fuerAufzeichnung;
  $('#sheetGpx').hidden = !fuerAufzeichnung;
  $('#sheetCsv').hidden = !fuerAufzeichnung;
}

export function openSessionSheet(session){
  sheetContext = { kind: 'session', session };
  const dur = fmtDuration((session.endTime || Date.now()) - session.startTime);
  $('#sheetName').textContent = fmtDateTime(session.startTime);
  setzeMeta([
    ['Dauer', dur],
    ['Strecke', fmtKm(session.distanceKm) + ' km'],
    ['Wegpunkte', String(session.points.length)],
  ]);
  zeigeSheetKnoepfe(true);
  $('#sheet').hidden = false;
}

export function closeSheet(){ $('#sheet').hidden = true; sheetContext = null; }

// ---------- Karte ----------
export function fillMapSessionOptions(){
  const sel = $('#mapSession');
  const prev = sel.value;
  sel.replaceChildren();
  const active = ctx.getAktive();
  if (active){
    const opt = document.createElement('option');
    opt.value = String(active.id);
    opt.textContent = 'Aktive Aufzeichnung (läuft)';
    sel.appendChild(opt);
  }
  ctx.getAufzeichnungen().forEach(s => {
    const opt = document.createElement('option');
    opt.value = String(s.id);
    opt.textContent = fmtDateTime(s.startTime) + ' · ' + fmtKm(s.distanceKm) + ' km';
    sel.appendChild(opt);
  });
  if (sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
}

/* Der Hinweis unter der Karte. Nie innerHTML – hier landen auch Texte, die
   von Kachel- und Netzfehlern kommen. */
export function setzeKartenHinweis(text){
  const kasten = $('#mapHinweis');
  kasten.textContent = text || '';
  kasten.hidden = !text;
}

/* Leaflet nimmt fuer bindPopup auch ein Element – damit landet der Ortsname
   als Text im Popup und nicht als Markup. */
export function popupInhalt(p){
  const box = el('div');
  box.appendChild(el('b', null, typeLabel(p.type)));
  box.appendChild(document.createElement('br'));
  box.appendChild(document.createTextNode(fmtTime(p.t) + (p.place ? ' · ' + p.place : '')));
  box.appendChild(document.createElement('br'));
  box.appendChild(document.createTextNode(p.speedKmh.toFixed(1) + ' km/h'));
  return box;
}

export function renderMap(){
  const sel = $('#mapSession');
  if (!sel.value) fillMapSessionOptions();
  const session = ctx.sessionById(sel.value);

  // Ohne Leaflet gibt es keine Karte – aber es darf auch nichts abstuerzen.
  // Der Reiter muss weiter benutzbar bleiben, die Aufzeichnung laeuft ohnehin.
  if (typeof L === 'undefined'){
    $('#mapContainer').hidden = true;
    setzeKartenHinweis('Die Kartenbibliothek ist nicht geladen. Einmal mit '
      + 'Internetverbindung neu laden, dann liegt sie im Offline-Speicher. '
      + 'Der aufgezeichnete Weg bleibt davon unberührt.');
    return;
  }
  $('#mapContainer').hidden = false;

  if (!currentMap){
    currentMap = L.map('mapContainer');
    const kacheln = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap-Mitwirkende', maxZoom: 19,
      // CORS statt undurchsichtiger Antworten: nur so kann der Service Worker
      // erkennen, ob eine Kachel wirklich angekommen ist
      crossOrigin: true,
    });
    kacheln.on('tileerror', () => setzeKartenHinweis(
      'Offline – Kartenkacheln fehlen. Der aufgezeichnete Weg bleibt trotzdem '
      + 'gespeichert und wird angezeigt, sobald die Karte wieder lädt.'));
    // 'load' feuert erst, wenn alle sichtbaren Kacheln da sind – 'tileload'
    // je Kachel wuerde den Hinweis bei halb geladener Karte wegblinken lassen
    kacheln.on('load', () => setzeKartenHinweis(''));
    kacheln.addTo(currentMap);
  }
  if (currentMapLayer){ currentMap.removeLayer(currentMapLayer); currentMapLayer = null; }
  setTimeout(() => currentMap.invalidateSize(), 50);

  if (!session || session.points.length === 0){
    currentMap.setView([51.16, 10.45], 6); // Mitte Deutschland als Leerlauf-Ansicht
    return;
  }
  const group = L.layerGroup();
  const latlngs = session.points.map(p => [p.lat, p.lon]);
  L.polyline(latlngs, { color: '#4aa8ff', weight: 4 }).addTo(group);
  session.points.forEach(p => {
    const color = {
      start: '#3fb950', stop: '#f85149', pause: '#f0883e',
      resume: '#3fb950', luecke: '#a371f7',
    }[p.type] || '#4aa8ff';
    const marker = L.circleMarker([p.lat, p.lon], { radius: 6, color, fillColor: color, fillOpacity: 0.9 });
    marker.bindPopup(popupInhalt(p));   // Element statt HTML-Zeichenkette (B1)
    marker.addTo(group);
  });
  group.addTo(currentMap);
  currentMapLayer = group;
  currentMap.fitBounds(latlngs, { padding: [24, 24] });
}

export function kartenAnsichtOffen(){ return !$('#view-map').hidden; }

// ---------- Tabs ----------
export function setActiveTab(view){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('tab-active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
  if (view === 'map'){ fillMapSessionOptions(); renderMap(); }
  if (view === 'history') renderHistory();
  if (view === 'settings' && ctx.onEinstellungen) ctx.onEinstellungen();
}
