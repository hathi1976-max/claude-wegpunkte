# WegLog – Entwicklungsdokumentation

Stand: August 2026. Vanilla-Web-App ohne Framework, ohne Build-Schritt, ohne
Abhängigkeiten. Alle Dateien sind statisch auslieferbar.

## Projektstruktur

```
claude-wegpunkte/
├── index.html            Oberfläche: Berechtigung, Live/Karte/Verlauf/Einstellungen, Detail-Sheet
├── style.css             Layout, dunkles Thema, Sheet und Karte
├── js/
│   ├── app.js            Verdrahtung: GPS, Wake Lock, Speicher, Anzeige
│   ├── geo.js            Geometrie, Geschwindigkeit, Schwellen (rein)
│   ├── tracking.js       Aufzeichnungs-Zustandsmaschine (rein)
│   ├── storage.js        localStorage, Speicher injizierbar
│   ├── geocode.js        Reverse-Geocoding über Nominatim (gedrosselt, gecacht)
│   ├── format.js         Anzeigetexte (Zeit, Dauer, km, Symbole)
│   ├── export.js         GPX, CSV, JSON-Sicherung (rein, ohne DOM)
│   └── ui.js             alles, was das DOM anfasst
├── tests/
│   ├── test.html         Testlauf im Browser (kein node auf dem Zielrechner)
│   ├── lauf.js           minimaler Testläufer
│   ├── geo.test.js       Geometrie und Formatierung
│   ├── tracking.test.js  Zustandsmaschine, Zustandsherstellung, Differenztest
│   ├── storage.test.js   Persistenz gegen eine Speicher-Attrappe
│   ├── export.test.js    GPX/CSV/Sicherung, inkl. Fremdtext mit Markup
│   └── referenz-alt.js   eingefrorene Tracking-Logik von vor dem Modul-Umbau
├── sw.js                 Service Worker (Offline-Cache der App-Shell)
├── manifest.webmanifest  PWA-Manifest
├── README.md             Kurzüberblick und Installationsanleitung
├── CODEREVIEW.md         Befunde des Code-Reviews samt Umsetzungsstand
└── ENTWICKLUNG.md        diese Datei
```

## Architektur

Drei Schichten, absichtlich getrennt:

1. **Rechenwege (rein, ohne DOM und ohne Uhr)** — `geo.js` und `tracking.js`.
   `schrittPosition(zustand, coords, now, settings)` bekommt alles als
   Parameter und liefert `{zst, punkte, speedKmh, ausgewertet}`. Dadurch lässt
   sich die Pausenerkennung mit konstruierten Spuren nachrechnen, ohne GPS.
2. **Persistenz** — `storage.js` ist der einzige Ort, der die
   `localStorage`-Schlüssel kennt. Der Speicher ist über `setzeSpeicher()`
   austauschbar, damit Tests nie echte Aufzeichnungen anfassen.
3. **Anzeige** — `ui.js` bekommt über `verbinde(kontext)` Lesezugriff auf den
   Anwendungszustand und hält selbst nur die offene Detailansicht.

### Aufzeichnungszustand

`{ zustand: 'idle'|'moving'|'paused', lastRaw, pauseSince, lastLogTime }` hängt
als `laufendeAufzeichnung.zustand` an der Aufzeichnung und wird mit ihr
gespeichert. Ein Neuladen stellt damit exakt den vorherigen Stand her, ohne aus
dem letzten Wegpunkt zu raten.

Hysterese gegen Pausen-Flackern: unter 1 km/h beginnt die Pausenuhr, erst ab
2 km/h endet die Pause wieder. Der Jitter-Filter verwirft Bewegungen unterhalb
der gemittelten GPS-Ungenauigkeit beider Positionen.

## PWA

- `sw.js`: Netz zuerst für eigene Dateien (Updates kommen sofort an), Cache als
  Offline-Rückfall. **Bei jeder Änderung an ausgelieferten Dateien die
  Cache-Version hochzählen**, sonst sehen installierte Apps den alten Stand.
- Alle Dateien aus `js/` stehen in `SHELL` — fehlt eine, ist die App offline
  kaputt.

## Entwickeln und Testen

```
py -m http.server 5179
```

im Projektordner starten, dann `http://localhost:5179` öffnen. Tests:
`http://localhost:5179/tests/test.html`. Die Seite meldet oben
„alle N Tests bestanden" bzw. die Fehlschläge; `window.__TESTERGEBNIS` hält das
Ergebnis für eine Abfrage von außen bereit. Ein registrierter Service Worker
wird von der Testseite vorher abgemeldet und der Cache geleert — sonst misst
der Testlauf alten Code.

Auf dem Zielrechner gibt es **kein node und kein npm**. Deshalb der eigene
Läufer in `tests/lauf.js` und der Browser als Testfläche; eine zweite
Testfläche gibt es bewusst nicht.

---

## Umsetzung des Code-Reviews (August 2026)

Grundlage: `CODEREVIEW.md`. Ein Abschnitt je Arbeitsschritt.

### 05.08.2026 — C1/C2/C3: Module, Benennung, Zustandshaltung

**Geändert.** `app.js` (582 Zeilen, globaler Namensraum, Event-Listener über die
ganze Datei verstreut) ist in sieben Module unter `js/` aufgeteilt, geladen als
`<script type="module">`. Die reinen Rechenwege liegen in `geo.js` und
`tracking.js`, die Persistenz in `storage.js`, das DOM ausschließlich in
`ui.js`. `history_` heißt `aufzeichnungen`, `active` heißt
`laufendeAufzeichnung` (C2). Der Aufzeichnungszustand wandert in die
Aufzeichnung und wird mitgespeichert; `initApp` rekonstruiert nichts mehr (C3).
Neu: `tests/` mit eigenem Läufer und `tests/test.html`.

**Geprüft.**
- **Differenztest gegen den Stand davor.** `tests/referenz-alt.js` ist eine
  wörtliche Transkription der alten Tracking-Logik aus Commit `1bf66e7`
  (`app.js:70-212`), DOM-Aufrufe durch Mitschreiber ersetzt. 20 gesäte
  Zufallsspuren à 300 Positionen (Wechsel zwischen Stillstand, Gehen, Fahren,
  schwankende Genauigkeit, gelegentlich gemeldete Gerätegeschwindigkeit) plus
  zwei abweichende Einstellungssätze laufen durch beide Fassungen; verglichen
  werden Wegpunkte, Geschwindigkeiten und Endzustand. Eine Gegenprobe stellt
  sicher, dass die Spuren überhaupt `log`-, `pause`- und `resume`-Punkte
  erzeugen — ohne sie könnte der Differenztest zwei leere Listen vergleichen.
- **Konstruierte Spuren, von Hand nachgerechnet.** Pausenpunkt fällt bei exakt
  180 000 ms und genau einmal; eine Position früher (179 999 ms) noch nicht.
  Nach der Pause 111,19 m je 60 s = 6,67 km/h → Fuß-Intervall, nächster
  Wegpunkt erst 5 Min später. 27,8 m je 60 s = 1,67 km/h liegt zwischen den
  Schwellen 1 und 2 und beendet die Pause nicht. 0,01 Grad je 60 s = 66,7 km/h
  → Wegpunkt jede Minute.
- **Unabhängige Gegenrechnung.** Dieselben Spuren sind in einem
  Python-Skript nachgerechnet worden (eigene Implementierung von `haversine`,
  `computeSpeedKmh`, `intervalMsForSpeed` und der Zustandsmaschine). Ergebnis
  identisch, inklusive der Zahlen 111 194,93 m je Breitengrad, 40,03 km/h für
  111,19 m in 10 s und 4,003 km/h für 11,12 m in 10 s bei Genauigkeit 5 m.
- **Zustandsherstellung.** Sieben Tests zu `zustandAusAufzeichnung`, darunter
  der Fall, der vorher schiefging: letzter Wegpunkt ist `log`, der Zustand ist
  aber `paused` — die alte Rekonstruktion hätte die Pause beim Neuladen
  verloren.

**Nebenbefund (C3).** Der Review verortete den Schreibaufwand nicht, aber der
naheliegende Weg — den Zustand bei jeder GPS-Position mitspeichern — wäre
teuer: `enableHighAccuracy` liefert alle paar Sekunden eine Position. Gespeichert
wird deshalb nur, wenn ohnehin ein Wegpunkt fällt oder sich `zustand` bzw.
`pauseSince` ändert.

### 05.08.2026 — A3: Export (GPX, CSV, Vollsicherung)

**Geändert.** Neues Modul `js/export.js` — ohne fremde Bibliothek und ohne DOM,
es liefert ausschließlich Text. Das Herunterladen macht `ui.starteDownload`
über einen Blob-Link, der nach einer Sekunde wieder freigegeben wird.

- `alsGpx(session)` — Spur als `<trk><trkseg>`, dazu die markanten Punkte
  (alles außer `log`) als `<wpt>` mit Namen aus Punktart und Ortsname.
- `alsCsv(session)` — Kopfzeile `Zeit;Typ;Ort;Breite;Laenge;km/h;Genauigkeit_m`,
  deutsche Zahlen, CRLF, beim Download ein UTF-8-BOM voran.
- `alsSicherung` / `leseSicherung` / `vereine` — JSON-Vollsicherung samt
  Wiedereinlesen. `bereinige()` wirft Laufzeitfelder (`zustand`) und unbekannte
  Felder weg und rechnet eine fehlende Streckenlänge nach.

Zwei Dinge, die die Vorlage im Review nicht vorsah, aber nötig sind:

1. **Fremdtext im Export.** Ortsnamen stammen von Nominatim. `xmlEsc` entschärft
   die fünf XML-Sonderzeichen und entfernt die in XML schlicht verbotenen
   Steuerzeichen (`\x00-\x08`, `\x0B`, `\x0C`, `\x0E-\x1F`) — sonst ist die
   Datei nicht bloß hässlich, sondern unparsbar. Im CSV wird quotiert **und**
   ein führendes `= + - @` mit einem Apostroph entschärft, sonst führt die
   Tabellenkalkulation den Ortsnamen als Formel aus.
2. **Einlesen ergänzt, es ersetzt nicht.** `vereine` vergleicht über die `id`
   (als Zeichenkette, damit alte Zahlen-`id`s und neue passen) und behält im
   Zweifel den Bestand. Eine Sicherung einzulesen kann damit nichts löschen.
   Die gerade laufende Aufzeichnung wird vor dem Zusammenführen ausgefiltert,
   sonst läge sie nach dem Einlesen doppelt vor — einmal laufend, einmal als
   abgeschlossene Kopie aus der Sicherung.

**Geprüft.** 27 Tests in `tests/export.test.js`. Die beiden aussagekräftigsten:

- Das erzeugte GPX läuft im Test durch `DOMParser`. Mit dem Ortsnamen
  `<img src=x onerror="alert(1)">Böse; Stadt "A"` bleibt es wohlgeformt
  (0 `parsererror`), der Name kommt als **Text** an und der Baum enthält
  **0 `<img>`-Elemente**.
- Ein kleiner CSV-Leser im Test zerlegt die Zeile mit demselben Ortsnamen
  wieder: 7 Felder, Feld 3 exakt der Ursprungstext — die Quotierung hält,
  obwohl der Name Semikolon und Anführungszeichen enthält.

Dazu Rundlauf der Sicherung (Werte identisch, `zustand` nicht in der Datei),
Ablehnung kaputter/fremder/leerer Dateien, Nachrechnen einer fehlenden
Streckenlänge (111,195 km für einen Breitengrad) und vier Fälle für `vereine`.

### 05.08.2026 — A2: Schutz gegen vollen Speicher

**Geändert.** `js/storage.js` schreibt nur noch über `persist(key, wert)`.
Die Funktion fängt `QuotaExceededError` (samt der Firefox-Schreibweise
`NS_ERROR_DOM_QUOTA_REACHED` und den Codes 22 und 1014), liefert `false` und
schickt eine Meldung an einen Rückruf. `app.js` verbindet diesen Rückruf mit
`ui.zeigeBanner`; `storage.js` bleibt damit DOM-frei und testbar.

Drei Stellen, an denen das Verhalten sich dadurch ändert:

1. **Stoppen.** Schlägt `saveHistory` fehl, wird `weglog.active` **nicht**
   gelöscht. Ohne das verschwände die Aufzeichnung zwischen zwei Schlüsseln:
   aus dem aktiven entfernt, im Verlauf nie angekommen. Der Nutzer bekommt ein
   Banner, das zum sofortigen Sichern auffordert.
2. **Ortscache.** Er wächst über alle Fahrten hinweg und wurde nie kleiner.
   Jetzt hat jeder Eintrag einen Zeitstempel (`{ort, t}`), und
   `deckleGeocache` hält 2 000 Einträge, wobei die ältesten zuerst fliegen.
   Alte Einträge, die nur den Ortsnamen als Zeichenkette hielten, werden beim
   Laden umgesetzt (`t: 0`) und gelten damit als die ältesten — genau richtig.
3. **Einstellungen.** Neuer Abschnitt „Speicher" mit Balken, Belegung in KB/MB
   gegen die übliche 5-MB-Grenze, Zahl der Aufzeichnungen und Wegpunkte, dazu
   „Älter als 90 Tage löschen" mit Rückfrage.

Gerechnet wird in **Zeichen**, nicht in Bytes: `localStorage` bemisst seine
Grenze in UTF-16-Einheiten, eine Byte-Zahl nach UTF-8 wäre die falsche Auskunft.

**Geprüft.** 25 Tests in `tests/storage.test.js`, davon 5 zum vollen Speicher.
Die Attrappe hat dafür eine Größengrenze bekommen und wirft dieselbe Ausnahme
wie ein echter Browser. Nachgewiesen:

- `persist` wirft nicht, sondern liefert `false`.
- Die Meldung erreicht die Anzeige, mit Art `error` und dem Text „Speicher voll".
- **Der zuvor gespeicherte Stand bleibt unverändert**, wenn das Schreiben
  scheitert — ein halb geschriebener Verlauf wäre schlimmer als gar keiner.
- Unterhalb der Grenze wird ganz normal geschrieben, ohne Meldung.
- `deckleGeocache` verwirft aus 10 Einträgen die 7 ältesten und lässt einen
  Cache unterhalb des Deckels unangetastet (identische Objektreferenz).
- `teileNachAlter` trennt an der Tagesgrenze; exakt 90 Tage alt bleibt erhalten,
  und ohne `endTime` zählt der Beginn.

### 05.08.2026 — A1: Offline-Karte

**Geändert.** `sw.js` neu aufgebaut: drei Caches statt einem.

| Cache | Inhalt | Strategie |
| --- | --- | --- |
| `weglog-v5` | eigene Dateien | Netz zuerst, Cache als Rückfall |
| `weglog-vendor-leaflet-1.9.4` | Leaflet CSS + JS | Cache zuerst, beim Install geholt |
| `weglog-kacheln-v1` | OSM-Kacheln | Cache zuerst, Deckel 600 |

Die Zeile, die `unpkg.com` und `tile.` ausdrücklich vom Cache ausschloss, ist
weg; Nominatim bleibt ungecacht, weil Ortsnamen Live-Abfragen sind.

In `ui.js`: `renderMap` prüft `typeof L === 'undefined'`, blendet den
Kartenbereich aus und zeigt einen Hinweis, statt einen `ReferenceError` zu
werfen. Der Kachel-Layer bekommt `crossOrigin: true` und zwei Ereignisse:
`tileerror` setzt den Hinweis, `load` (alle sichtbaren Kacheln da) nimmt ihn
wieder weg. `tileload` je Kachel wäre falsch — der Hinweis blinkte bei halb
geladener Karte weg.

**Zwei bewusste Abweichungen vom Review** (Begründung in `CODEREVIEW.md`):

1. Leaflet liegt **nicht** als Datei im Projekt, sondern wird beim Install in
   den `VENDOR`-Cache geholt. Für den Nutzer ist das Ergebnis dasselbe; die
   allererste Installation muss online geschehen.
2. Der Kachelcache verwirft nach **FIFO**, nicht nach LRU. Die Cache-API
   liefert `keys()` in Einfügereihenfolge; echtes LRU bräuchte einen Index
   oder ein Neuschreiben jeder getroffenen Kachel.

**Geprüft.** Neu: `tests/version.test.js` (6 Tests), die die ausgelieferten
Dateien selbst lesen — gleiche Herkunft, kein fremder Dienst.

- **Der wichtigste Test** läuft die Import-Kette ab `js/app.js` ab und
  verlangt, dass jedes erreichte Modul in `SHELL` steht. Genau dieser Fehler
  — ein neues Modul vergessen — zerlegt die App offline, ohne dass es online
  auffiele. Aktuell: 8 Module gefunden, alle in `SHELL`.
- Jeder `SHELL`-Eintrag ist wirklich abrufbar (HTTP 200).
- `sw.js` und `index.html` verweisen auf dieselben zwei Leaflet-Dateien,
  beide auf eine feste Version gepinnt und mit `crossorigin`.
- Cache-Name in `sw.js` und Versionsanzeige in `index.html` stimmen überein.

Alle Regeln dieser Tests sind vorher mit einem Python-Skript gegen die echten
Dateien nachvollzogen worden, damit die Ausdrücke nicht ins Leere greifen.
