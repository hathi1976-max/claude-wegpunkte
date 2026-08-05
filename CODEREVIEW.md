# Code-Review: claude-wegpunkte (WegLog)

Stand: 04.08.2026 · Umfang: `app.js` 582 Zeilen, `index.html`, `style.css`, `sw.js`
· Git: ein einziger Commit (Erstveröffentlichung)

Das jüngste Projekt der Sammlung und in der Grundidee sauber umgesetzt: die
geschwindigkeitsabhängigen Aufzeichnungsintervalle mit Hysterese gegen
Pausen-Flackern (`resumeSpeedThreshold` gegen `pauseSpeedThreshold`, `:185-200`)
und der Jitter-Filter über die GPS-Genauigkeit (`:94-95`) sind durchdacht.

Es gibt allerdings zwei strukturelle Probleme, die den Kernzweck betreffen —
Aufzeichnen unterwegs, offline und über längere Zeit.

---

## A. Kritisch

### A1. Die Karte funktioniert offline nicht — obwohl das der Anwendungsfall ist — ✅ erledigt 05.08.2026

> **Behoben, Punkt 1 aber anders gelöst als vorgeschlagen.**
>
> Der Service Worker hat jetzt **drei Caches mit drei Strategien**: `CACHE`
> (eigene Dateien, Netz zuerst), `VENDOR` (Leaflet, Cache zuerst) und
> `KACHELN` (OSM-Kacheln, Cache zuerst mit Deckel). Die Zeile, die
> `unpkg.com` und `tile.` **ausdrücklich vom Cache ausschloss**, ist weg;
> übrig bleibt Nominatim, das zu Recht nie gecacht wird.
>
> - **Punkt 2 (defensives `renderMap`) umgesetzt:** Ist `L` nicht definiert,
>   wird der Kartenbereich ausgeblendet und ein Hinweis gezeigt, statt einen
>   `ReferenceError` zu werfen, der `setActiveTab` abbricht. Der Hinweis geht
>   über `textContent`, nicht `innerHTML` (siehe B1).
> - **Punkt 3 (Kachelfehler) umgesetzt,** mit dem wichtigen zweiten Halbsatz:
>   „Der aufgezeichnete Weg bleibt trotzdem gespeichert." Aufgehoben wird der
>   Hinweis am Leaflet-Ereignis `load` (alle sichtbaren Kacheln da), nicht an
>   `tileload` je Kachel — sonst blinkt er bei halb geladener Karte weg.
> - **Punkt 4 (Kachelcache) umgesetzt,** Deckel 600 Kacheln (grob 10–25 MB).
>   Der Kachel-Layer bekommt `crossOrigin: true`, sonst sind die Antworten
>   undurchsichtig, der Service Worker kann nicht erkennen, ob eine Kachel
>   wirklich ankam, und der Browser rechnet sie mit einem Aufschlag gegen das
>   Speicherkontingent.
>
> **Abweichung 1 — Leaflet bleibt beim CDN, wird aber mitinstalliert.**
> Die Vorlage wollte Leaflet als Datei ins Projekt legen. Dafür müsste diese
> Fassung eine fremde Datei aus dem Netz laden und ins Repository schreiben —
> das ist hier nicht passiert. Stattdessen holt der Service Worker die beiden
> gepinnten Leaflet-URLs beim **Install** in den `VENDOR`-Cache und liefert
> sie danach Cache-zuerst aus. Für den Nutzer ist das Ergebnis dasselbe: nach
> dem ersten Aufruf mit Internet ist die Karte offline vollständig. Der
> Unterschied bleibt, dass die allererste Installation online geschehen muss
> und die Abhängigkeit von unpkg formal bestehen bleibt. Wer sie loswerden
> will, legt die beiden Dateien nach `vendor/`, ändert die zwei Verweise in
> `index.html` und verschiebt sie aus `VENDOR_URLS` in `SHELL` —
> `tests/version.test.js` merkt sofort, wenn dabei etwas auseinanderläuft.
>
> **Abweichung 2 — FIFO statt LRU beim Kachelcache.** Echtes LRU hieße, jede
> getroffene Kachel neu zu schreiben oder einen Index nebenherzuführen. Die
> Cache-API liefert `keys()` ohnehin in Einfügereihenfolge, und für den Zweck
> — dieselbe Strecke mehrfach fahren — verwerfen FIFO und LRU praktisch
> dieselben Kacheln. Aufgeräumt wird nur alle 25 Kacheln, weil jede Prüfung
> ein `keys()` über den ganzen Cache kostet.
>
> **Geprüft:** 6 neue Tests in `tests/version.test.js`, die die Auslieferung
> selbst lesen. Der wichtigste läuft die Import-Kette ab `js/app.js` ab und
> verlangt, dass **jedes** erreichte Modul in `SHELL` steht — genau der
> Fehler, der die App offline zerlegt. Er findet aktuell 8 Module, alle in
> `SHELL`. Dazu: jeder `SHELL`-Eintrag ist abrufbar, `sw.js` und
> `index.html` verweisen auf **dieselben** zwei Leaflet-Dateien, die
> Versionen sind gepinnt, und `crossorigin` ist gesetzt.

**Wo:** `index.html:12` und `:119` laden Leaflet von `unpkg.com`; `sw.js:33`
schließt `unpkg.com` und `tile.` **ausdrücklich vom Cache aus**.

Eine Wanderung im Funkloch ist genau die Situation, für die diese App gebaut ist.
Dort passiert Folgendes: Leaflet lädt nicht, `L` ist undefiniert, und der erste
Klick auf den Reiter "Karte" wirft `ReferenceError: L is not defined` in
`renderMap` (`:465`). Die Ausnahme bricht `setActiveTab` (`:497`) ab — die
Ansicht wechselt zwar per CSS, aber nachfolgende Aufrufe schlagen weiter fehl.
Es gibt keine Fehlerbehandlung und keinen Hinweis für den Nutzer.

**Anweisung:**
1. Leaflet **lokal ablegen** (`vendor/leaflet.js`, `vendor/leaflet.css`, dazu die
   Marker-Bilder) und in `SHELL` in `sw.js:6-14` aufnehmen. Das sind ~150 kB —
   für eine PWA völlig vertretbar und beseitigt zugleich die Abhängigkeit von
   einem fremden CDN.
2. `renderMap` defensiv machen:
   ```js
   if (typeof L === 'undefined') {
     $('#mapContainer').innerHTML =
       '<p class="muted">Kartenbibliothek nicht geladen – bitte online neu laden.</p>';
     return;
   }
   ```
3. Kachel-Fehler abfangen und dem Nutzer sagen, was Sache ist:
   ```js
   tiles.on('tileerror', () => setMapHint('Offline – Kartenkacheln fehlen. '
     + 'Der aufgezeichnete Weg bleibt trotzdem gespeichert.'));
   ```
   Wichtig ist die zweite Hälfte des Satzes: Die Aufzeichnung läuft ja weiter,
   nur die Hintergrundkarte fehlt. Ohne Hinweis wirkt es, als sei alles kaputt.
4. Optional, aber für den Anwendungsfall stark: die zuletzt betrachteten Kacheln
   in einem separaten, größenbegrenzten Cache halten (Cache-First mit LRU, Deckel
   ~50 MB). Dann ist die Karte auf bekannten Strecken auch offline da.

### A2. Kein Schutz gegen volles localStorage — ✅ erledigt 05.08.2026

> **Behoben.** Jeder Schreibvorgang geht durch `persist(key, wert)` in
> `js/storage.js`: `QuotaExceededError` wird gefangen (inklusive der
> Firefox-Schreibweise `NS_ERROR_DOM_QUOTA_REACHED` und der Codes 22/1014),
> der Aufrufer bekommt `false`, und der Nutzer sieht ein rotes Banner, das
> **stehen bleibt**, bis er es loswird. Damit `storage.js` DOM-frei bleibt
> (sonst wären die Tests darauf angewiesen), geht die Meldung über einen
> Rückruf, den `app.js` auf `ui.zeigeBanner` setzt.
>
> - **Der gefährlichste Fall zuerst:** Schlägt beim Stoppen `saveHistory`
>   fehl, wird `weglog.active` **nicht** gelöscht. Die Aufzeichnung überlebt
>   damit einen Neustart, statt zwischen zwei Schlüsseln zu verschwinden, und
>   das Banner fordert zum sofortigen Sichern auf (A3 macht das möglich).
> - **Ortscache gedeckelt** auf 2 000 Einträge. Dafür hat jeder Eintrag jetzt
>   einen Zeitstempel (`{ort, t}`); alte Einträge, die nur den Namen als
>   Zeichenkette hielten, werden beim Laden umgesetzt und gelten als die
>   ältesten. `deckleGeocache` verwirft von hinten, also die ältesten zuerst.
> - **Einstellungen** zeigen einen Balken mit der Belegung (Zeichen, nicht
>   Bytes — `localStorage` rechnet in UTF-16-Einheiten), die Zahl der
>   Aufzeichnungen und Wegpunkte, und einen Knopf „Älter als 90 Tage
>   löschen" mit Rückfrage und Hinweis aufs Sichern.
>
> **Geprüft:** 25 Tests in `tests/storage.test.js`, davon 5 zum vollen
> Speicher. Die Attrappe kennt jetzt eine Größengrenze und wirft dieselbe
> Ausnahme wie ein echter Browser. Nachgewiesen: `persist` wirft nicht,
> sondern liefert `false`; die Meldung enthält „Speicher voll"; **der zuvor
> gespeicherte Stand bleibt unverändert erhalten**, wenn das Schreiben
> scheitert (ein halb geschriebener Verlauf wäre schlimmer als gar keiner).

**Wo:** `saveHistory` (`:61`), `saveActive` (`:52-55`), `saveGeocache` (`:67`)

Jeder Wegpunkt ist ein Objekt mit acht Feldern (~120 Byte JSON). Eine Autofahrt
mit 1-Minuten-Intervall erzeugt 60 Punkte pro Stunde; der Verlauf wird **nie**
beschnitten. localStorage liegt je nach Browser bei 5–10 MB. Beim Überschreiten
wirft `setItem` eine `QuotaExceededError` — ungefangen. Die Folge:
`logWaypoint` (`:167-171`) bricht mitten drin ab, `renderLive` läuft nicht mehr,
und beim Stoppen geht `history_.unshift(active)` (`:250`) verloren. Die gesamte
Aufzeichnung ist weg, ohne jede Meldung.

**Anweisung:**
1. Alle vier Speicherfunktionen kapseln:
   ```js
   function persist(key, wert){
     try { localStorage.setItem(key, JSON.stringify(wert)); return true; }
     catch (e) {
       if (e.name === 'QuotaExceededError' || e.code === 22) {
         zeigeBanner('Speicher voll – bitte alte Aufzeichnungen löschen oder exportieren.');
       }
       console.error('Speichern fehlgeschlagen', key, e);
       return false;
     }
   }
   ```
2. `geocache` (`:63-67`) deckeln — er wächst über alle Fahrten hinweg unbegrenzt.
   Bei > 2.000 Einträgen die ältesten verwerfen (dafür einen Zeitstempel je
   Eintrag mitspeichern).
3. Im Einstellungs-Reiter die belegte Größe anzeigen
   (`JSON.stringify(history_).length`) und einen Knopf "Aufzeichnungen älter als
   90 Tage löschen" anbieten.
4. **Zusammen mit A3 zu sehen:** Solange es keinen Export gibt, ist "Speicher
   voll" gleichbedeutend mit Datenverlust.

### A3. Kein Export — ✅ erledigt 05.08.2026

> **Behoben.** Neues Modul `js/export.js`, ohne fremde Bibliothek und ohne DOM
> (es liefert nur Text zurück, das Herunterladen macht `ui.starteDownload`
> über einen kurzlebigen Blob-Link).
>
> - **GPX** und **CSV** je Aufzeichnung, als zwei zusätzliche Knöpfe im
>   Detail-Sheet. Das GPX hat die Spur als `<trk>` und die markanten Punkte
>   (Start, Pause, Weiter, Ende) zusätzlich als `<wpt>` mit Namen — so bleiben
>   sie in Komoot/OsmAnd sichtbar, ohne die Spur zu zerreißen.
> - **Vollsicherung als JSON** und **Wiedereinlesen** in den Einstellungen.
>   Eingelesen wird **ergänzend**: gleiche `id` gewinnt der Bestand, nichts
>   wird überschrieben oder gelöscht. Die gerade laufende Aufzeichnung wird
>   beim Einlesen ausgefiltert, damit sie nicht als abgeschlossene Kopie im
>   Verlauf landet.
>
> **Über die Vorlage hinaus**, weil Exporte Fremdtext transportieren:
> Ortsnamen kommen von Nominatim (siehe B1) und werden im GPX über `xmlEsc`
> entschärft (fünf XML-Sonderzeichen plus die in XML verbotenen
> Steuerzeichen); im CSV werden sie quotiert und ein führendes `= + - @`
> bekommt einen Apostroph vorangestellt, damit die Tabellenkalkulation den
> Namen nicht als Formel ausführt. Das CSV ist bewusst deutsch (Semikolon als
> Trenner, Komma als Dezimalzeichen, UTF-8-BOM) — die maschinenlesbare
> Fassung ist GPX.
>
> **Geprüft:** 27 Tests in `tests/export.test.js`, darunter ein Durchlauf
> durch `DOMParser`, der bestätigt, dass das erzeugte GPX auch mit einem
> Ortsnamen wie `<img src=x onerror="alert(1)">Böse; Stadt "A"`
> wohlgeformtes XML bleibt und der Name als **Text** ankommt (0 `<img>`-
> Elemente im Ergebnis), sowie ein kleiner CSV-Leser im Test, der die
> Quotierung nachweist (7 Felder trotz Semikolon im Ortsnamen).

Der gesamte Zweck der App ist das Festhalten von Wegen — es gibt aber keine
Möglichkeit, sie aus dem Browser herauszubekommen. Ein Wechsel des Geräts, ein
gelöschter Browser-Speicher oder A2 bedeuten Totalverlust.

**Anweisung:** Im Detail-Sheet einer Aufzeichnung (`openSessionSheet`, `:400-412`)
zwei Knöpfe ergänzen:
- **GPX** — Standardformat, direkt in Komoot/Garmin/OsmAnd importierbar:
  ```js
  function alsGpx(session){
    const pts = session.points.map(p =>
      `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.t).toISOString()}</time></trkpt>`
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
  <gpx version="1.1" creator="WegLog"><trk><name>${fmtDateTime(session.startTime)}</name>
  <trkseg>${pts}</trkseg></trk></gpx>`;
  }
  ```
- **CSV** — für die Auswertung in einer Tabelle: Zeit, Typ, Ort, Lat, Lon,
  km/h, Genauigkeit.

Download über einen Blob-Link:
```js
const url = URL.createObjectURL(new Blob([inhalt], {type:'application/gpx+xml'}));
const a = Object.assign(document.createElement('a'), {href:url, download:name});
a.click(); URL.revokeObjectURL(url);
```
Zusätzlich einen "Alles exportieren"-Knopf in den Einstellungen (JSON-Sicherung
des gesamten Verlaufs) samt Gegenstück zum Wiedereinlesen.

---

## B. Korrektheit

### B1. Externe Ortsnamen landen ungefiltert im HTML — ✅ erledigt 05.08.2026

> **Behoben — über `textContent`, nicht über eine eigene `esc()`-Funktion.**
> Der Review nannte beides und hielt `textContent` für den besseren Weg; das
> ist es auch: eine selbstgebaute Escape-Funktion muss man richtig schreiben
> *und* an jeder Stelle anwenden, `textContent` kann man dagegen nicht falsch
> anwenden. In `js/ui.js` gibt es jetzt **kein einziges `innerHTML` mehr**
> (Gegenprobe: `grep innerHTML js/` findet nur noch zwei Kommentare).
>
> Ersetzt wurden: `pointItemEl`, `sessionItemEl`, `renderHistory`,
> `openPointSheet`/`openSessionSheet` (über `setzeMeta`/`metaZeile`),
> `fillMapSessionOptions` und das Karten-Popup. Letzteres war der unangenehmste
> Fall — `bindPopup` bekam eine HTML-Zeichenkette. Leaflet nimmt aber auch ein
> `HTMLElement`, also baut `popupInhalt(p)` jetzt eines.
>
> Neue Bausteine: `el(tag, klasse, text)` (setzt immer `textContent`),
> `ortText(p, settings)`, `metaZeile`, `popupInhalt`. `pointItemEl` bekommt
> die Einstellungen als Parameter statt aus dem Modulzustand — dadurch lassen
> sich die Bau-Funktionen einzeln testen.
>
> **Geprüft:** 13 Tests in `tests/ui.test.js` mit dem Ortsnamen
> `<img src=x onerror="window.__B1=1">Bad <b>Fett</b> &amp;amp; Co`. Der
> Eintrag wird dafür wirklich ins Dokument gehängt — außerhalb des Dokuments
> liefe `onerror` gar nicht erst los, der Test wäre wertlos. Nachgewiesen:
> 0 `img`-Elemente, 0 `b`-Elemente, `window.__B1` bleibt `undefined`, der
> Text kommt **zeichengenau** wieder heraus (auch das `&amp;amp;` bleibt eine
> Zeichenfolge und wird nicht zu `&`) und im Markup steht `&lt;img`.

**Wo:** `pointItemEl` (`:347-354`), `openPointSheet` (`:389-394`),
`renderMap` → `bindPopup` (`:483`)

`p.place` stammt aus der Nominatim-Antwort (`:136`) und wird per
Template-String in `innerHTML` gesetzt. OSM-Ortsnamen sind von beliebigen
Personen editierbar; ein Name mit `<img onerror=…>` würde ausgeführt. Das Risiko
ist gering (die App hat keine Zugangsdaten zu stehlen), der Aufwand für die
Absicherung aber noch geringer.

**Anweisung:** Eine `esc()`-Funktion einführen — `claude-geo/app.js:431` hat
bereits eine, die übernommen werden kann — und auf alle Fremdwerte anwenden.
Besser noch: bei den Sheets `textContent` statt `innerHTML` verwenden, dann
erübrigt sich die Frage.

### B2. Geocode-Rückläufer nach Sitzungsende — ✅ erledigt 05.08.2026

> **Behoben** wie vorgeschlagen: `onPointUpdated` unterscheidet jetzt, wo der
> Punkt inzwischen liegt — läuft noch eine Aufzeichnung, wird `saveActive`
> geschrieben, sonst `saveHistory`. Damit überleben Ortsnamen, die nach dem
> Stopp eintreffen, das nächste Neuladen. Nebeneffekt: der ungewollte
> `removeItem`-Aufruf auf `weglog.active` bei `active === null` entfällt.
>
> **Nicht automatisch geprüft.** Der Rückläufer hängt an `app.js` und damit an
> DOM und Netz; ein Test dafür müsste beides nachbauen. Der Fall steht
> stattdessen als Klickpfad in der Prüfliste (Aufzeichnung starten, sofort
> stoppen, ~2 s warten, neu laden — der Ortsname muss noch da sein).

**Wo:** `pumpGeocodeQueue` (`:125-148`) → `onPointUpdated` (`:150-154`)

Die Warteschlange arbeitet mit ~1,1 s Abstand. Wird die Aufzeichnung gestoppt,
während noch Anfragen laufen, passiert zweierlei:
- `onPointUpdated` ruft `saveActive()`, das bei `active === null` den Schlüssel
  `weglog.active` **entfernt** (`:54`) — harmlos, aber unbeabsichtigt.
- Der Ortsname wird auf dem Punkt-Objekt gesetzt, das inzwischen in `history_`
  liegt; `saveHistory()` wird aber nicht aufgerufen. Der Name ist im Speicher da,
  nach dem nächsten Neuladen wieder weg.

**Anweisung:** In `onPointUpdated` unterscheiden:
```js
function onPointUpdated(){
  if (active) saveActive(); else saveHistory();
  renderLive();
  if (!$('#view-map').hidden) renderMap();
}
```

### B3. Wake Lock wird beim Wegschalten nicht zurückgeholt — ✅ erledigt 05.08.2026

> **Behoben** wie vorgeschlagen, mit drei Ergänzungen:
> - Geprüft wird `!wakeLockSentinel || wakeLockSentinel.released`. Nur auf
>   `null` zu prüfen reichte nicht: nach der Freigabe durch das Betriebssystem
>   ist die Referenz weiterhin da, nur eben `released`.
> - `wakeLockSentinel.addEventListener('release', …)` protokolliert mit
>   Zeitstempel, wann er verloren ging — sonst ist im Fehlerfall nicht
>   nachvollziehbar, warum der Bildschirm ausging.
> - Der Haken wirkt jetzt **sofort**, nicht erst beim nächsten Start: ein
>   `change`-Ereignis fordert den Lock an oder gibt ihn frei. Vorher wurde er
>   nur einmal beim Start gelesen.

**Wo:** `requestWakeLock` (`:280-283`)

Das Betriebssystem gibt einen Screen Wake Lock automatisch frei, sobald das
Dokument in den Hintergrund geht. Kommt der Nutzer zurück, ist er weg und wird nie
neu angefordert — der Bildschirm geht mitten in der Fahrt aus, obwohl der Haken
gesetzt ist.

**Anweisung:**
```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active && $('#wakeLock').checked) {
    requestWakeLock();
  }
});
```
Zusätzlich `wakeLockSentinel.addEventListener('release', …)` protokollieren, damit
im Fehlerfall nachvollziehbar ist, wann er verloren ging.

### B4. Nominatim ohne Kennung — Sperre droht — ✅ erledigt 05.08.2026

> **Behoben,** alle drei Teile.
>
> - **Kennung:** Die Einstellungen haben ein Feld „Kontakt-E-Mail für
>   Nominatim (freiwillig)". Ist es gefüllt, hängt `baueUrl` `&email=…`
>   (URL-kodiert) an — genau der Weg, den Nominatim für Browser-Anwendungen
>   vorsieht, da ein `User-Agent` nicht gesetzt werden kann. **Bewusst nicht
>   vorbelegt:** die Adresse gehört dem Nutzer, und eine erfundene Kennung
>   wäre schlimmer als gar keine. Leer bleibt der Parameter weg. Der Betrieb
>   unter einer echten Domain (dann trägt der `Referer`) steht im README.
> - **Drosselung:** unverändert eine Anfrage je 1,1 s, jetzt aber als
>   benannte Konstante `MIN_ABSTAND_MS` und über eine hineingereichte
>   Wartefunktion — dadurch testbar, ohne im Test Sekunden zu warten.
> - **Abfuhr:** 429 **und** 403 (den schickt Nominatim bei dauerhaft
>   auffälligen Anwendungen) legen die Warteschlange für 60 s still, und der
>   Punkt wandert an den Anfang zurück statt verlorenzugehen.
>
> **Zusätzlich:** Bei einer Antwort ohne verwertbaren Namen wird `(unbekannt)`
> zwar angezeigt, aber **nicht mehr in den Cache geschrieben**. Vorher hätte
> ein einzelner Serverfehler `(unbekannt)` für dieses 110-m-Rasterfeld
> dauerhaft festgeschrieben.
>
> **Geprüft:** 15 Tests in `tests/geocode.test.js` — mit hineingereichtem
> `fetchFn`, hineingereichter Uhr und Wartefunktion, **ohne eine einzige
> echte Anfrage** an Nominatim. Nachgewiesen unter anderem: zwei Punkte
> ergeben nach 1 099 ms erst eine Anfrage und nach 1 100 ms zwei; nach einer
> 429 bleibt der Ortsname leer, der Punkt liegt weiter in der Warteschlange,
> und 59 s später ist noch immer nicht nachgelegt worden — nach Ablauf der
> Sperre kommt genau derselbe Punkt erneut dran und bekommt seinen Namen.

**Wo:** `pumpGeocodeQueue` (`:129-130`)

Die Nutzungsbedingungen von Nominatim verlangen eine identifizierende
Anwendungskennung und maximal eine Anfrage pro Sekunde. Die Drosselung ist
korrekt umgesetzt (`:146`), die Kennung fehlt. Browser lassen `User-Agent` nicht
setzen — der übliche Weg ist ein `Referer` (kommt automatisch, sofern die App
unter einer echten Domain läuft) plus ein Kontaktparameter.

**Anweisung:** URL um `&email=…` ergänzen (von Nominatim ausdrücklich vorgesehen)
oder — sauberer — im README festhalten, unter welcher Domain die App läuft, und
den Betrieb auf `photon.komoot.io` als Ausweichquelle vorbereiten. Zusätzlich
HTTP 429 abfangen und die Warteschlange dann pausieren statt weiterzupumpen:

```js
.then(r => {
  if (r.status === 429) { geocodeQueue.unshift({point, key}); pauseBis = Date.now()+60000; return null; }
  return r.ok ? r.json() : null;
})
```

### B5. Hintergrund-Aufzeichnung ist technisch nicht garantiert — ✅ erledigt 05.08.2026

> **Behoben,** beide Teile.
>
> **Erwartung klargestellt:** Der Hinweis steht wörtlich unter dem
> Start-Knopf (einmal wegklickbar, die Entscheidung wird in den Einstellungen
> gemerkt) und im README. Der Kommentar im Kopf von `app.js`, der „Läuft bis
> zum aktiven Stopp weiter" versprach, ist beim Modul-Umbau entfallen.
>
> **Lücken sichtbar gemacht:** Kommt die App aus dem Hintergrund zurück, wird
> die nächste Position gegen `istLuecke()` geprüft. Schwelle ist das
> Dreifache des größten eingestellten Intervalls, mindestens zehn Minuten —
> mit den Vorgaben also 15 Minuten. Liegt eine Lücke vor, fällt ein Wegpunkt
> vom neuen Typ `luecke` (⚠️, violett auf der Karte, violetter Balken in der
> Liste). Danach werden `lastLogTime` auf jetzt und `pauseSince` auf `null`
> gesetzt: die Lücke **ist** der Wegpunkt dieses Moments, und was während der
> Drosselung geschah, weiß niemand — eine Pause zu behaupten wäre erfunden.
>
> **Geprüft:** 6 Tests zu `istLuecke` und `lueckenSchwelleMs`, darunter der
> Grat (genau an der Schwelle ist es eine Lücke, eine Millisekunde davor
> nicht) und der Fall `letzteZeit === 0` — die 0 ist falsy, darf aber nicht
> wie „keine Position vorhanden" behandelt werden.

**Wo:** konzeptionell — `attachWatcher` (`:270-275`), Anspruch in
`app.js:2-4` ("Läuft bis zum aktiven Stopp weiter")

Mobile Browser drosseln oder stoppen `watchPosition`, sobald der Tab im
Hintergrund liegt oder der Bildschirm aus ist. Der Wake Lock mildert das nur,
solange die App im Vordergrund bleibt. Der Kommentar im Kopf der Datei verspricht
mehr, als eine Web-App halten kann.

**Anweisung:** Kein Codefehler, sondern eine Erwartungsfrage — im README und
einmalig in der App (Hinweis unter dem Start-Knopf) klarstellen:
> Die Aufzeichnung läuft zuverlässig, solange WegLog im Vordergrund und der
> Bildschirm an ist. Beim Wegschalten kann das Betriebssystem die
> Standortabfrage drosseln; einzelne Wegpunkte können dann fehlen.

Und: nach dem Wiedereinblenden prüfen, ob eine große Zeitlücke entstanden ist,
und diese als eigenen Punkttyp (`luecke`) protokollieren — dann ist im Verlauf
sichtbar, wo Daten fehlen, statt eine gerade Linie durch die Landschaft zu ziehen.

---

## C. Struktur

### C1. Kein Modul, keine Tests — ✅ erledigt 05.08.2026

> **Behoben.** Aus einer Datei mit 582 Zeilen sind sieben Module geworden:
> `js/geo.js` (Geometrie, Geschwindigkeit, Schwellen), `js/format.js`
> (Anzeigetexte), `js/storage.js` (localStorage, Speicher injizierbar),
> `js/tracking.js` (Zustandsmaschine, rein), `js/geocode.js` (Nominatim),
> `js/ui.js` (DOM) und `js/app.js` (Verdrahtung). `index.html` lädt
> `<script type="module" src="js/app.js">`, alle sieben Dateien stehen in
> `SHELL` in `sw.js` — die App bleibt offline vollständig.
>
> Aus null Tests sind **45** geworden (Stand dieses Schritts), in `tests/` mit
> eigenem, abhängigkeitsfreiem Läufer (`tests/lauf.js`), aufrufbar über
> `tests/test.html` im Browser — auf diesem Rechner gibt es weder node noch
> npm. Abgedeckt: `haversine`, `sessionDistanceKm`, `computeSpeedKmh` samt
> Jitter-Fall, `intervalMsForSpeed` an den Schwellen 7 und 25 km/h,
> `fmtDuration` bei 59/60/61 Minuten, die Pausenerkennung an konstruierten
> Spuren und der Speicher gegen eine Attrappe (nie gegen echtes
> `localStorage` — die Tests dürfen aufgezeichnete Wege nicht anfassen).
>
> **Verhaltensgleichheit belegt.** `tests/referenz-alt.js` ist eine wörtliche
> Transkription der alten Tracking-Logik (Commit `1bf66e7`, `app.js:70-212`);
> ein Differenztest fährt 20 Zufallsspuren à 300 Positionen plus zwei
> abweichende Einstellungssätze durch beide Fassungen und vergleicht
> Wegpunkte, Geschwindigkeiten und Endzustand Zug für Zug. Eine Gegenprobe
> stellt sicher, dass die Spuren überhaupt alle drei Punktsorten (`log`,
> `pause`, `resume`) erzeugen — sonst verglichen zwei leere Listen. Die
> Referenzdatei bleibt vorerst liegen: der Nachweis ist erst mit dem
> Testlauf im Browser erbracht, und solange `schrittPosition` unverändert
> bleibt, kostet sie nichts. Die konstruierten Spuren sind zusätzlich mit
> einer unabhängigen Python-Nachrechnung gegengeprüft (Pausenpunkt bei exakt
> 180 000 ms, 6,67 km/h nach dem Weiter-Punkt, 66,7 km/h im Autofall,
> 1,67 km/h im Hysterese-Fall).

582 Zeilen im globalen Namensraum, Event-Listener auf oberster Ebene verstreut
(`:416`, `:426`, `:491`, `:500`, `:537-538`, `:560`).

**Anweisung:** Auf `<script type="module">` umstellen und aufteilen:
`storage.js`, `geo.js` (haversine, `computeSpeedKmh`, `intervalMsForSpeed`),
`tracking.js`, `geocode.js`, `ui.js`. Dann Tests für die reinen Funktionen —
`haversine`, `sessionDistanceKm`, `computeSpeedKmh` (inkl. Jitter-Fall),
`intervalMsForSpeed` an den Schwellen 7 und 25 km/h, `fmtDuration` bei 59/60/61
Minuten.

### C2. `history_` mit Unterstrich — ✅ erledigt 05.08.2026

> **Behoben.** `history_` heißt jetzt `aufzeichnungen`, `active` heißt
> `laufendeAufzeichnung`, `trackState` steckt als `zustand` in der Aufzeichnung
> (siehe C3). Der Unterstrich war tatsächlich nur die Kollision mit
> `window.history`; im Modul gibt es sie nicht mehr. Die Bedingung
> `if (!active || trackState === 'idle')` ist ganz entfallen — die
> Zustandsmaschine prüft `zst.zustand === 'idle'` selbst, und `app.js` fragt
> davor `if (!laufendeAufzeichnung)`.

**Wo:** `:27` und durchgehend

Der Unterstrich umgeht offenbar eine Kollision mit `window.history`. Nach der
Umstellung auf Module (C1) besteht die Kollision nicht mehr.

**Anweisung:** In `aufzeichnungen` umbenennen. Gleiches gilt für `active` →
`laufendeAufzeichnung`; die Bedingung `if (!active || trackState === 'idle')`
(`:180`) liest sich dann von selbst.

### C3. Doppelte Ableitung des Aufzeichnungszustands — ✅ erledigt 05.08.2026

> **Behoben.** Der Zustand (`zustand`, `lastRaw`, `pauseSince`, `lastLogTime`)
> hängt jetzt als `laufendeAufzeichnung.zustand` an der Aufzeichnung und wird
> mit ihr gespeichert. `initApp` rekonstruiert nichts mehr. Geschrieben wird
> nicht bei jeder GPS-Position, sondern nur, wenn ohnehin ein Wegpunkt fällt
> oder sich `zustand`/`pauseSince` ändert — sonst käme bei
> `enableHighAccuracy` alle paar Sekunden ein `localStorage`-Schreibvorgang
> zusammen.
>
> **Altbestand bleibt lesbar:** `zustandAusAufzeichnung()` nimmt einen
> gespeicherten Zustand, wenn er da ist, und fällt sonst auf die alte
> Rekonstruktion aus dem letzten Wegpunkt zurück. Sieben Tests halten beides
> fest, darunter der Fall „letzter Punkt ist `log`, gespeichert ist `paused`" —
> vorher ging die Pause beim Neuladen verloren, jetzt nicht mehr.
> Beim Stoppen wird `zustand` aus der Aufzeichnung entfernt, damit im Verlauf
> keine Laufzeitdaten liegen bleiben.

**Wo:** `initApp` (`:549-557`) rekonstruiert `trackState` aus dem letzten
Punkttyp; `handlePosition` (`:185-200`) pflegt ihn parallel fort; `updateLiveState`
(`:307-325`) liest beides.

Der Zustand steckt teils in `trackState`, teils in `active.points[last].type` —
zwei Wahrheiten, die auseinanderlaufen können.

**Anweisung:** `trackState` in `active` aufnehmen (`active.zustand`) und
mitpersistieren. Dann entfällt die Rekonstruktion, und ein Neuladen stellt exakt
den vorherigen Stand her.

---

## D. Kleinigkeiten

- `sw.js:5` — Cache heißt `weglog-v1`, `index.html:33` zeigt "Version v1". Wie in
  den Schwesterprojekten: eine Konstante, eine Checkliste im README. Bei einem
  Projekt mit genau einem Commit ist jetzt der beste Zeitpunkt, die Disziplin
  einzuführen.
- `sw.js:38-40` cached auch Antworten mit Fehlerstatus. `if (resp.ok)` vor dem
  `c.put` ergänzen.
- `stopTracking` (`:266`) fällt im Fehlerfall auf `{latitude:0, longitude:0}`
  zurück — ein Punkt im Golf von Guinea, der die Streckenlänge um mehrere
  tausend Kilometer verfälscht und die Karte unbrauchbar zoomt. Besser: den
  Stopp-Punkt weglassen und die Aufzeichnung mit dem letzten gültigen Punkt
  beenden.
- `geocodeKey` (`:109-111`) rundet auf drei Nachkommastellen (~110 m). In dicht
  bebautem Gebiet kann derselbe Cache-Eintrag zwei Nachbarorte abdecken. Für den
  Zweck vertretbar — im README erwähnen.
- `fillMapSessionOptions` (`:452`) baut einen CSS-Selektor aus `prev` zusammen.
  Da `prev` immer ein Zeitstempel ist, ungefährlich; nach der Umstellung auf
  andere IDs wäre es ein Injektionsvektor. Stattdessen über
  `[...sel.options].some(o => o.value === prev)` prüfen.
- `active.id = now` (`:221`) — zwei Aufzeichnungen in derselben Millisekunde sind
  praktisch unmöglich, aber `crypto.randomUUID()` kostet nichts.
- `updateStatSpeed` wird nur im `moving`-Zustand aufgerufen (`:210`); in der
  Pause bleibt der letzte Wert stehen statt auf 0 zu fallen. Kleine Irritation
  in der Live-Ansicht.

---

## Reihenfolge der Umsetzung

1. **A3** (Export) — ohne ihn ist jeder andere Datenverlust unumkehrbar
2. **A2** (Speicher-Grenzen) — verhindert stillen Totalverlust
3. **A1** (Leaflet lokal) — stellt den beworbenen Offline-Betrieb her
4. **B3** (Wake Lock), **B2** (Geocode nach Stopp), **B5** (Erwartung klarstellen)
5. **B1** (Escaping), **B4** (Nominatim-Konformität)
6. **C1–C3** (Module, Benennung, Zustand) samt Tests
