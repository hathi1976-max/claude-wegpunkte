/* Export der Aufzeichnungen – GPX, CSV und eine vollstaendige JSON-Sicherung.
   Ohne fremde Bibliothek und ohne DOM: alle Funktionen hier liefern reinen
   Text zurueck, das Herunterladen passiert in ui.js. */

import { sessionDistanceKm } from './geo.js';
import { typeLabel } from './format.js';

export const SICHERUNG_FORMAT = 1;

/* ---------- gemeinsame Helfer ---------- */

/* XML kennt weder rohe spitze Klammern noch die meisten Steuerzeichen.
   Ortsnamen kommen von Nominatim und sind Fremdtext (siehe B1). */
export function xmlEsc(text){
  return String(text ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* Deutsches Tabellenformat: Semikolon als Trenner, Komma als Dezimalzeichen.
   Damit oeffnet die Datei in einer deutschen Tabellenkalkulation direkt
   richtig; die maschinenlesbare Fassung ist GPX. */
export function zahl(wert, stellen){
  if (typeof wert !== 'number' || !isFinite(wert)) return '';
  return wert.toFixed(stellen).replace('.', ',');
}

/* Ein Feld, das mit = + - @ beginnt, wird von Tabellenprogrammen als Formel
   gelesen. Fremde Ortsnamen duerfen das nicht ausloesen. */
export function csvFeld(wert){
  let s = String(wert ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function zeitstempelName(t){
  const d = new Date(t);
  const zz = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${zz(d.getMonth() + 1)}-${zz(d.getDate())}-${zz(d.getHours())}${zz(d.getMinutes())}`;
}

export function dateiname(session, endung){
  return `weglog-${zeitstempelName(session.startTime)}.${endung}`;
}

/* ---------- GPX ---------- */

/* Der Weg selbst als <trk>, die markanten Punkte (Start, Pause, Weiter, Ende)
   zusaetzlich als <wpt> – so bleiben sie in Komoot/OsmAnd sichtbar, waehrend
   die Spur durchgehend bleibt. */
export function alsGpx(session){
  const punkte = session.points || [];
  const trkpts = punkte.map(p =>
    `      <trkpt lat="${p.lat}" lon="${p.lon}">\n` +
    `        <time>${new Date(p.t).toISOString()}</time>\n` +
    `      </trkpt>`
  ).join('\n');

  const wpts = punkte
    .filter(p => p.type !== 'log')
    .map(p => {
      const name = typeLabel(p.type) + (p.place ? ' – ' + p.place : '');
      return `  <wpt lat="${p.lat}" lon="${p.lon}">\n` +
             `    <time>${new Date(p.t).toISOString()}</time>\n` +
             `    <name>${xmlEsc(name)}</name>\n` +
             `  </wpt>`;
    }).join('\n');

  const titel = 'WegLog ' + new Date(session.startTime).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WegLog" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xmlEsc(titel)}</name>
    <time>${new Date(session.startTime).toISOString()}</time>
  </metadata>
${wpts}${wpts ? '\n' : ''}  <trk>
    <name>${xmlEsc(titel)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/* ---------- CSV ---------- */

export const CSV_KOPF = ['Zeit', 'Typ', 'Ort', 'Breite', 'Laenge', 'km/h', 'Genauigkeit_m'];

export function alsCsv(session){
  const zeilen = [CSV_KOPF.join(';')];
  for (const p of session.points || []){
    zeilen.push([
      csvFeld(new Date(p.t).toISOString()),
      csvFeld(typeLabel(p.type)),
      csvFeld(p.place || ''),
      zahl(p.lat, 6),
      zahl(p.lon, 6),
      zahl(p.speedKmh, 1),
      zahl(p.acc, 0),
    ].join(';'));
  }
  return zeilen.join('\r\n') + '\r\n';
}

/* ---------- Vollsicherung ---------- */

export function alsSicherung(aufzeichnungen, laufende){
  const alle = laufende ? [laufende, ...aufzeichnungen] : aufzeichnungen;
  return JSON.stringify({
    app: 'WegLog',
    format: SICHERUNG_FORMAT,
    exportiert: new Date().toISOString(),
    aufzeichnungen: alle.map(bereinige),
  }, null, 1);
}

/* Laufzeitzustand und unbekannte Felder gehoeren nicht in die Sicherung. */
function bereinige(s){
  return {
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime ?? null,
    distanceKm: typeof s.distanceKm === 'number' ? s.distanceKm : sessionDistanceKm(s.points || []),
    points: (s.points || []).map(p => ({
      t: p.t, lat: p.lat, lon: p.lon, acc: p.acc,
      speedKmh: p.speedKmh, type: p.type, place: p.place ?? null,
    })),
  };
}

/* Wirft mit einer Meldung, die dem Nutzer angezeigt werden kann. */
export function leseSicherung(text){
  let daten;
  try { daten = JSON.parse(text); }
  catch { throw new Error('Die Datei ist kein gültiges JSON.'); }
  if (!daten || typeof daten !== 'object' || !Array.isArray(daten.aufzeichnungen)){
    throw new Error('Das ist keine WegLog-Sicherung (Feld „aufzeichnungen" fehlt).');
  }
  const geprueft = daten.aufzeichnungen.filter(istAufzeichnung).map(bereinige);
  if (geprueft.length === 0) throw new Error('Die Sicherung enthält keine brauchbare Aufzeichnung.');
  return geprueft;
}

export function istAufzeichnung(s){
  return !!s && typeof s === 'object'
    && (typeof s.id === 'number' || typeof s.id === 'string')
    && typeof s.startTime === 'number'
    && Array.isArray(s.points)
    && s.points.every(p => p && typeof p.t === 'number'
      && typeof p.lat === 'number' && typeof p.lon === 'number');
}

/* Zusammenfuehren statt ersetzen: eine Sicherung einzulesen darf nichts
   loeschen, was auf dem Geraet schon liegt. Gleiche id gewinnt der Bestand. */
export function vereine(vorhanden, neue){
  const bekannt = new Set(vorhanden.map(s => String(s.id)));
  const ergaenzt = neue.filter(s => !bekannt.has(String(s.id)));
  return [...vorhanden, ...ergaenzt].sort((a, b) => b.startTime - a.startTime);
}
