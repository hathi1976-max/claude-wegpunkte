/* B1: Fremdtext darf nirgends als HTML interpretiert werden.

   Diese Tests brauchen ein DOM – deshalb laufen sie im Browser und nicht
   gegen eine nachgebaute Umgebung. Geprueft werden ausschliesslich die
   Bau-Funktionen aus ui.js, die ihr Element zurueckgeben; nichts davon
   greift auf die Oberflaeche der App zu. */

import { gruppe, test, gleich, wahr } from './lauf.js';
import { el, ortText, pointItemEl, sessionItemEl, metaZeile, popupInhalt } from '../js/ui.js';

/* Ein Ortsname, wie ihn OpenStreetMap grundsaetzlich enthalten koennte.
   Der Bildpfad ist absichtlich ungueltig: waere der Name jemals HTML,
   liefe onerror los. */
const BOESER_ORT = '<img src=x onerror="window.__B1=1">Bad <b>Fett</b> &amp; Co';

function punkt(extra = {}){
  return { t: 1700000000000, lat: 52.5, lon: 13.4, acc: 12, speedKmh: 5.4,
    type: 'log', place: null, ...extra };
}

function markup(element){ return element.innerHTML; }

gruppe('B1: Wegpunkt-Eintrag', () => {
  test('ein Ortsname mit Markup bleibt Text', () => {
    delete window.__B1;
    const e = pointItemEl(punkt({ place: BOESER_ORT }), { useGeocode: true });
    document.body.appendChild(e);       // erst im Dokument liefe onerror ueberhaupt
    try {
      gleich(e.querySelector('.sub').textContent, BOESER_ORT);
      gleich(e.querySelectorAll('img').length, 0, 'Bild-Element aus dem Ortsnamen entstanden');
      gleich(e.querySelectorAll('b').length, 0, 'Fett-Element aus dem Ortsnamen entstanden');
      gleich(window.__B1, undefined, 'Skript aus dem Ortsnamen ausgefuehrt');
      wahr(markup(e).includes('&lt;img'), 'Markup nicht als Text abgelegt');
    } finally { e.remove(); }
  });

  test('das kaufmaennische Und bleibt ein einzelnes Zeichen', () => {
    // Waere der Name HTML, wuerde aus &amp; ein & – der Name waere verfaelscht
    const e = pointItemEl(punkt({ place: 'Foo &amp; Bar' }), { useGeocode: true });
    gleich(e.querySelector('.sub').textContent, 'Foo &amp; Bar');
  });

  test('Symbol, Bezeichnung und Tempo stehen an ihren Plaetzen', () => {
    const e = pointItemEl(punkt({ place: 'Berlin', type: 'pause' }), { useGeocode: true });
    gleich(e.className, 'item pause');
    gleich(e.querySelector('.ico').textContent, '⏸️');
    wahr(e.querySelector('.name').textContent.startsWith('Pause · '), 'Bezeichnung fehlt');
    gleich(e.querySelector('.dist').textContent, '5.4 km/h');
  });

  test('Luecken bekommen eigenes Symbol und eigene Klasse', () => {
    const e = pointItemEl(punkt({ type: 'luecke' }), { useGeocode: false });
    gleich(e.className, 'item luecke');
    gleich(e.querySelector('.ico').textContent, '⚠️');
    wahr(e.querySelector('.name').textContent.startsWith('Lücke · '), 'Bezeichnung fehlt');
  });
});

gruppe('B1: ortText', () => {
  test('vorhandener Ort gewinnt', () => {
    gleich(ortText(punkt({ place: 'Berlin' }), { useGeocode: false }), 'Berlin');
  });

  test('ohne Ort und mit Nachschlagen: Platzhalter', () => {
    gleich(ortText(punkt(), { useGeocode: true }), 'Ort wird ermittelt …');
  });

  test('ohne Ort und ohne Nachschlagen: Koordinaten', () => {
    gleich(ortText(punkt(), { useGeocode: false }), '52.5000, 13.4000');
  });
});

gruppe('B1: Sheet und Karten-Popup', () => {
  test('metaZeile legt den Wert als Text ab', () => {
    const zeile = metaZeile('Ort', BOESER_ORT);
    gleich(zeile.querySelectorAll('img').length, 0);
    gleich(zeile.children[0].textContent, 'Ort');
    gleich(zeile.children[1].textContent, BOESER_ORT);
  });

  test('das Karten-Popup ist ein Element, kein HTML-Text', () => {
    const box = popupInhalt(punkt({ place: BOESER_ORT, type: 'start' }));
    wahr(box instanceof HTMLElement, 'popupInhalt liefert kein Element');
    gleich(box.querySelectorAll('img').length, 0);
    wahr(box.textContent.includes(BOESER_ORT), 'Ortsname fehlt im Popup');
    wahr(box.textContent.includes('5.4 km/h'), 'Tempo fehlt im Popup');
    // Die Beschriftung darf weiterhin fett sein – die kommt nicht von aussen
    gleich(box.querySelector('b').textContent, 'Start');
  });

  test('ohne Ortsname bleibt das Popup ohne Trennzeichen', () => {
    const box = popupInhalt(punkt({ place: null }));
    gleich(box.textContent.includes(' · '), false);
  });
});

gruppe('B1: Verlaufs-Eintrag', () => {
  test('Dauer, Strecke und Anzahl stehen im Untertitel', () => {
    const e = sessionItemEl({
      id: 1, startTime: 0, endTime: 90 * 60000, distanceKm: 12.34,
      points: [punkt(), punkt()],
    });
    gleich(e.querySelector('.sub').textContent, '1 Std 30 Min · 12,3 km · 2 Wegpunkte');
  });
});

gruppe('B1: el-Helfer', () => {
  test('setzt Klasse und Text, niemals Markup', () => {
    const e = el('span', 'k', '<b>x</b>');
    gleich(e.className, 'k');
    gleich(e.textContent, '<b>x</b>');
    gleich(e.querySelectorAll('b').length, 0);
  });

  test('ohne Text bleibt das Element leer', () => {
    gleich(el('div').textContent, '');
    gleich(el('div', 'a').className, 'a');
  });
});
