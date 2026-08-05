/* Reverse-Geocoding ueber Nominatim: gedrosselt auf eine Anfrage pro Sekunde
   und lokal gecacht, damit wiederholte Wege keine neuen Anfragen ausloesen. */

export function geocodeKey(lat, lon){
  // ~110 m Raster; in dicht bebautem Gebiet kann ein Eintrag zwei Nachbarorte
  // abdecken – fuer die Anzeige der Ortschaft vertretbar (siehe README).
  return lat.toFixed(3) + ',' + lon.toFixed(3);
}

export function ortAusAntwort(data){
  if (!data) return null;
  const a = data.address || {};
  return a.village || a.town || a.city || a.municipality || a.suburb || a.county || data.display_name || null;
}

export function baueUrl(lat, lon){
  return `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14`;
}

export function erstelleGeocoder({ getSettings, getCache, setCacheEintrag, onPointUpdated, fetchFn = fetch }){
  let queue = [];
  let busy = false;

  function requestGeocode(point){
    if (!getSettings().useGeocode) return;
    const key = geocodeKey(point.lat, point.lon);
    const treffer = getCache()[key];
    if (treffer){
      point.place = treffer;
      onPointUpdated();
      return;
    }
    queue.push({ point, key });
    pump();
  }

  function pump(){
    if (busy || queue.length === 0) return;
    busy = true;
    const { point, key } = queue.shift();
    fetchFn(baueUrl(point.lat, point.lon), { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        point.place = ortAusAntwort(data) || '(unbekannt)';
        setCacheEintrag(key, point.place);
        onPointUpdated();
      })
      .catch(() => { point.place = '(offline)'; onPointUpdated(); })
      .finally(() => {
        busy = false;
        setTimeout(pump, 1100); // Nominatim: max. 1 Anfrage/Sekunde
      });
  }

  return { requestGeocode, warteschlangeLaenge: () => queue.length };
}
