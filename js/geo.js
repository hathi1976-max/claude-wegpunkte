/* Geometrie und Geschwindigkeit – bewusst frei von Zustand und DOM,
   damit sich die Rechenwege einzeln testen lassen. */

export const walkMaxKmh = 7;
export const bikeMaxKmh = 25;
export const pauseSpeedThreshold = 1;   // km/h, darunter gilt als Stillstand
export const resumeSpeedThreshold = 2;  // km/h, Hysterese gegen Flackern

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

/* lastRaw kommt als Parameter statt aus einer Modulvariablen: sonst haengt das
   Ergebnis am Aufrufzeitpunkt und ist nicht nachrechenbar. */
export function computeSpeedKmh(coords, now, lastRaw){
  if (typeof coords.speed === 'number' && coords.speed >= 0){
    return coords.speed * 3.6;
  }
  if (!lastRaw) return 0;
  const dt = (now - lastRaw.t) / 1000;
  if (dt <= 0) return 0;
  const dist = haversine(lastRaw.lat, lastRaw.lon, coords.latitude, coords.longitude);
  // Unterhalb der GPS-Ungenauigkeit ist die Bewegung nicht von Rauschen zu trennen
  const jitterFloor = ((lastRaw.acc || 20) + (coords.accuracy || 20)) / 2;
  if (dist < jitterFloor) return 0;
  return (dist / dt) * 3.6;
}

export function intervalMsForSpeed(speedKmh, settings){
  if (speedKmh < walkMaxKmh) return settings.walkInt * 60000;
  if (speedKmh < bikeMaxKmh) return settings.bikeInt * 60000;
  return settings.carInt * 60000;
}
