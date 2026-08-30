/* Geometrie und Geschwindigkeit – bewusst frei von Zustand und DOM,
   damit sich die Rechenwege einzeln testen lassen. */

export const walkMaxKmh = 7;
export const bikeMaxKmh = 25;
export const pauseSpeedThreshold = 1;   // km/h, darunter gilt als Stillstand
export const resumeSpeedThreshold = 2;  // km/h, Hysterese gegen Flackern

/* Kuerzeste Messbasis, ueber die eine Geschwindigkeit gebildet wird (B6).

   watchPosition liefert im Sekundentakt. Zwischen zwei solchen Positionen legt
   ein Fussgaenger ein bis zwei Meter zurueck – das verschwindet vollstaendig im
   GPS-Rauschen, und die Geschwindigkeit kaeme immer als 0 heraus. Deshalb wird
   die Bezugsposition erst nachgezogen, wenn die Strecke ueber dem Rauschboden
   liegt oder dieses Fenster verstrichen ist. */
export const messfensterMs = 30000;

/* Kleinster Ortswechsel, der als "woanders" gilt (B6). Unter 25 m ist auch bei
   bestem Empfang nicht sicher zu sagen, ob jemand gegangen ist oder das Geraet
   nur gerechnet hat. */
export const minBewegungM = 25;

export function haversine(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function sessionDistanceKm(points){
  let d = 0;
  for (let i = 1; i < points.length; i++){
    d += haversine(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
  }
  return d / 1000;
}

/* Unterhalb der gemittelten Ungenauigkeit ist Bewegung nicht von Rauschen zu
   trennen. Fehlt die Angabe, wird mit 20 m gerechnet. */
export function jitterFloorM(accA, accB){
  return ((accA || 20) + (accB || 20)) / 2;
}

/* lastRaw kommt als Parameter statt aus einer Modulvariablen: sonst haengt das
   Ergebnis am Aufrufzeitpunkt und ist nicht nachrechenbar.

   lastRaw ist die Bezugsposition der Messbasis, nicht zwingend die zuletzt
   empfangene Position – siehe messbasisTaugt(). */
export function computeSpeedKmh(coords, now, lastRaw){
  if (typeof coords.speed === 'number' && coords.speed >= 0){
    return coords.speed * 3.6;
  }
  if (!lastRaw) return 0;
  const dt = (now - lastRaw.t) / 1000;
  if (dt <= 0) return 0;
  const dist = haversine(lastRaw.lat, lastRaw.lon, coords.latitude, coords.longitude);
  if (dist < jitterFloorM(lastRaw.acc, coords.accuracy)) return 0;
  return (dist / dt) * 3.6;
}

/* Darf die Bezugsposition auf die neue Position weiterruecken? Ja, sobald die
   Strecke ueber dem Rauschboden liegt (dann ist die Bewegung belegt) oder das
   Messfenster voll ist (dann steht man tatsaechlich, und eine noch aeltere
   Bezugsposition wuerde spaeteres Losgehen nur verwaschen). */
export function messbasisTaugt(ref, coords, now){
  if (!ref) return true;
  if ((now - ref.t) >= messfensterMs) return true;
  const dist = haversine(ref.lat, ref.lon, coords.latitude, coords.longitude);
  return dist >= jitterFloorM(ref.acc, coords.accuracy);
}

/* Hat sich der Standort gegenueber 'ref' belegbar geaendert? Rettet die Faelle,
   in denen sich die Geschwindigkeit gar nicht messen laesst (grobe Ortung ohne
   Geraetetempo): wer 60 m weiter ist, steht nicht mehr. */
export function hatSichEntfernt(ref, coords){
  if (!ref) return false;
  const dist = haversine(ref.lat, ref.lon, coords.latitude, coords.longitude);
  return dist >= Math.max(minBewegungM, jitterFloorM(ref.acc, coords.accuracy));
}

export function intervalMsForSpeed(speedKmh, settings){
  if (speedKmh < walkMaxKmh) return settings.walkInt * 60000;
  if (speedKmh < bikeMaxKmh) return settings.bikeInt * 60000;
  return settings.carInt * 60000;
}
