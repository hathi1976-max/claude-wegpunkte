import { gruppe, test, gleich, nahe } from './lauf.js';
import { haversine, sessionDistanceKm, computeSpeedKmh, intervalMsForSpeed } from '../js/geo.js';
import { fmtDuration } from '../js/format.js';

/* Ein Breitengrad ist R * pi/180 = 6371000 * 0.0174532925 = 111194,93 m.
   Damit lassen sich alle Strecken hier von Hand nachrechnen. */
const GRAD_M = 111194.93;

const einstellungen = { walkInt: 5, bikeInt: 2, carInt: 1, pauseMin: 3, useGeocode: false };

gruppe('haversine', () => {
  test('gleicher Punkt ergibt 0', () => {
    gleich(haversine(52.5, 13.4, 52.5, 13.4), 0);
  });

  test('ein Breitengrad = 111194,93 m', () => {
    nahe(haversine(0, 0, 1, 0), GRAD_M, 1);
    nahe(haversine(52, 13, 53, 13), GRAD_M, 1);
  });

  test('ein Laengengrad am Aequator = ein Breitengrad', () => {
    nahe(haversine(0, 0, 0, 1), GRAD_M, 1);
  });

  test('Richtung spielt keine Rolle', () => {
    nahe(haversine(52, 13, 53, 14), haversine(53, 14, 52, 13), 1e-9);
  });
});

gruppe('sessionDistanceKm', () => {
  test('leere und einelementige Spur ergeben 0', () => {
    gleich(sessionDistanceKm([]), 0);
    gleich(sessionDistanceKm([{ lat: 52, lon: 13 }]), 0);
  });

  test('drei Punkte je ein Breitengrad = 222,39 km', () => {
    const punkte = [{ lat: 50, lon: 10 }, { lat: 51, lon: 10 }, { lat: 52, lon: 10 }];
    nahe(sessionDistanceKm(punkte), 2 * GRAD_M / 1000, 0.01);
  });

  test('Hin- und Rueckweg zaehlen beide', () => {
    const punkte = [{ lat: 50, lon: 10 }, { lat: 51, lon: 10 }, { lat: 50, lon: 10 }];
    nahe(sessionDistanceKm(punkte), 2 * GRAD_M / 1000, 0.01);
  });
});

gruppe('computeSpeedKmh', () => {
  test('ohne Vorgaenger 0', () => {
    gleich(computeSpeedKmh({ latitude: 52, longitude: 13, accuracy: 20 }, 1000, null), 0);
  });

  test('Geraetegeschwindigkeit hat Vorrang (m/s -> km/h)', () => {
    const s = computeSpeedKmh({ latitude: 52, longitude: 13, accuracy: 20, speed: 10 }, 1000, null);
    nahe(s, 36, 1e-9);
  });

  test('negative Geraetegeschwindigkeit wird ignoriert', () => {
    // speed = -1 bedeutet "unbekannt"; dann zaehlt die Rechnung ueber die Strecke
    const lastRaw = { lat: 52, lon: 13, acc: 20, t: 0 };
    const s = computeSpeedKmh({ latitude: 52.001, longitude: 13, accuracy: 20, speed: -1 }, 10000, lastRaw);
    nahe(s, (GRAD_M / 1000) / 10 * 3.6, 0.01);
  });

  test('111,19 m in 10 s = 40,03 km/h', () => {
    const lastRaw = { lat: 52, lon: 13, acc: 20, t: 0 };
    const s = computeSpeedKmh({ latitude: 52.001, longitude: 13, accuracy: 20 }, 10000, lastRaw);
    nahe(s, 40.03, 0.01);
  });

  test('Bewegung unter der GPS-Ungenauigkeit gilt als Stillstand', () => {
    // 11,12 m Versatz bei jitterFloor 20 m -> 0
    const lastRaw = { lat: 52, lon: 13, acc: 20, t: 0 };
    gleich(computeSpeedKmh({ latitude: 52.0001, longitude: 13, accuracy: 20 }, 10000, lastRaw), 0);
  });

  test('Schwelle haengt an der gemeldeten Genauigkeit', () => {
    // gleicher Versatz (11,12 m), aber jitterFloor nur 5 m -> zaehlt jetzt
    const lastRaw = { lat: 52, lon: 13, acc: 5, t: 0 };
    const s = computeSpeedKmh({ latitude: 52.0001, longitude: 13, accuracy: 5 }, 10000, lastRaw);
    nahe(s, 4.003, 0.01);
  });

  test('Zeitspruenge rueckwaerts ergeben 0', () => {
    const lastRaw = { lat: 52, lon: 13, acc: 20, t: 10000 };
    gleich(computeSpeedKmh({ latitude: 52.01, longitude: 13, accuracy: 20 }, 5000, lastRaw), 0);
  });
});

gruppe('intervalMsForSpeed', () => {
  test('unterhalb 7 km/h: Fussgaenger-Intervall', () => {
    gleich(intervalMsForSpeed(0, einstellungen), 5 * 60000);
    gleich(intervalMsForSpeed(6.999, einstellungen), 5 * 60000);
  });

  test('genau 7 km/h kippt auf Rad', () => {
    gleich(intervalMsForSpeed(7, einstellungen), 2 * 60000);
    gleich(intervalMsForSpeed(24.999, einstellungen), 2 * 60000);
  });

  test('genau 25 km/h kippt auf Auto', () => {
    gleich(intervalMsForSpeed(25, einstellungen), 1 * 60000);
    gleich(intervalMsForSpeed(200, einstellungen), 1 * 60000);
  });
});

gruppe('fmtDuration', () => {
  test('59 / 60 / 61 Minuten', () => {
    gleich(fmtDuration(59 * 60000), '59 Min');
    gleich(fmtDuration(60 * 60000), '1 Std 0 Min');
    gleich(fmtDuration(61 * 60000), '1 Std 1 Min');
  });

  test('rundet auf volle Minuten', () => {
    gleich(fmtDuration(29000), '0 Min');
    gleich(fmtDuration(31000), '1 Min');
  });

  test('mehrere Stunden', () => {
    gleich(fmtDuration(125 * 60000), '2 Std 5 Min');
  });
});
