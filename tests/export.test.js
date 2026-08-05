import { gruppe, test, gleich, wahr, tiefGleich, wirft } from './lauf.js';
import {
  xmlEsc, csvFeld, zahl, zeitstempelName, dateiname,
  alsGpx, alsCsv, CSV_KOPF, alsSicherung, leseSicherung, vereine, istAufzeichnung,
} from '../js/export.js';

/* Ein Ortsname, wie ihn OpenStreetMap grundsaetzlich enthalten koennte:
   frei editierbarer Fremdtext mit Markup. */
const BOESER_ORT = '<img src=x onerror="alert(1)">Böse; Stadt "A"';

function punkt(t, lat, lon, type = 'log', place = null){
  return { t, lat, lon, acc: 12, speedKmh: 5.4, type, place };
}

const beispiel = {
  id: 1700000000000,
  startTime: Date.UTC(2026, 7, 5, 10, 0, 0),
  endTime: Date.UTC(2026, 7, 5, 11, 0, 0),
  distanceKm: 4.2,
  points: [
    punkt(Date.UTC(2026, 7, 5, 10, 0, 0), 52.5, 13.4, 'start', 'Berlin'),
    punkt(Date.UTC(2026, 7, 5, 10, 30, 0), 52.51, 13.41, 'log', BOESER_ORT),
    punkt(Date.UTC(2026, 7, 5, 11, 0, 0), 52.52, 13.42, 'stop', null),
  ],
};

gruppe('export: Helfer', () => {
  test('xmlEsc entschaerft alle fuenf Sonderzeichen', () => {
    gleich(xmlEsc('<a href="x">&\'</a>'),
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });

  test('xmlEsc wirft in XML verbotene Steuerzeichen weg', () => {
    gleich(xmlEsc('a\u0000b\u0001c\u001Fd'), 'abcd');
  });

  test('xmlEsc laesst Zeilenumbruch und Tabulator stehen', () => {
    gleich(xmlEsc('a\tb\nc'), 'a\tb\nc');
  });

  test('xmlEsc vertraegt null und undefined', () => {
    gleich(xmlEsc(null), '');
    gleich(xmlEsc(undefined), '');
  });

  test('csvFeld entschaerft Formeln', () => {
    gleich(csvFeld('=1+1'), "'=1+1");
    gleich(csvFeld('+49'), "'+49");
    gleich(csvFeld('-5'), "'-5");
    gleich(csvFeld('@Ort'), "'@Ort");
  });

  test('csvFeld quotiert Trenner, Anfuehrungszeichen und Umbrueche', () => {
    gleich(csvFeld('a;b'), '"a;b"');
    gleich(csvFeld('a"b'), '"a""b"');
    gleich(csvFeld('a\nb'), '"a\nb"');
    gleich(csvFeld('Berlin'), 'Berlin');
  });

  test('zahl liefert deutsches Dezimalzeichen', () => {
    gleich(zahl(52.5, 6), '52,500000');
    gleich(zahl(-0.5, 1), '-0,5');
    gleich(zahl(NaN, 1), '');
    gleich(zahl(undefined, 1), '');
  });

  test('zeitstempelName und dateiname', () => {
    const t = new Date(2026, 7, 5, 9, 7).getTime();   // Ortszeit, wie im Namen gewuenscht
    gleich(zeitstempelName(t), '2026-08-05-0907');
    gleich(dateiname({ startTime: t }, 'gpx'), 'weglog-2026-08-05-0907.gpx');
  });
});

gruppe('export: GPX', () => {
  const gpx = alsGpx(beispiel);

  test('ein trkpt je Wegpunkt, mit Zeitstempel', () => {
    gleich((gpx.match(/<trkpt /g) || []).length, 3);
    // 3 trkpt + 2 wpt (start, stop) + 1 metadata
    gleich((gpx.match(/<time>/g) || []).length, 6);
    wahr(gpx.includes('<trkpt lat="52.5" lon="13.4">'), 'erster Punkt fehlt');
  });

  test('nur markante Punkte werden zusaetzlich wpt', () => {
    // start und stop ja, log nein
    gleich((gpx.match(/<wpt /g) || []).length, 2);
    wahr(gpx.includes('<name>Start – Berlin</name>'), 'Start-wpt fehlt');
    wahr(gpx.includes('<name>Ende</name>'), 'Ende-wpt ohne Ort fehlt');
  });

  test('fremder Ortsname landet nicht roh im XML', () => {
    const mitOrt = alsGpx({ ...beispiel, points: [punkt(0, 1, 2, 'pause', BOESER_ORT)] });
    wahr(!mitOrt.includes('<img'), 'rohes Markup im GPX');
    wahr(mitOrt.includes('&lt;img'), 'Markup nicht escaped');
    wahr(!/onerror="alert/.test(mitOrt), 'rohes Attribut im GPX');
  });

  test('Kopf und Wurzelelement stimmen', () => {
    wahr(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML-Kopf fehlt');
    wahr(gpx.includes('<gpx version="1.1" creator="WegLog"'), 'gpx-Element fehlt');
    wahr(gpx.trimEnd().endsWith('</gpx>'), 'gpx nicht geschlossen');
  });

  test('leere Aufzeichnung erzeugt trotzdem gueltiges Geruest', () => {
    const leer = alsGpx({ startTime: 0, points: [] });
    gleich((leer.match(/<trkpt /g) || []).length, 0);
    gleich((leer.match(/<wpt /g) || []).length, 0);
    wahr(leer.includes('<trkseg>'), 'trkseg fehlt');
  });

  test('der Browser haelt das Ergebnis fuer wohlgeformtes XML', () => {
    // Der boese Ortsname muss auf einem markanten Punkt sitzen, sonst
    // landet er gar nicht erst in einem <wpt><name>
    const mitOrt = { ...beispiel, points: [punkt(0, 52, 13, 'pause', BOESER_ORT)] };
    const doc = new DOMParser().parseFromString(alsGpx(mitOrt), 'application/xml');
    gleich(doc.getElementsByTagName('parsererror').length, 0, 'GPX ist nicht wohlgeformt');
    gleich(doc.getElementsByTagName('trkpt').length, 1);
    // Der Fremdtext ist Text, kein Element
    const namen = [...doc.getElementsByTagName('name')].map(n => n.textContent);
    wahr(namen.some(n => n.includes('<img src=x')), 'Ortsname nicht als Text erhalten');
    gleich(doc.getElementsByTagName('img').length, 0);
  });
});

gruppe('export: CSV', () => {
  const csv = alsCsv(beispiel);
  const zeilen = csv.trimEnd().split('\r\n');

  test('Kopfzeile und eine Zeile je Wegpunkt', () => {
    gleich(zeilen[0], CSV_KOPF.join(';'));
    gleich(zeilen.length, 4);
  });

  test('Zahlen mit Komma, Koordinaten auf sechs Stellen', () => {
    wahr(zeilen[1].includes(';52,500000;13,400000;'), 'Koordinaten falsch: ' + zeilen[1]);
    wahr(zeilen[1].endsWith(';5,4;12'), 'Tempo/Genauigkeit falsch: ' + zeilen[1]);
  });

  test('Ortsname mit Semikolon zerreisst die Zeile nicht', () => {
    // BOESER_ORT enthaelt ; und " -> muss quotiert sein
    const felder = zerlege(zeilen[2]);
    gleich(felder.length, 7);
    gleich(felder[2], BOESER_ORT);
  });

  test('leere Aufzeichnung liefert nur die Kopfzeile', () => {
    gleich(alsCsv({ points: [] }).trimEnd(), CSV_KOPF.join(';'));
  });
});

/* Kleiner CSV-Leser fuer den Test – prueft, dass die Quotierung haelt. */
function zerlege(zeile){
  const felder = [];
  let feld = '', inAnf = false;
  for (let i = 0; i < zeile.length; i++){
    const c = zeile[i];
    if (inAnf){
      if (c === '"' && zeile[i+1] === '"'){ feld += '"'; i++; }
      else if (c === '"') inAnf = false;
      else feld += c;
    } else if (c === '"'){ inAnf = true; }
    else if (c === ';'){ felder.push(feld); feld = ''; }
    else feld += c;
  }
  felder.push(feld);
  return felder;
}

gruppe('export: Sicherung', () => {
  test('Sicherung und Wiedereinlesen erhalten die Aufzeichnung', () => {
    const zurueck = leseSicherung(alsSicherung([beispiel], null));
    gleich(zurueck.length, 1);
    gleich(zurueck[0].id, beispiel.id);
    gleich(zurueck[0].points.length, 3);
    gleich(zurueck[0].points[1].place, BOESER_ORT);
    gleich(zurueck[0].distanceKm, 4.2);
  });

  test('die laufende Aufzeichnung kommt mit in die Sicherung', () => {
    const laufend = { id: 'x', startTime: 5, points: [punkt(5, 1, 2, 'start')], zustand: { zustand: 'moving' } };
    const daten = JSON.parse(alsSicherung([beispiel], laufend));
    gleich(daten.aufzeichnungen.length, 2);
    gleich(daten.aufzeichnungen[0].id, 'x');
    // Laufzeitzustand gehoert nicht in die Datei
    gleich('zustand' in daten.aufzeichnungen[0], false);
  });

  test('fehlende Streckenlaenge wird nachgerechnet', () => {
    const ohne = { id: 2, startTime: 0, points: [punkt(0, 50, 10), punkt(1, 51, 10)] };
    const daten = JSON.parse(alsSicherung([ohne], null));
    wahr(Math.abs(daten.aufzeichnungen[0].distanceKm - 111.19493) < 0.01,
      'Strecke ' + daten.aufzeichnungen[0].distanceKm);
  });

  test('kaputte oder fremde Dateien werden abgelehnt', () => {
    wirft(() => leseSicherung('kein json'), 'JSON-Fehler nicht erkannt');
    wirft(() => leseSicherung('{"app":"anderes"}'), 'fremde Datei nicht erkannt');
    wirft(() => leseSicherung('{"aufzeichnungen":[]}'), 'leere Sicherung nicht erkannt');
    wirft(() => leseSicherung('{"aufzeichnungen":[{"id":1}]}'), 'unvollstaendiger Satz nicht erkannt');
  });

  test('istAufzeichnung prueft die Pflichtfelder', () => {
    gleich(istAufzeichnung(beispiel), true);
    gleich(istAufzeichnung({ id: 1, startTime: 0, points: [{ t: 1, lat: 'x', lon: 2 }] }), false);
    gleich(istAufzeichnung({ startTime: 0, points: [] }), false);
    gleich(istAufzeichnung(null), false);
  });
});

gruppe('export: vereine', () => {
  const a = { id: 1, startTime: 100, points: [] };
  const b = { id: 2, startTime: 300, points: [] };
  const c = { id: 3, startTime: 200, points: [] };

  test('unbekannte werden ergaenzt, nach Startzeit absteigend', () => {
    tiefGleich(vereine([a], [b, c]).map(s => s.id), [2, 3, 1]);
  });

  test('gleiche id gewinnt der Bestand', () => {
    const fremd = { id: 1, startTime: 100, points: [punkt(0, 1, 2)] };
    const erg = vereine([a], [fremd]);
    gleich(erg.length, 1);
    gleich(erg[0].points.length, 0);
  });

  test('id als Zahl und als Zeichenkette gilt als dieselbe', () => {
    gleich(vereine([a], [{ id: '1', startTime: 100, points: [] }]).length, 1);
  });

  test('nichts einzulesen aendert nichts', () => {
    tiefGleich(vereine([a, b], []).map(s => s.id), [2, 1]);
  });
});
