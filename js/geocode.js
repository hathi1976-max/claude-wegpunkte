/* Reverse-Geocoding über Nominatim.

   Die Nutzungsbedingungen des Dienstes verlangen zweierlei: höchstens eine
   Anfrage pro Sekunde und eine erreichbare Kennung des Aufrufers. Einen
   User-Agent darf eine Browser-Anwendung nicht setzen; vorgesehen ist dafür
   der Parameter `email`, den der Nutzer in den Einstellungen selbst einträgt
   (siehe README). Ohne Eintrag bleibt der Parameter weg – erfundene Adressen
   wären schlimmer als keine.

   Antworten werden lokal gecacht, damit wiederholte Wege keine neuen
   Anfragen auslösen. */

export const MIN_ABSTAND_MS = 1100;   // Nominatim: max. 1 Anfrage/Sekunde
export const SPERRE_MS = 60000;       // Pause nach einer Abfuhr (429/403)

export function geocodeKey(lat, lon){
  // ~110 m Raster; in dicht bebautem Gebiet kann ein Eintrag zwei Nachbarorte
  // abdecken – für die Anzeige der Ortschaft vertretbar (siehe README).
  return lat.toFixed(3) + ',' + lon.toFixed(3);
}

export function ortAusAntwort(data){
  if (!data) return null;
  const a = data.address || {};
  return a.village || a.town || a.city || a.municipality || a.suburb || a.county
    || data.display_name || null;
}

export function baueUrl(lat, lon, kontakt){
  const url = 'https://nominatim.openstreetmap.org/reverse'
    + `?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14`;
  const sauber = typeof kontakt === 'string' ? kontakt.trim() : '';
  return sauber ? url + '&email=' + encodeURIComponent(sauber) : url;
}

/* Eine Abfuhr wegen zu vieler Anfragen. 403 zählt mit: Nominatim schickt ihn,
   wenn eine Anwendung dauerhaft auffällt. */
export function istAbfuhr(status){
  return status === 429 || status === 403;
}

export function erstelleGeocoder({
  getSettings, getCache, setCacheEintrag, onPointUpdated,
  fetchFn = fetch,
  warte = (fn, ms) => setTimeout(fn, ms),
  jetzt = () => Date.now(),
}){
  let queue = [];
  let busy = false;
  let gesperrtBis = 0;

  function requestGeocode(point){
    if (!getSettings().useGeocode) return;
    const key = geocodeKey(point.lat, point.lon);
    const treffer = getCache()[key];
    if (treffer && treffer.ort){
      point.place = treffer.ort;
      onPointUpdated();
      return;
    }
    queue.push({ point, key });
    pump();
  }

  async function einSchritt(eintrag){
    const { point, key } = eintrag;
    try {
      const antwort = await fetchFn(
        baueUrl(point.lat, point.lon, getSettings().kontakt),
        { headers: { Accept: 'application/json' } });

      if (istAbfuhr(antwort.status)){
        // Nicht verwerfen: der Punkt wandert zurueck an den Anfang und die
        // Warteschlange pausiert. Weiterzupumpen wuerde die Sperre verlaengern.
        queue.unshift(eintrag);
        gesperrtBis = jetzt() + SPERRE_MS;
        return;
      }

      const daten = antwort.ok ? await antwort.json() : null;
      const name = ortAusAntwort(daten);
      point.place = name || '(unbekannt)';
      // Nur echte Namen in den Cache. Ein Serverfehler wuerde sonst
      // '(unbekannt)' fuer dieses Rasterfeld dauerhaft festschreiben.
      if (name) setCacheEintrag(key, name);
    } catch {
      point.place = '(offline)';
    }
    onPointUpdated();
  }

  function pump(){
    if (busy || queue.length === 0) return;
    busy = true;
    const rest = gesperrtBis - jetzt();
    if (rest > 0){ warte(weiter, rest); return; }
    einSchritt(queue.shift()).then(() => warte(weiter, MIN_ABSTAND_MS),
      () => warte(weiter, MIN_ABSTAND_MS));
  }

  function weiter(){ busy = false; pump(); }

  return {
    requestGeocode,
    warteschlangeLaenge: () => queue.length,
    gesperrt: () => gesperrtBis > jetzt(),
  };
}
