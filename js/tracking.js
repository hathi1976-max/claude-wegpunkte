/* Aufzeichnungs-Zustandsmaschine.

   schrittPosition() ist bewusst rein: rein rein, raus raus, kein DOM, kein
   localStorage, keine Uhr. Nur so laesst sich die Pausenerkennung mit
   konstruierten Spuren nachrechnen. Die Anbindung an Geraet und Anzeige
   passiert in app.js. */

import {
  computeSpeedKmh, intervalMsForSpeed,
  pauseSpeedThreshold, resumeSpeedThreshold,
} from './geo.js';

export function neuerZustand(now){
  return { zustand: 'moving', lastRaw: null, pauseSince: null, lastLogTime: now };
}

export function leerZustand(){
  return { zustand: 'idle', lastRaw: null, pauseSince: null, lastLogTime: 0 };
}

/* Der Aufzeichnungszustand wird mit der Aufzeichnung gespeichert (siehe C3),
   damit ein Neuladen exakt den vorherigen Stand herstellt. Aufzeichnungen aus
   der Zeit davor haben kein 'zustand'-Feld – fuer die wird wie bisher aus dem
   letzten Wegpunkt rekonstruiert. */
export function zustandAusAufzeichnung(aufzeichnung){
  if (!aufzeichnung) return leerZustand();
  const gespeichert = aufzeichnung.zustand;
  if (gespeichert && typeof gespeichert === 'object' && gespeichert.zustand){
    return { ...leerZustand(), ...gespeichert };
  }
  const punkte = aufzeichnung.points || [];
  const letzter = punkte[punkte.length - 1];
  return {
    zustand: letzter && letzter.type === 'pause' ? 'paused' : 'moving',
    lastRaw: letzter ? { lat: letzter.lat, lon: letzter.lon, acc: letzter.acc, t: letzter.t } : null,
    pauseSince: null,
    lastLogTime: letzter ? letzter.t : aufzeichnung.startTime,
  };
}

/* Ab wann eine Zeitspanne ohne Position als Luecke gilt (B5).

   Mobile Browser drosseln watchPosition, sobald der Tab in den Hintergrund
   geht. Dann fehlen Positionen, und die Karte zoege eine gerade Linie durch
   die Landschaft, als waere man sie so gefahren. Die Schwelle liegt beim
   Dreifachen des groessten eingestellten Intervalls, mindestens aber zehn
   Minuten – darunter ist eine Pause im Empfang normal. */
export function lueckenSchwelleMs(settings){
  const groesstes = Math.max(settings.walkInt, settings.bikeInt, settings.carInt) * 60000;
  return Math.max(10 * 60000, 3 * groesstes);
}

export function istLuecke(letzteZeit, now, settings){
  if (typeof letzteZeit !== 'number') return false;
  return (now - letzteZeit) >= lueckenSchwelleMs(settings);
}

export function baueWegpunkt(type, coords, speedKmh, now){
  return {
    t: now,
    lat: coords.latitude,
    lon: coords.longitude,
    acc: coords.accuracy,
    speedKmh: Math.round(speedKmh * 10) / 10,
    type,
    place: null,
  };
}

/* Verarbeitet eine GPS-Position und liefert den Folgezustand samt der dabei
   entstandenen Wegpunkte. Der Aufrufer schreibt sie weg und zeichnet neu.

   zst    – {zustand, lastRaw, pauseSince, lastLogTime}
   liefert {zst, punkte, speedKmh, ausgewertet} */
export function schrittPosition(zst, coords, now, settings){
  const speedKmh = computeSpeedKmh(coords, now, zst.lastRaw);
  const raw = { lat: coords.latitude, lon: coords.longitude, acc: coords.accuracy, t: now };

  if (zst.zustand === 'idle'){
    return { zst: { ...zst, lastRaw: raw }, punkte: [], speedKmh, ausgewertet: false };
  }

  let { zustand, pauseSince, lastLogTime } = zst;
  const punkte = [];

  if (speedKmh < pauseSpeedThreshold){
    if (pauseSince === null) pauseSince = now;
    if (zustand === 'moving' && (now - pauseSince) >= settings.pauseMin * 60000){
      zustand = 'paused';
      punkte.push(baueWegpunkt('pause', coords, speedKmh, now));
    }
  } else {
    pauseSince = null;
    if (zustand === 'paused' && speedKmh >= resumeSpeedThreshold){
      zustand = 'moving';
      lastLogTime = now;
      punkte.push(baueWegpunkt('resume', coords, speedKmh, now));
    }
  }

  if (zustand === 'moving'){
    if (now - lastLogTime >= intervalMsForSpeed(speedKmh, settings)){
      lastLogTime = now;
      punkte.push(baueWegpunkt('log', coords, speedKmh, now));
    }
  }

  return {
    zst: { zustand, lastRaw: raw, pauseSince, lastLogTime },
    punkte,
    speedKmh,
    ausgewertet: true,
  };
}
