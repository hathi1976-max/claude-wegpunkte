import { gruppe, test, gleich, tiefGleich, wahr } from './lauf.js';
import {
  schrittPosition, zustandAusAufzeichnung, neuerZustand, leerZustand, istLuecke,
  lueckenSchwelleMs,
} from '../js/tracking.js';
import { erstelleAltenTracker } from './referenz-alt.js';

const einstellungen = { walkInt: 5, bikeInt: 2, carInt: 1, pauseMin: 3, useGeocode: false };

/* Faehrt eine Spur durch die neue Zustandsmaschine und schreibt mit,
   was dabei herauskommt. */
function laufeNeu(spur, settings, start){
  let zst = neuerZustand(start);
  const punkte = [];
  const speeds = [];
  for (const pos of spur){
    const e = schrittPosition(zst, pos.coords, pos.timestamp, settings);
    zst = e.zst;
    if (!e.ausgewertet) continue;
    punkte.push(...e.punkte);
    speeds.push(e.speedKmh);
  }
  return { punkte, speeds, zst };
}

function laufeAlt(spur, settings, start){
  const alt = erstelleAltenTracker(settings);
  alt.setStart(start);
  spur.forEach(alt.handlePosition);
  return { punkte: alt.punkte(), speeds: alt.statSpeeds(), zustand: alt.zustand() };
}

function pos(t, lat, lon, acc = 20, speed){
  const coords = { latitude: lat, longitude: lon, accuracy: acc };
  if (speed !== undefined) coords.speed = speed;
  return { coords, timestamp: t };
}

// ---------- Konstruierte Spuren, von Hand nachgerechnet ----------
gruppe('Pausenerkennung (konstruierte Spur)', () => {
  /* Stillstand ab t=0, Position unveraendert. pauseMin=3 -> der Pausenpunkt
     muss exakt bei t=180000 fallen, kein Wegpunkt davor: das Fuss-Intervall
     sind 5 Min, und die Uhr fuer den Pausenpunkt laeuft ab der ersten
     Position. */
  const stillstand = [0, 60000, 120000, 180000, 240000].map(t => pos(t, 52, 13));

  test('Pause faellt exakt nach pauseMin, genau einmal', () => {
    const { punkte } = laufeNeu(stillstand, einstellungen, 0);
    gleich(punkte.length, 1, 'Anzahl Wegpunkte');
    gleich(punkte[0].type, 'pause');
    gleich(punkte[0].t, 180000);
    gleich(punkte[0].speedKmh, 0);
  });

  test('eine Position zu frueh loest noch keine Pause aus', () => {
    const knappDavor = [0, 60000, 120000, 179999].map(t => pos(t, 52, 13));
    gleich(laufeNeu(knappDavor, einstellungen, 0).punkte.length, 0);
  });

  /* Nach der Pause 111,19 m je 60 s = 6,67 km/h: ueber der Resume-Schwelle
     von 2 km/h, aber unter 7 km/h -> Fuss-Intervall von 5 Min. */
  test('Weiter-Punkt und danach erst nach 5 Min der naechste Wegpunkt', () => {
    const spur = [
      ...stillstand,
      pos(300000, 52.001, 13),   // Weiter (6,67 km/h)
      pos(360000, 52.002, 13),
      pos(420000, 52.003, 13),
      pos(480000, 52.004, 13),
      pos(540000, 52.005, 13),
      pos(600000, 52.006, 13),   // 5 Min nach dem Weiter-Punkt -> Wegpunkt
      pos(660000, 52.007, 13),
    ];
    const typen = laufeNeu(spur, einstellungen, 0).punkte.map(p => `${p.type}@${p.t}`);
    tiefGleich(typen, ['pause@180000', 'resume@300000', 'log@600000']);
  });

  /* Hysterese: 1 bis 2 km/h beendet die Pause nicht. 27,8 m je 60 s
     = 1,67 km/h, bei acc 5 liegt das ueber dem Jitter-Boden. */
  test('Geschwindigkeit zwischen 1 und 2 km/h beendet die Pause nicht', () => {
    const spur = [
      ...stillstand,
      pos(300000, 52.00025, 13, 5),   // 27,8 m -> 1,67 km/h
      pos(360000, 52.00050, 13, 5),
      pos(420000, 52.00075, 13, 5),
    ];
    const typen = laufeNeu(spur, einstellungen, 0).punkte.map(p => p.type);
    tiefGleich(typen, ['pause']);
  });

  test('Autotempo loggt jede Minute', () => {
    // 0,01 Grad je 60 s = 1111,9 m -> 66,7 km/h, carInt = 1 Min
    const spur = [];
    for (let i = 0; i <= 5; i++) spur.push(pos(i * 60000, 52 + i * 0.01, 13));
    const typen = laufeNeu(spur, einstellungen, 0).punkte.map(p => `${p.type}@${p.t}`);
    tiefGleich(typen, ['log@60000', 'log@120000', 'log@180000', 'log@240000', 'log@300000']);
  });
});

// ---------- Zustand gehoert zur Aufzeichnung (C3) ----------
gruppe('zustandAusAufzeichnung', () => {
  test('ohne Aufzeichnung: Leerlauf', () => {
    tiefGleich(zustandAusAufzeichnung(null), leerZustand());
  });

  test('gespeicherter Zustand wird unveraendert uebernommen', () => {
    const gespeichert = { ...leerZustand(), zustand: 'paused',
      lastRaw: { lat: 52, lon: 13, acc: 9, t: 500 }, pauseSince: 400, lastLogTime: 300 };
    const aufz = { id: 1, startTime: 0, points: [{ t: 100, type: 'log', lat: 1, lon: 2, acc: 3 }], zustand: gespeichert };
    tiefGleich(zustandAusAufzeichnung(aufz), gespeichert);
  });

  test('gespeicherter Zustand schlaegt die Rekonstruktion', () => {
    // Letzter Punkt ist 'log', gespeichert ist trotzdem 'paused' – der
    // gespeicherte Wert gewinnt, sonst waere die Pause nach dem Neuladen weg
    const aufz = {
      id: 1, startTime: 0,
      points: [{ t: 100, type: 'log', lat: 1, lon: 2, acc: 3 }],
      zustand: { zustand: 'paused', lastRaw: null, pauseSince: 90, lastLogTime: 100 },
    };
    gleich(zustandAusAufzeichnung(aufz).zustand, 'paused');
    gleich(zustandAusAufzeichnung(aufz).pauseSince, 90);
  });

  test('Altbestand: Pause-Punkt am Ende ergibt paused', () => {
    const aufz = { id: 1, startTime: 0, points: [
      { t: 100, type: 'start', lat: 52, lon: 13, acc: 10 },
      { t: 900, type: 'pause', lat: 52.1, lon: 13.1, acc: 12 },
    ] };
    const z = zustandAusAufzeichnung(aufz);
    gleich(z.zustand, 'paused');
    gleich(z.lastLogTime, 900);
    tiefGleich(z.lastRaw, { lat: 52.1, lon: 13.1, acc: 12, t: 900 });
  });

  test('Altbestand: anderer Punkttyp ergibt moving', () => {
    const aufz = { id: 1, startTime: 0, points: [{ t: 100, type: 'log', lat: 52, lon: 13, acc: 10 }] };
    gleich(zustandAusAufzeichnung(aufz).zustand, 'moving');
  });

  test('Altbestand ohne Wegpunkte faellt auf die Startzeit zurueck', () => {
    const z = zustandAusAufzeichnung({ id: 1, startTime: 4242, points: [] });
    gleich(z.zustand, 'moving');
    gleich(z.lastLogTime, 4242);
    gleich(z.lastRaw, null);
  });

  test('unvollstaendig gespeicherter Zustand wird ergaenzt', () => {
    const z = zustandAusAufzeichnung({ id: 1, startTime: 0, points: [], zustand: { zustand: 'moving' } });
    gleich(z.pauseSince, null);
    gleich(z.lastRaw, null);
  });
});

// ---------- Zeitluecken im Hintergrund (B5) ----------
gruppe('Lueckenerkennung', () => {
  test('Schwelle ist das Dreifache des groessten Intervalls', () => {
    // groesstes Intervall 15 Min -> 45 Min
    gleich(lueckenSchwelleMs({ walkInt: 15, bikeInt: 2, carInt: 1 }), 45 * 60000);
    gleich(lueckenSchwelleMs({ walkInt: 1, bikeInt: 1, carInt: 10 }), 30 * 60000);
  });

  test('mindestens zehn Minuten, egal wie klein die Intervalle sind', () => {
    gleich(lueckenSchwelleMs({ walkInt: 1, bikeInt: 1, carInt: 1 }), 10 * 60000);
  });

  test('Vorgabe-Einstellungen ergeben 15 Minuten', () => {
    gleich(lueckenSchwelleMs(einstellungen), 15 * 60000);
  });

  test('genau an der Schwelle gilt es als Luecke', () => {
    gleich(istLuecke(0, 15 * 60000, einstellungen), true);
    gleich(istLuecke(0, 15 * 60000 - 1, einstellungen), false);
  });

  test('ohne letzte Position gibt es keine Luecke zu melden', () => {
    gleich(istLuecke(null, 99999999, einstellungen), false);
    gleich(istLuecke(undefined, 99999999, einstellungen), false);
  });

  test('Zeitstempel 0 zaehlt trotzdem als Zeitpunkt', () => {
    // 0 ist falsy, darf aber nicht wie "keine Position" behandelt werden
    gleich(istLuecke(0, 60000, einstellungen), false);
  });
});

// ---------- Differenztest gegen den Stand vor dem Umbau ----------
function prng(seed){
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/* Erzeugt eine Spur, die zwischen Stillstand, Gehen und Fahren wechselt,
   inklusive Genauigkeitsschwankungen und gelegentlicher Geraetegeschwindigkeit. */
function baueZufallsspur(seed, schritte){
  const r = prng(seed);
  const spur = [];
  let t = 0, lat = 52 + r(), lon = 13 + r();
  let modus = 0;
  for (let i = 0; i < schritte; i++){
    if (r() < 0.15) modus = Math.floor(r() * 3);   // 0 steht, 1 geht, 2 faehrt
    const dt = Math.round(5000 + r() * 115000);
    t += dt;
    const meter = modus === 0 ? r() * 8 : modus === 1 ? r() * 30 : 200 + r() * 1500;
    lat += meter / 111194.93;
    lon += (r() - 0.5) * meter / 111194.93;
    const acc = 3 + r() * 40;
    const mitSpeed = r() < 0.2;
    spur.push(pos(t, lat, lon, acc, mitSpeed ? r() * 30 : undefined));
  }
  return spur;
}

/* Die Zufallsspuren stammen aus dem Modul-Umbau, wo sie den neuen Stand gegen
   den alten stellten. Seit B6 weichen beide bewusst voneinander ab (siehe
   unten); geblieben ist die Gegenprobe, dass die Spuren ueberhaupt Wegpunkte
   aller Sorten erzeugen. */
gruppe('Zufallsspuren', () => {
  test('Zufallsspuren erzeugen ueberhaupt Wegpunkte aller Sorten', () => {
    // Sonst koennte eine Spur alle Sorten verlieren, ohne dass es auffaellt
    const alle = new Set();
    for (let seed = 1; seed <= 20; seed++){
      laufeNeu(baueZufallsspur(seed, 300), einstellungen, 0).punkte.forEach(p => alle.add(p.type));
    }
    wahr(alle.has('log'), 'keine log-Punkte in den Zufallsspuren');
    wahr(alle.has('pause'), 'keine pause-Punkte in den Zufallsspuren');
    wahr(alle.has('resume'), 'keine resume-Punkte in den Zufallsspuren');
  });

});

/* ---------- Sekundentakt: der Befund vom 30.08.2026 (B6) ----------

   watchPosition liefert im Sekundentakt. Alle Spuren oben liegen im
   Minutenabstand – deshalb ist nie aufgefallen, dass zwei Positionen im
   Sekundenabstand beim Gehen naeher beieinanderliegen als die GPS-Genauigkeit
   und die Geschwindigkeit damit immer 0 ergibt. */

/* Gleichmaessige Fahrt nach Norden, Positionen alle dtSek Sekunden. Ohne
   coords.speed – genau der Fall, in dem gerechnet werden muss. */
function fahrSpur({ dtSek, acc, kmh, minuten, rauschen = 0, seed = 12345 }){
  const spur = [];
  const mProSchritt = (kmh / 3.6) * dtSek;
  let lat = 52, t = 0, s = seed;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 1; i <= Math.round(minuten * 60 / dtSek); i++){
    t += dtSek * 1000;
    lat += mProSchritt / 111194.93;
    spur.push(pos(t,
      lat + (rnd() - 0.5) * rauschen / 111194.93,
      13 + (rnd() - 0.5) * rauschen / 111194.93,
      acc));
  }
  return spur;
}

function artenZaehlen(punkte){
  const zaehler = {};
  for (const p of punkte) zaehler[p.type] = (zaehler[p.type] || 0) + 1;
  return zaehler;
}

gruppe('Gehen im Sekundentakt (B6)', () => {
  const gehen = fahrSpur({ dtSek: 2, acc: 15, kmh: 5, minuten: 30, rauschen: 6 });

  test('30 Minuten Gehen ergeben sechs Wegpunkte, kein Steckenbleiben', () => {
    const { punkte, zst } = laufeNeu(gehen, einstellungen, 0);
    tiefGleich(artenZaehlen(punkte), { log: 6 }, 'Wegpunktarten');
    gleich(zst.zustand, 'moving', 'Endzustand');
  });

  test('der Stand vor B6 blieb hier nach pauseMin stehen', () => {
    // Genau der gemeldete Fehler: ein Pausenpunkt, danach nie wieder etwas.
    const { punkte, zustand } = laufeAlt(gehen, einstellungen, 0);
    tiefGleich(artenZaehlen(punkte), { pause: 1 }, 'Wegpunktarten (alter Stand)');
    gleich(zustand.trackState, 'paused', 'Endzustand (alter Stand)');
  });

  test('grobe Ortung ohne messbares Tempo: der Ortswechsel traegt', () => {
    // Bei 150 m Ungenauigkeit bleibt jede Gehstrecke unter dem Rauschboden,
    // die Geschwindigkeit ist also nicht zu messen. Der Abstand zum Ort, an
    // dem der Stillstand begann, ist es sehr wohl.
    const grob = fahrSpur({ dtSek: 5, acc: 150, kmh: 5, minuten: 30 });
    const { punkte, speeds, zst } = laufeNeu(grob, einstellungen, 0);
    wahr(speeds.every(v => v === 0), 'Tempo war wider Erwarten messbar');
    tiefGleich(artenZaehlen(punkte), { log: 6 }, 'Wegpunktarten');
    gleich(zst.zustand, 'moving', 'Endzustand');
  });

  test('Radtempo im Sekundentakt nimmt den Radtakt', () => {
    const rad = fahrSpur({ dtSek: 2, acc: 15, kmh: 18, minuten: 30, rauschen: 6 });
    const { punkte } = laufeNeu(rad, einstellungen, 0);
    const arten = artenZaehlen(punkte);
    // bikeInt = 2 Min -> 15 Wegpunkte in 30 Min; einer weniger, wenn der erste
    // erst faellt, sobald sich das Tempo ueberhaupt messen laesst
    wahr(arten.log === 15 || arten.log === 14, 'Wegpunkte im Radtakt: ' + arten.log);
    gleich(arten.pause, undefined, 'kein Pausenpunkt beim Radfahren');
  });

  test('Stillstand im Sekundentakt ergibt weiterhin genau eine Pause', () => {
    const stehen = fahrSpur({ dtSek: 2, acc: 15, kmh: 0, minuten: 20, rauschen: 8 });
    const { punkte, zst } = laufeNeu(stehen, einstellungen, 0);
    tiefGleich(artenZaehlen(punkte), { pause: 1 }, 'Wegpunktarten');
    gleich(zst.zustand, 'paused', 'Endzustand');
  });

  test('eine aus der Zeit vor B6 geerbte Pause bleibt nicht kleben', () => {
    /* Wer beim Umstieg mitten in der haengengebliebenen Pause steckte, hat
       einen Zustand ohne pauseAnchor gespeichert. Auch der muss wieder
       herausfinden, wenn sich das Tempo nicht messen laesst. */
    const geerbt = { ...leerZustand(), zustand: 'paused', pauseSince: 0, lastLogTime: 0 };
    let zst = geerbt;
    const punkte = [];
    for (const p of fahrSpur({ dtSek: 5, acc: 150, kmh: 5, minuten: 20 })){
      const e = schrittPosition(zst, p.coords, p.timestamp, einstellungen);
      zst = e.zst;
      punkte.push(...e.punkte);
    }
    gleich(artenZaehlen(punkte).resume, 1, 'kein Weiter-Punkt');
    gleich(zst.zustand, 'moving', 'Endzustand');
  });

  test('aus der Pause holt ein belegter Ortswechsel zurueck', () => {
    // Erst zehn Minuten stehen, dann losgehen – ohne Geraetetempo.
    const spur = [
      ...fahrSpur({ dtSek: 2, acc: 15, kmh: 0, minuten: 10, rauschen: 8 }),
    ];
    const startT = spur[spur.length - 1].timestamp;
    const weiter = fahrSpur({ dtSek: 2, acc: 15, kmh: 5, minuten: 20, rauschen: 6 });
    for (const p of weiter) spur.push(pos(startT + p.timestamp, p.coords.latitude, p.coords.longitude, 15));
    const { punkte, zst } = laufeNeu(spur, einstellungen, 0);
    const arten = artenZaehlen(punkte);
    gleich(arten.pause, 1, 'genau ein Pausenpunkt');
    gleich(arten.resume, 1, 'genau ein Weiter-Punkt');
    wahr(arten.log >= 3, 'zu wenige Wegpunkte nach dem Weitergehen: ' + arten.log);
    gleich(zst.zustand, 'moving', 'Endzustand');
  });
});
