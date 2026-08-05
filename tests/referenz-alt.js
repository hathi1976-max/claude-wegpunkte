/* Vergleichsbasis: woertliche Transkription der Tracking-Logik aus dem Stand
   vor dem Modul-Umbau (git 1bf66e7, app.js:70-212). DOM-Aufrufe sind durch
   Mitschreiber ersetzt, die Rechenwege sind unveraendert uebernommen.

   Diese Datei darf nicht "verbessert" werden – sie belegt, dass der Umbau das
   Verhalten nicht verschoben hat. */

const walkMaxKmh = 7;
const bikeMaxKmh = 25;
const pauseSpeedThreshold = 1;
const resumeSpeedThreshold = 2;

function haversine(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function sessionDistanceKmAlt(points){
  let d = 0;
  for (let i = 1; i < points.length; i++){
    d += haversine(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
  }
  return d / 1000;
}

/* Erzeugt einen Lauf der alten Logik. settings wie im Original. */
export function erstelleAltenTracker(settings){
  let active = { id: 1, startTime: 0, points: [] };
  let trackState = 'moving';
  let lastRaw = null;
  let pauseSince = null;
  let lastLogTime = 0;
  const statSpeeds = [];      // Mitschrieb statt updateStatSpeed
  const stateUpdates = [];    // Mitschrieb statt updateLiveState

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
    return point;
  }

  function handlePosition(pos){
    const coords = pos.coords;
    const now = pos.timestamp;
    const speedKmh = computeSpeedKmh(coords, now);

    if (!active || trackState === 'idle'){
      lastRaw = { lat: coords.latitude, lon: coords.longitude, acc: coords.accuracy, t: now };
      return;
    }

    if (speedKmh < pauseSpeedThreshold){
      if (pauseSince === null) pauseSince = now;
      if (trackState === 'moving' && (now - pauseSince) >= settings.pauseMin * 60000){
        trackState = 'paused';
        logWaypoint('pause', coords, speedKmh, now);
        stateUpdates.push({ t: now, zustand: trackState });
      }
    } else {
      pauseSince = null;
      if (trackState === 'paused' && speedKmh >= resumeSpeedThreshold){
        trackState = 'moving';
        lastLogTime = now;
        logWaypoint('resume', coords, speedKmh, now);
        stateUpdates.push({ t: now, zustand: trackState });
      }
    }

    if (trackState === 'moving'){
      const interval = intervalMsForSpeed(speedKmh);
      if (now - lastLogTime >= interval){
        lastLogTime = now;
        logWaypoint('log', coords, speedKmh, now);
      }
    }

    statSpeeds.push(speedKmh);
    lastRaw = { lat: coords.latitude, lon: coords.longitude, acc: coords.accuracy, t: now };
  }

  return {
    handlePosition,
    punkte: () => active.points,
    statSpeeds: () => statSpeeds,
    stateUpdates: () => stateUpdates,
    zustand: () => ({ trackState, pauseSince, lastLogTime, lastRaw }),
    setStart: now => { lastLogTime = now; },
  };
}
