/* Alles, was das DOM anfasst. Die Daten kommen von aussen herein – dieses
   Modul haelt keinen Anwendungszustand ausser der offenen Detailansicht. */

import { sessionDistanceKm } from './geo.js';
import { typeIcon, typeLabel, fmtTime, fmtDateTime, fmtDuration, fmtKm } from './format.js';

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
  $('#mapSession').addEventListener('change', renderMap);
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => setActiveTab(t.dataset.view)));
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
  list.innerHTML = '';
  if (!active){
    $('#statCount').textContent = '0';
    $('#statDist').textContent = '0,0';
    return;
  }
  $('#statCount').textContent = String(active.points.length);
  $('#statDist').textContent = fmtKm(sessionDistanceKm(active.points));
  [...active.points].reverse().forEach(p => list.appendChild(pointItemEl(p)));
}

export function pointItemEl(p){
  const el = document.createElement('div');
  el.className = 'item ' + p.type;
  const sub = p.place
    ? p.place
    : (ctx.getSettings().useGeocode ? 'Ort wird ermittelt …' : p.lat.toFixed(4)+', '+p.lon.toFixed(4));
  el.innerHTML = `
    <span class="ico">${typeIcon(p.type)}</span>
    <span class="body">
      <span class="name">${typeLabel(p.type)} · ${fmtTime(p.t)}</span>
      <span class="sub">${sub}</span>
    </span>
    <span class="dist">${p.speedKmh.toFixed(1)} km/h</span>
  `;
  el.addEventListener('click', () => openPointSheet(p));
  return el;
}

// ---------- Verlauf ----------
export function renderHistory(){
  const aufzeichnungen = ctx.getAufzeichnungen();
  const list = $('#historyList');
  list.innerHTML = '';
  if (aufzeichnungen.length === 0){
    list.innerHTML = '<p class="muted">Noch keine abgeschlossenen Aufzeichnungen.</p>';
    return;
  }
  aufzeichnungen.forEach(session => list.appendChild(sessionItemEl(session)));
}

export function sessionItemEl(session){
  const el = document.createElement('div');
  el.className = 'item';
  const dur = fmtDuration((session.endTime || Date.now()) - session.startTime);
  el.innerHTML = `
    <span class="ico">🧭</span>
    <span class="body">
      <span class="name">${fmtDateTime(session.startTime)}</span>
      <span class="sub">${dur} · ${fmtKm(session.distanceKm)} km · ${session.points.length} Wegpunkte</span>
    </span>
  `;
  el.addEventListener('click', () => openSessionSheet(session));
  return el;
}

// ---------- Detail-Sheet ----------
export function openPointSheet(p){
  sheetContext = { kind: 'point', point: p };
  $('#sheetName').textContent = typeLabel(p.type) + ' · ' + fmtTime(p.t);
  $('#sheetMeta').innerHTML = `
    <div><span class="k">Ort</span><span>${p.place || '–'}</span></div>
    <div><span class="k">Koordinaten</span><span>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span></div>
    <div><span class="k">Geschwindigkeit</span><span>${p.speedKmh.toFixed(1)} km/h</span></div>
    <div><span class="k">GPS-Genauigkeit</span><span>±${Math.round(p.acc||0)} m</span></div>
  `;
  $('#sheetMapBtn').hidden = true;
  $('#sheetDelete').hidden = true;
  $('#sheet').hidden = false;
}

export function openSessionSheet(session){
  sheetContext = { kind: 'session', session };
  const dur = fmtDuration((session.endTime || Date.now()) - session.startTime);
  $('#sheetName').textContent = fmtDateTime(session.startTime);
  $('#sheetMeta').innerHTML = `
    <div><span class="k">Dauer</span><span>${dur}</span></div>
    <div><span class="k">Strecke</span><span>${fmtKm(session.distanceKm)} km</span></div>
    <div><span class="k">Wegpunkte</span><span>${session.points.length}</span></div>
  `;
  $('#sheetMapBtn').hidden = false;
  $('#sheetDelete').hidden = false;
  $('#sheet').hidden = false;
}

export function closeSheet(){ $('#sheet').hidden = true; sheetContext = null; }

// ---------- Karte ----------
export function fillMapSessionOptions(){
  const sel = $('#mapSession');
  const prev = sel.value;
  sel.innerHTML = '';
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

export function renderMap(){
  const sel = $('#mapSession');
  if (!sel.value) fillMapSessionOptions();
  const session = ctx.sessionById(sel.value);
  if (!currentMap){
    currentMap = L.map('mapContainer');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap-Mitwirkende', maxZoom: 19,
    }).addTo(currentMap);
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
    const color = { start: '#3fb950', stop: '#f85149', pause: '#f0883e', resume: '#3fb950' }[p.type] || '#4aa8ff';
    const marker = L.circleMarker([p.lat, p.lon], { radius: 6, color, fillColor: color, fillOpacity: 0.9 });
    marker.bindPopup(`<b>${typeLabel(p.type)}</b><br>${fmtTime(p.t)}`
      + `${p.place ? ' · ' + p.place : ''}<br>${p.speedKmh.toFixed(1)} km/h`);
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
}
