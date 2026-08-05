/* Prueft die Auslieferung selbst: Versionsnummer, Vollstaendigkeit der
   App-Shell und die Leaflet-Verweise. Alles gleiche Herkunft, kein fremder
   Dienst wird angefasst. */

import { gruppe, test, gleich, wahr } from './lauf.js';

async function hole(pfad){
  const r = await fetch(new URL(pfad, location.href), { cache: 'no-store' });
  if (!r.ok) throw new Error(pfad + ': HTTP ' + r.status);
  return r.text();
}

function feldInhalt(quelltext, name){
  const block = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];').exec(quelltext);
  if (!block) throw new Error('Feld ' + name + ' nicht gefunden');
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

gruppe('Auslieferung: Version', () => {
  test('Cache-Name und Versionsanzeige stimmen ueberein', async () => {
    const sw = await hole('../sw.js');
    const html = await hole('../index.html');
    const version = /const VERSION = '([^']+)'/.exec(sw);
    wahr(version, 'VERSION in sw.js nicht gefunden');
    wahr(/const CACHE = 'weglog-' \+ VERSION/.test(sw),
      'CACHE wird nicht aus VERSION gebildet');
    const angezeigt = /<p class="ver">Version ([^<]+)<\/p>/.exec(html);
    wahr(angezeigt, 'Versionsanzeige in index.html nicht gefunden');
    gleich(angezeigt[1], version[1],
      'index.html zeigt eine andere Version an als sw.js cacht');
  });
});

gruppe('Auslieferung: App-Shell', () => {
  test('jede Datei aus SHELL ist wirklich abrufbar', async () => {
    const shell = feldInhalt(await hole('../sw.js'), 'SHELL');
    wahr(shell.length > 5, 'SHELL wirkt zu kurz: ' + shell.length);
    for (const eintrag of shell){
      const r = await fetch(new URL('../' + eintrag.replace(/^\.\//, ''), location.href));
      gleich(r.ok, true, 'nicht abrufbar: ' + eintrag);
    }
  });

  test('jedes Modul, das app.js zieht, steht in SHELL', async () => {
    // Die Module liegen flach in js/ und importieren einander mit './name.js'
    const shell = new Set(feldInhalt(await hole('../sw.js'), 'SHELL'));
    const gesehen = new Set();
    const offen = ['js/app.js'];
    while (offen.length){
      const datei = offen.shift();
      if (gesehen.has(datei)) continue;
      gesehen.add(datei);
      const quelle = await hole('../' + datei);
      for (const m of quelle.matchAll(/from\s+'\.\/([\w.-]+\.js)'/g)) offen.push('js/' + m[1]);
    }
    wahr(gesehen.size >= 7, 'nur ' + gesehen.size + ' Module gefunden');
    for (const datei of gesehen){
      wahr(shell.has('./' + datei), 'fehlt in SHELL, damit offline kaputt: ' + datei);
    }
  });
});

gruppe('Auslieferung: Leaflet', () => {
  test('sw.js cacht genau die Leaflet-Dateien, die index.html laedt', async () => {
    const sw = await hole('../sw.js');
    const html = await hole('../index.html');
    const vendor = feldInhalt(sw, 'VENDOR_URLS').sort();
    const imHtml = [...html.matchAll(/https:\/\/unpkg\.com[^"']+/g)].map(m => m[0]).sort();
    gleich(imHtml.length, 2, 'erwartet werden leaflet.css und leaflet.js');
    gleich(vendor.join('|'), imHtml.join('|'),
      'sw.js und index.html verweisen auf unterschiedliche Leaflet-Dateien');
  });

  test('die Leaflet-Verweise sind auf eine feste Version gepinnt', async () => {
    const html = await hole('../index.html');
    for (const m of html.matchAll(/https:\/\/unpkg\.com\/leaflet@([\d.]+)\//g)){
      wahr(/^\d+\.\d+\.\d+$/.test(m[1]), 'keine feste Version: ' + m[1]);
    }
  });

  test('crossorigin ist gesetzt, sonst kann der Cache nichts pruefen', async () => {
    const html = await hole('../index.html');
    const zeilen = html.split('\n').filter(z => z.includes('unpkg.com'));
    gleich(zeilen.length, 2);
    for (const z of zeilen) wahr(z.includes('crossorigin'), 'ohne crossorigin: ' + z.trim());
  });
});
