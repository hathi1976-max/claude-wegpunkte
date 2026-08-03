/* WegLog – Wegpunkte-Tracker
   Zeichnet während einer aktiven Session automatisch Wegpunkte auf.
   Intervall richtet sich nach der Geschwindigkeit, Pausen werden per
   Stillstands-Erkennung markiert. Läuft bis zum aktiven Stopp weiter. */

const LS_SETTINGS = 'weglog.settings';
const LS_ACTIVE = 'weglog.active';
const LS_HISTORY = 'weglog.history';
const LS_GEOCACHE = 'weglog.geocache';

const $ = sel => document.querySelector(sel);

const defaultSettings = {
  walkInt: 5,   // Min, Geschwindigkeit < walkMax
  bikeInt: 2,   // Min, walkMax..bikeMax
  carInt: 1,    // Min, > bikeMax
  pauseMin: 3,  // Min Stillstand bis 'Pause'
  useGeocode: true,
};
const walkMaxKmh = 7;
const bikeMaxKmh = 25;
const pauseSpeedThreshold = 1;   // km/h, darunter gilt als Stillstand
const resumeSpeedThreshold = 2;  // km/h, Hysterese gegen Flackern

let settings = loadSettings();
let history_ = loadHistory();
let geocache = loadGeocache();

// Laufzeit-Zustand der aktiven Session (nicht persistiert, wird aus LS_ACTIVE rekonstruiert)
let active = loadActive();      // {id, points:[...]} oder null
let trackState = 'idle';        // 'idle' | 'moving' | 'paused'
let lastRaw = null;             // {lat, lon, acc, t} letzte GPS-Rohposition
let pauseSince = null;          // Zeitpunkt, seit dem Geschwindigkeit unter Schwelle liegt
let lastLogTime = 0;
let watchId = null;
let wakeLockSentinel = null;
let currentMap = null;
let currentMapLayer = null;
let sheetContext = null;        // {kind:'point'|'session', ...}

// ---------- Storage ----------
function loadSettings(){
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}') }; }
  catch { return { ...defaultSettings }; }
}
function saveSettings(){ localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }

function loadActive(){
  try { return JSON.parse(localStorage.getItem(LS_ACTIVE) || 'null'); }
  catch { return null; }
}
function saveActive(){
  if (active) localStorage.setItem(LS_ACTIVE, JSON.stringify(active));
  else localStorage.removeItem(LS_ACTIVE);
}

function loadHistory(){
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'); }
  catch { return []; }
}
function saveHistory(){ localStorage.setItem(LS_HISTORY, JSON.stringify(history_)); }

function loadGeocache(){
  try { return JSON.parse(localStorage.getItem(LS_GEOCACHE) || '{}'); }
  catch { return {}; }
}
function saveGeocache(){ localStorage.setItem(LS_GEOCACHE, JSON.stringify(geocache)); }

// ---------- Geo-Hilfsfunktionen ----------
function haversine(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function sessionDistanceKm(points){
  let d = 0;
  for (let i = 1; i < points.length; i++){
    d += haversine(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
  }
  return d / 1000;
}

function computeSpeedKmh(coords, now){
  if (typeof coords.speed === 'number' && coords.speed >= 0){
    return coords.speed * 3.6;
  }
  if (!lastRaw) return 0;
  const dt = (now - lastRaw.t) / 1000;
  if (dt <= 0) return 0;
  const dist = haversine(lastRaw.lat, lastRaw.lon, coords.latitude, coords.longitude);
  const jitterFloor = ((lastRaw.acc || 20) + (coords.accuracy || 20)) / 2;
  if (dist < jitterFloor) return 0;
  return (dist / dt) * 3.6;
}

function intervalMsForSpeed(speedKmh){
  if (speedKmh < walkMaxKmh) return settings.walkInt * 60000;
  if (speedKmh < bikeMaxKmh) return settings.bikeInt * 60000;
  return settings.carInt * 60000;
}

// ---------- Reverse-Geocoding (Nominatim, gedrosselt + gecacht) ----------
let geocodeQueue = [];
let geocodeBusy = false;

function geocodeKey(lat, lon){
  return lat.toFixed(3) + ',' + lon.toFixed(3);
}

function requestGeocode(point){
  if (!settings.useGeocode) return;
  const key = geocodeKey(point.lat, point.lon);
  if (geocache[key]){
    point.place = geocache[key];
    onPointUpdated();
    return;
  }
  geocodeQueue.push({ point, key });
  pumpGeocodeQueue();
}

function pumpGeocodeQueue(){
  if (geocodeBusy || geocodeQueue.length === 0) return;
  geocodeBusy = true;
  const { point, key } = geocodeQueue.shift();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lon}&zoom=14`;
  fetch(url, { headers: { Accept: 'application/json' } })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      let name = null;
      if (data){
        const a = data.address || {};
        name = a.village || a.town || a.city || a.municipality || a.suburb || a.county || data.display_name || null;
      }
      point.place = name || '(unbekannt)';
      geocache[key] = point.place;
      saveGeocache();
      onPointUpdated();
    })
    .catch(() => { point.place = '(offline)'; onPointUpdated(); })
    .finally(() => {
      geocodeBusy = false;
      setTimeout(pumpGeocodeQueue, 1100); // Nominatim: max. 1 Anfrage/Sekunde
    });
}

function onPointUpdated(){
  saveActive();
  renderLive();
  if (!$('#view-map').hidden) renderMap();
}

// ---------- Tracking-Logik ----------
function logWaypoint(type, coords, speedKmh, now){
  const point = {
    t: now,
    lat: coords.latitude,
    lon: coords.longitude,
    acc: coords.accuracy,
    speedKmh: Math.round(speedKmh * 10) / 10,
    type,
    place: null,
  };
  active.points.push(point);
  saveActive();
  renderLive();
  requestGeocode(point);
  return point;
}

function handlePosition(pos){
  const coords = pos.coords;
  const now = Date.now();
  const speedKmh = computeSpeedKmh(coords, now);
  setGpsPill(true, coords.accuracy);

  if (!active || trackState === 'idle'){
    lastRaw = { lat: coords.latitude, lon: coords.longitude, acc: coords.accuracy, t: now };
    return;
  }

  if (speedKmh < pauseSpeedThreshold){
    if (pauseSince === null) pauseSince = now;
    if (trackState === 'moving' && (now - pauseSince) >= settings.pauseMin * 60000){
      trackState = 'paused';
      logWaypoint('pause', coords, speedKmh, now);
      updateLiveState();
    }
  } else {
    pauseSince = null;
    if (trackState === 'paused' && speedKmh >= resumeSpeedThreshold){
      trackState = 'moving';
      lastLogTime = now;
      logWaypoint('resume', coords, speedKmh, now);
      updateLiveState();
    }
  }

  if (trackState === 'moving'){
    const interval = intervalMsForSpeed(speedKmh);
    if (now - lastLogTime >= interval){
      lastLogTime = now;
      logWaypoint('log', coords, speedKmh, now);
    }
  }

  updateStatSpeed(speedKmh);
  lastRaw = { lat: coords.latitude, lon: coords.longitude, acc: coords.accuracy, t: now };
}

function handlePositionError(err){
  setGpsPill(false);
  console.warn('GPS-Fehler', err);
}

function startTracking(){
  const now = Date.now();
  active = { id: now, startTime: now, points: [] };
  trackState = 'moving';
  pauseSince = null;
  lastLogTime = now;
  lastRaw = null;
  saveActive();

  navigator.geolocation.getCurrentPosition(
    pos => {
      logWaypoint('start', pos.coords, 0, Date.now());
      lastRaw = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() };
    },
    handlePositionError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  attachWatcher();
  if ($('#wakeLock').checked) requestWakeLock();
  updateLiveState();
  renderLive();
}

function stopTracking(){
  if (!active) return;
  const finish = coords => {
    const now = Date.now();
    logWaypoint('stop', coords, 0, now);
    active.endTime = now;
    active.distanceKm = sessionDistanceKm(active.points);
    history_.unshift(active);
    saveHistory();
    active = null;
    saveActive();
    detachWatcher();
    releaseWakeLock();
    trackState = 'idle';
    pauseSince = null;
    updateLiveState();
    renderLive();
    renderHistory();
    fillMapSessionOptions();
  };
  if (lastRaw){
    finish({ latitude: lastRaw.lat, longitude: lastRaw.lon, accuracy: lastRaw.acc });
  } else {
    navigator.geolocation.getCurrentPosition(pos => finish(pos.coords), () => finish({ latitude: 0, longitude: 0, accuracy: 9999 }));
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

// ---------- UI: Live ----------
function typeIcon(type){
  return { start: '🏁', resume: '▶️', pause: '⏸️', stop: '🏁', log: '📍' }[type] || '📍';
}
function typeLabel(type){
  return { start: 'Start', resume: 'Weiter', pause: 'Pause', stop: 'Ende', log: 'Wegpunkt' }[type] || 'Wegpunkt';
}
function fmtTime(t){
  return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(t){
  return new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(ms){
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} Min`;
  return `${Math.floor(min/60)} Std ${min%60} Min`;
}

function updateLiveState(){
  const label = $('#liveStateLabel');
  const since = $('#liveSince');
  $('#btnStart').hidden = !!active;
  $('#btnStop').hidden = !active;
  $('#trackState').className = 'pill ' + (active ? 'pill-ok' : 'pill-off');
  $('#trackState').textContent = active ? 'An' : 'Aus';

  if (!active){
    label.textContent = 'Bereit'; label.className = 'state-label state-idle';
    since.textContent = '';
  } else if (trackState === 'paused'){
    label.textContent = 'Pause'; label.className = 'state-label state-paused';
    since.textContent = 'seit ' + fmtTime(pauseSince || active.startTime);
  } else {
    label.textContent = 'Läuft'; label.className = 'state-label state-moving';
    since.textContent = 'seit ' + fmtTime(active.startTime);
  }
}

function updateStatSpeed(speedKmh){
  $('#statSpeed').textContent = speedKmh.toFixed(1);
}

function renderLive(){
  const list = $('#liveList');
  list.innerHTML = '';
  if (!active){
    $('#statCount').textContent = '0';
    $('#statDist').textContent = '0,0';
    return;
  }
  $('#statCount').textContent = String(active.points.length);
  $('#statDist').textContent = sessionDistanceKm(active.points).toFixed(1).replace('.', ',');
  [...active.points].reverse().forEach(p => list.appendChild(pointItemEl(p)));
}

function pointItemEl(p){
  const el = document.createElement('div');
  el.className = 'item ' + p.type;
  el.innerHTML = `
    <span class="ico">${typeIcon(p.type)}</span>
    <span class="body">
      <span class="name">${typeLabel(p.type)} · ${fmtTime(p.t)}</span>
      <span class="sub">${p.place ? p.place : (settings.useGeocode ? 'Ort wird ermittelt …' : p.lat.toFixed(4)+', '+p.lon.toFixed(4))}</span>
    </span>
    <span class="dist">${p.speedKmh.toFixed(1)} km/h</span>
  `;
  el.addEventListener('click', () => openPointSheet(p));
  return el;
}

// ---------- UI: Verlauf ----------
function renderHistory(){
  const list = $('#historyList');
  list.innerHTML = '';
  if (history_.length === 0){
    list.innerHTML = '<p class="muted">Noch keine abgeschlossenen Aufzeichnungen.</p>';
    return;
  }
  history_.forEach(session => list.appendChild(sessionItemEl(session)));
}

function sessionItemEl(session){
  const el = document.createElement('div');
  el.className = 'item';
  const dur = fmtDuration((session.endTime || Date.now()) - session.startTime);
  el.innerHTML = `
    <span class="ico">🧭</span>
    <span class="body">
      <span class="name">${fmtDateTime(session.startTime)}</span>
      <span class="sub">${dur} · ${(session.distanceKm||0).toFixed(1).replace('.', ',')} km · ${session.points.length} Wegpunkte</span>
    </span>
  `;
  el.addEventListener('click', () => openSessionSheet(session));
  return el;
}

// ---------- Sheet (Detailansicht) ----------
function openPointSheet(p){
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

function openSessionSheet(session){
  sheetContext = { kind: 'session', session };
  const dur = fmtDuration((session.endTime || Date.now()) - session.startTime);
  $('#sheetName').textContent = fmtDateTime(session.startTime);
  $('#sheetMeta').innerHTML = `
    <div><span class="k">Dauer</span><span>${dur}</span></div>
    <div><span class="k">Strecke</span><span>${(session.distanceKm||0).toFixed(1).replace('.', ',')} km</span></div>
    <div><span class="k">Wegpunkte</span><span>${session.points.length}</span></div>
  `;
  $('#sheetMapBtn').hidden = false;
  $('#sheetDelete').hidden = false;
  $('#sheet').hidden = false;
}

function closeSheet(){ $('#sheet').hidden = true; sheetContext = null; }

$('#sheetClose').addEventListener('click', closeSheet);
$('#sheetDelete').addEventListener('click', () => {
  if (sheetContext?.kind === 'session'){
    history_ = history_.filter(s => s.id !== sheetContext.session.id);
    saveHistory();
    renderHistory();
    fillMapSessionOptions();
  }
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

// ---------- Karte ----------
function fillMapSessionOptions(){
  const sel = $('#mapSession');
  const prev = sel.value;
  sel.innerHTML = '';
  if (active){
    const opt = document.createElement('option');
    opt.value = String(active.id);
    opt.textContent = 'Aktive Aufzeichnung (läuft)';
    sel.appendChild(opt);
  }
  history_.forEach(s => {
    const opt = document.createElement('option');
    opt.value = String(s.id);
    opt.textContent = fmtDateTime(s.startTime) + ' · ' + (s.distanceKm||0).toFixed(1).replace('.', ',') + ' km';
    sel.appendChild(opt);
  });
  if (sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
}

function sessionById(id){
  if (active && String(active.id) === String(id)) return active;
  return history_.find(s => String(s.id) === String(id));
}

function renderMap(){
  const sel = $('#mapSession');
  if (!sel.value) fillMapSessionOptions();
  const session = sessionById(sel.value);
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
    marker.bindPopup(`<b>${typeLabel(p.type)}</b><br>${fmtTime(p.t)}${p.place ? ' · ' + p.place : ''}<br>${p.speedKmh.toFixed(1)} km/h`);
    marker.addTo(group);
  });
  group.addTo(currentMap);
  currentMapLayer = group;
  currentMap.fitBounds(latlngs, { padding: [24, 24] });
}

$('#mapSession').addEventListener('change', renderMap);

// ---------- Tabs ----------
function setActiveTab(view){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('tab-active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
  if (view === 'map'){ fillMapSessionOptions(); renderMap(); }
  if (view === 'history') renderHistory();
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setActiveTab(t.dataset.view)));

// ---------- Einstellungen ----------
function bindRange(id, valId, key, isBool){
  const input = $('#' + id);
  if (isBool){
    input.checked = settings[key];
    input.addEventListener('change', () => { settings[key] = input.checked; saveSettings(); });
    return;
  }
  input.value = settings[key];
  $('#' + valId).textContent = settings[key];
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    $('#' + valId).textContent = input.value;
    saveSettings();
  });
}
bindRange('walkInt', 'walkIntVal', 'walkInt');
bindRange('bikeInt', 'bikeIntVal', 'bikeInt');
bindRange('carInt', 'carIntVal', 'carInt');
bindRange('pauseMin', 'pauseMinVal', 'pauseMin');
bindRange('useGeocode', null, 'useGeocode', true);

// ---------- GPS-Statusanzeige ----------
function setGpsPill(ok, acc){
  const pill = $('#gpsState');
  if (ok){
    pill.className = 'pill pill-ok';
    pill.textContent = 'GPS ±' + Math.round(acc || 0) + 'm';
  } else {
    pill.className = 'pill pill-warn';
    pill.textContent = 'GPS Fehler';
  }
}

// ---------- Start / Stopp Buttons ----------
$('#btnStart').addEventListener('click', startTracking);
$('#btnStop').addEventListener('click', stopTracking);

// ---------- Berechtigung & Initialisierung ----------
function initApp(){
  $('#permGate').hidden = true;
  $('#app').hidden = false;
  renderLive();
  renderHistory();
  fillMapSessionOptions();
  updateLiveState();

  if (active){
    // App wurde neu geladen, während eine Aufzeichnung lief -> fortsetzen
    const lastPoint = active.points[active.points.length - 1];
    trackState = lastPoint && lastPoint.type === 'pause' ? 'paused' : 'moving';
    lastLogTime = lastPoint ? lastPoint.t : active.startTime;
    if (lastPoint) lastRaw = { lat: lastPoint.lat, lon: lastPoint.lon, acc: lastPoint.acc, t: lastPoint.t };
    attachWatcher();
    updateLiveState();
  }
}

$('#btnEnable').addEventListener('click', () => {
  $('#permHint').textContent = 'Standort wird angefragt …';
  navigator.geolocation.getCurrentPosition(
    () => initApp(),
    err => {
      $('#permHint').textContent = 'Standort wurde nicht erlaubt. Bitte in den Browser-/App-Einstellungen freigeben und erneut versuchen.';
      console.warn(err);
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

// Falls Berechtigung schon erteilt wurde (z.B. nach Reload), Gate überspringen
if (navigator.permissions && navigator.permissions.query){
  navigator.permissions.query({ name: 'geolocation' }).then(status => {
    if (status.state === 'granted') initApp();
  }).catch(() => {});
}

if ('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
