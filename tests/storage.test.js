import { gruppe, test, gleich, tiefGleich } from './lauf.js';
import * as speicher from '../js/storage.js';

/* Attrappe statt echtem localStorage: die Tests duerfen aufgezeichnete
   Wegpunkte des Nutzers unter keinen Umstaenden anfassen. */
export function attrappe(inhalt = {}){
  const daten = new Map(Object.entries(inhalt));
  return {
    getItem: k => (daten.has(k) ? daten.get(k) : null),
    setItem: (k, v) => { daten.set(k, String(v)); },
    removeItem: k => { daten.delete(k); },
    schluessel: () => [...daten.keys()],
    roh: k => daten.get(k),
  };
}

function mitAttrappe(inhalt, fn){
  const a = attrappe(inhalt);
  speicher.setzeSpeicher(a);
  try { return fn(a); }
  finally { speicher.setzeSpeicher(typeof localStorage !== 'undefined' ? localStorage : null); }
}

const beispielPunkt = { t: 1000, lat: 52.5, lon: 13.4, acc: 12, speedKmh: 5.4, type: 'log', place: 'Berlin' };

gruppe('storage: Einstellungen', () => {
  test('leerer Speicher liefert die Vorgaben', () => {
    mitAttrappe({}, () => tiefGleich(speicher.loadSettings(), speicher.defaultSettings));
  });

  test('gespeicherte Werte ueberschreiben nur einzelne Felder', () => {
    mitAttrappe({ 'weglog.settings': '{"pauseMin":9}' }, () => {
      const s = speicher.loadSettings();
      gleich(s.pauseMin, 9);
      gleich(s.walkInt, speicher.defaultSettings.walkInt);
    });
  });

  test('kaputtes JSON faellt auf die Vorgaben zurueck', () => {
    mitAttrappe({ 'weglog.settings': '{kaputt' }, () => {
      tiefGleich(speicher.loadSettings(), speicher.defaultSettings);
    });
  });
});

gruppe('storage: Aufzeichnungen', () => {
  test('Verlauf ueberlebt Schreiben und Lesen unveraendert', () => {
    const verlauf = [{ id: 1, startTime: 0, endTime: 5000, distanceKm: 1.2345, points: [beispielPunkt] }];
    mitAttrappe({}, () => {
      speicher.saveHistory(verlauf);
      tiefGleich(speicher.loadHistory(), verlauf);
    });
  });

  test('leerer Speicher liefert leeren Verlauf, nicht null', () => {
    mitAttrappe({}, () => tiefGleich(speicher.loadHistory(), []));
  });

  test('kaputtes JSON verliert den Verlauf nicht still als null', () => {
    mitAttrappe({ 'weglog.history': 'xxx' }, () => tiefGleich(speicher.loadHistory(), []));
  });

  test('aktive Aufzeichnung: null entfernt den Schluessel', () => {
    mitAttrappe({ 'weglog.active': '{"id":1}' }, a => {
      speicher.saveActive(null);
      gleich(a.schluessel().includes('weglog.active'), false);
      gleich(speicher.loadActive(), null);
    });
  });

  test('aktive Aufzeichnung ueberlebt Schreiben und Lesen', () => {
    const aktiv = { id: 7, startTime: 100, points: [beispielPunkt] };
    mitAttrappe({}, () => {
      speicher.saveActive(aktiv);
      tiefGleich(speicher.loadActive(), aktiv);
    });
  });
});

gruppe('storage: Geocache', () => {
  test('Cache ueberlebt Schreiben und Lesen', () => {
    mitAttrappe({}, () => {
      speicher.saveGeocache({ '52.500,13.400': 'Berlin' });
      tiefGleich(speicher.loadGeocache(), { '52.500,13.400': 'Berlin' });
    });
  });

  test('leerer Speicher liefert ein Objekt, nicht null', () => {
    mitAttrappe({}, () => tiefGleich(speicher.loadGeocache(), {}));
  });
});
