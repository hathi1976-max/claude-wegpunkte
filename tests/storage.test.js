import { gruppe, test, gleich, tiefGleich, wahr } from './lauf.js';
import * as speicher from '../js/storage.js';

/* Attrappe statt echtem localStorage: die Tests duerfen aufgezeichnete
   Wegpunkte des Nutzers unter keinen Umstaenden anfassen.

   grenze = Zeichen, ab denen setItem wie ein voller Speicher reagiert. */
export function attrappe(inhalt = {}, grenze = Infinity){
  const daten = new Map(Object.entries(inhalt));
  return {
    getItem: k => (daten.has(k) ? daten.get(k) : null),
    setItem: (k, v) => {
      const s = String(v);
      let belegt = s.length;
      for (const [dk, dv] of daten) if (dk !== k) belegt += dv.length;
      if (belegt > grenze){
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        e.code = 22;
        throw e;
      }
      daten.set(k, s);
    },
    removeItem: k => { daten.delete(k); },
    schluessel: () => [...daten.keys()],
    roh: k => daten.get(k),
  };
}

function mitAttrappe(inhalt, fn, grenze){
  const a = attrappe(inhalt, grenze);
  speicher.setzeSpeicher(a);
  try { return fn(a); }
  finally { speicher.setzeSpeicher(typeof localStorage !== 'undefined' ? localStorage : null); }
}

/* Faengt die Meldungen ab, die storage.js an die Anzeige schicken wuerde. */
function mitMelder(fn){
  const gemeldet = [];
  speicher.setzeMelder((text, art) => gemeldet.push({ text, art }));
  try { return fn(gemeldet); }
  finally { speicher.setzeMelder(null); }
}

const beispielPunkt = { t: 1000, lat: 52.5, lon: 13.4, acc: 12, speedKmh: 5.4, type: 'log', place: 'Berlin' };

gruppe('storage: Einstellungen', () => {
  test('leerer Speicher liefert die Vorgaben', () => {
    mitAttrappe({}, () => tiefGleich(speicher.loadSettings(), speicher.defaultSettings));

  test('Bildschirm wach halten ist per Vorgabe an', () => {
    /* Bewusste Entscheidung, kein Zufall: ohne Wake Lock bleibt die
       Aufzeichnung stehen, sobald der Bildschirm ausgeht — und das faellt
       erst hinterher an den fehlenden Wegpunkten auf. */
    gleich(speicher.defaultSettings.wachHalten, true);
  });

  test('abgeschaltetes Wachhalten ueberlebt das Neuladen', () => {
    mitAttrappe({ 'weglog.settings': JSON.stringify({ wachHalten: false }) }, () => {
      gleich(speicher.loadSettings().wachHalten, false);
      gleich(speicher.loadSettings().walkInt, speicher.defaultSettings.walkInt,
        'uebrige Vorgaben bleiben');
    });
  });
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
      gleich(speicher.saveHistory(verlauf), true);
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

gruppe('storage: voller Speicher (A2)', () => {
  test('istQuotaFehler erkennt die ueblichen Auspraegungen', () => {
    gleich(speicher.istQuotaFehler({ name: 'QuotaExceededError' }), true);
    gleich(speicher.istQuotaFehler({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
    gleich(speicher.istQuotaFehler({ code: 22 }), true);
    gleich(speicher.istQuotaFehler({ code: 1014 }), true);
    gleich(speicher.istQuotaFehler({ name: 'TypeError' }), false);
    gleich(speicher.istQuotaFehler(null), false);
  });

  test('persist liefert false statt zu werfen', () => {
    mitMelder(() => {
      mitAttrappe({}, () => {
        gleich(speicher.persist('weglog.history', [beispielPunkt]), false);
      }, 10);   // 10 Zeichen Platz reichen fuer nichts
    });
  });

  test('voller Speicher meldet sich beim Nutzer', () => {
    mitMelder(gemeldet => {
      mitAttrappe({}, () => speicher.saveHistory([beispielPunkt]), 10);
      gleich(gemeldet.length, 1);
      gleich(gemeldet[0].art, 'error');
      wahr(gemeldet[0].text.includes('Speicher voll'), 'Meldung: ' + gemeldet[0].text);
    });
  });

  test('der alte Stand bleibt erhalten, wenn das Schreiben scheitert', () => {
    mitMelder(() => {
      mitAttrappe({ 'weglog.history': '[]' }, a => {
        const gross = [{ id: 1, startTime: 0, points: Array(50).fill(beispielPunkt) }];
        gleich(speicher.saveHistory(gross), false);
        gleich(a.roh('weglog.history'), '[]');
      }, 200);
    });
  });

  test('unter der Grenze wird ganz normal geschrieben', () => {
    mitMelder(gemeldet => {
      mitAttrappe({}, () => {
        gleich(speicher.saveHistory([]), true);
      }, 10000);
      gleich(gemeldet.length, 0);
    });
  });
});

gruppe('storage: Geocache', () => {
  test('Cache ueberlebt Schreiben und Lesen', () => {
    mitAttrappe({}, () => {
      speicher.saveGeocache({ '52.500,13.400': { ort: 'Berlin', t: 5 } });
      tiefGleich(speicher.loadGeocache(), { '52.500,13.400': { ort: 'Berlin', t: 5 } });
    });
  });

  test('leerer Speicher liefert ein Objekt, nicht null', () => {
    mitAttrappe({}, () => tiefGleich(speicher.loadGeocache(), {}));
  });

  test('alte Eintraege ohne Zeitstempel werden umgesetzt', () => {
    mitAttrappe({ 'weglog.geocache': '{"52.500,13.400":"Berlin"}' }, () => {
      tiefGleich(speicher.loadGeocache(), { '52.500,13.400': { ort: 'Berlin', t: 0 } });
    });
  });

  test('unbrauchbare Eintraege fliegen beim Lesen raus', () => {
    mitAttrappe({ 'weglog.geocache': '{"a":null,"b":{"kein":"ort"},"c":"Ort"}' }, () => {
      tiefGleich(Object.keys(speicher.loadGeocache()), ['c']);
    });
  });

  test('deckleGeocache verwirft die aeltesten Eintraege', () => {
    const cache = {};
    for (let i = 0; i < 10; i++) cache['k' + i] = { ort: 'O' + i, t: i };
    const klein = speicher.deckleGeocache(cache, 3);
    tiefGleich(Object.keys(klein).sort(), ['k7', 'k8', 'k9']);
  });

  test('deckleGeocache laesst kleine Caches unangetastet', () => {
    const cache = { a: { ort: 'A', t: 1 } };
    gleich(speicher.deckleGeocache(cache, 3), cache);
  });

  test('Eintraege ohne Zeitstempel gelten als die aeltesten', () => {
    const cache = { alt: { ort: 'A', t: 0 }, neu: { ort: 'B', t: 99 } };
    tiefGleich(Object.keys(speicher.deckleGeocache(cache, 1)), ['neu']);
  });
});

gruppe('storage: Hausputz', () => {
  test('belegung zaehlt alle vier Schluessel', () => {
    mitAttrappe({ 'weglog.history': '[1]', 'weglog.geocache': '{}' }, () => {
      const b = speicher.belegung();
      gleich(b.zeichen, 3 + 2);
      gleich(b.eintraege.length, 4);
    });
  });

  test('belegung eines leeren Speichers ist 0', () => {
    mitAttrappe({}, () => gleich(speicher.belegung().zeichen, 0));
  });

  test('teileNachAlter trennt an der Tagesgrenze', () => {
    const jetzt = 100 * 86400000;
    const alt = { id: 1, startTime: 0, endTime: 5 * 86400000 };
    const neu = { id: 2, startTime: 0, endTime: 95 * 86400000 };
    const { behalten, entfernt } = speicher.teileNachAlter([alt, neu], 90, jetzt);
    tiefGleich(behalten.map(s => s.id), [2]);
    tiefGleich(entfernt.map(s => s.id), [1]);
  });

  test('ohne endTime zaehlt der Beginn', () => {
    const jetzt = 100 * 86400000;
    const ohneEnde = { id: 3, startTime: 1 * 86400000 };
    gleich(speicher.teileNachAlter([ohneEnde], 90, jetzt).entfernt.length, 1);
  });

  test('genau an der Grenze bleibt die Aufzeichnung erhalten', () => {
    const jetzt = 100 * 86400000;
    const grenzfall = { id: 4, startTime: 0, endTime: 10 * 86400000 };  // exakt 90 Tage alt
    gleich(speicher.teileNachAlter([grenzfall], 90, jetzt).behalten.length, 1);
  });
});
