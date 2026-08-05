# WegLog

PWA, die während einer aktiven Aufzeichnung automatisch Wegpunkte mit
Uhrzeit und Ortschaft protokolliert – bis du sie aktiv stoppst.

## Funktioniert so
- **Start** loggt sofort einen Wegpunkt und startet `watchPosition`.
- Das **Log-Intervall** richtet sich nach der Geschwindigkeit (einstellbar):
  zu Fuß seltener, mit Rad/Auto häufiger.
- **Pausen**: Fällt die Geschwindigkeit für X Minuten unter die Schwelle,
  wird ein „Pause"-Wegpunkt gesetzt und das reguläre Loggen pausiert, bis du
  dich wieder bewegst („Weiter"-Wegpunkt).
- Die Aufzeichnung bleibt **aktiv, bis du „Stopp" drückst** – auch über einen
  Reload/Neustart der App hinweg (aktive Session wird lokal gespeichert und
  beim Öffnen fortgesetzt).
- **Ortsname** je Wegpunkt kommt per Reverse-Geocoding von **Nominatim**
  (OpenStreetMap), gedrosselt auf 1 Anfrage/Sekunde und lokal gecacht.
  Kann in den Einstellungen abgeschaltet werden (dann nur Koordinaten).
- **Karte**: aktive und vergangene Aufzeichnungen als Route mit Leaflet/OSM.
- **Verlauf**: abgeschlossene Aufzeichnungen mit Dauer, Strecke, Wegpunkten;
  löschbar.
- **Export**: jede Aufzeichnung als **GPX** (Spur als `trk`, Start/Pause/
  Weiter/Ende zusätzlich als `wpt`; direkt in Komoot, Garmin oder OsmAnd
  einlesbar) oder als **CSV** (Semikolon als Trenner, Komma als Dezimalzeichen,
  UTF-8-BOM — öffnet in einer deutschen Tabellenkalkulation direkt richtig).
  In den Einstellungen zusätzlich eine **Vollsicherung als JSON** und das
  Gegenstück zum Wiedereinlesen. Eingelesen wird **ergänzend**: gleiche
  Aufzeichnungen bleiben, wie sie sind, nichts wird überschrieben.

## Grenzen (wichtig für den echten Einsatz)
- Die Aufzeichnung läuft zuverlässig, solange WegLog im **Vordergrund** und
  der Bildschirm an ist. Ein **Browser-Tab im Hintergrund** (Bildschirm aus,
  App gewechselt) wird von iOS/Android irgendwann gedrosselt oder beendet –
  eine PWA kann GPS nicht zuverlässig unbegrenzt im Hintergrund verfolgen.
  Die Option „Bildschirm wach halten" (Wake Lock) hilft, solange die App im
  Vordergrund ist, ersetzt aber kein natives Hintergrund-Tracking. Der Lock
  wird beim Zurückkommen aus dem Hintergrund automatisch neu angefordert.
- Fehlen dadurch Wegpunkte, wird die Zeitspanne beim Zurückkommen als eigener
  Wegpunkt **„Lücke" (⚠️)** protokolliert – statt eine gerade Linie durch die
  Landschaft zu ziehen, als wäre man sie so gefahren. Schwelle: das Dreifache
  des größten eingestellten Intervalls, mindestens zehn Minuten.
- Alle Daten liegen nur **lokal im Browser** (`localStorage`), kein Cloud-Sync.
  Der Speicher ist je nach Browser bei etwa 5 MB gedeckelt; die Einstellungen
  zeigen die Belegung an und melden es deutlich, wenn nichts mehr hineinpasst.
- **Offline-Karte:** Leaflet und die schon einmal betrachteten Kartenkacheln
  liegen im Offline-Speicher (Deckel 600 Kacheln). Der erste Aufruf muss
  online geschehen; danach ist die Karte auf bekannten Strecken auch im
  Funkloch da. Fehlen Kacheln, sagt die App es — die Aufzeichnung selbst
  läuft davon unabhängig weiter.
- **Ortsnamen** werden auf ein Raster von drei Nachkommastellen (~110 m)
  gecacht. In dicht bebautem Gebiet kann ein Cache-Eintrag deshalb zwei
  benachbarte Ortsteile abdecken.

## Nominatim fair benutzen

Nominatim ist ein Dienst der OpenStreetMap-Gemeinschaft und
[hat Nutzungsbedingungen](https://operations.osmfoundation.org/policies/nominatim/):
höchstens **eine Anfrage pro Sekunde** und eine **erreichbare Kennung** des
Aufrufers. WegLog hält beides ein:

- Die Warteschlange arbeitet mit 1,1 s Abstand, Antworten werden lokal gecacht,
  und auf HTTP 429 oder 403 pausiert sie eine Minute, statt weiterzupumpen.
- Ein Browser darf den `User-Agent` nicht setzen. Vorgesehen ist stattdessen
  der Parameter `email`. In den Einstellungen gibt es dafür das Feld
  **Kontakt-E-Mail für Nominatim** — freiwillig, nicht vorbelegt, bleibt auf
  dem Gerät. Ohne Eintrag wird nichts mitgeschickt.
- Wird WegLog unter einer echten Domain betrieben (z. B. GitHub Pages), trägt
  zusätzlich der automatisch mitgeschickte `Referer` zur Identifizierung bei.
  **Die Betriebsdomain hier eintragen:** _(noch nicht festgelegt)_

Bei starker Nutzung ist `photon.komoot.io` eine Ausweichquelle; die Anbindung
steckt vollständig in `js/geocode.js` (`baueUrl` und `ortAusAntwort`).

## Starten (lokal testen)
```bash
python -m http.server 5179
```
Am Handy im selben WLAN `http://<PC-IP>:5179` öffnen. Für GPS ist ein
**sicherer Kontext** nötig: `localhost` gilt als sicher; über die IP braucht
es **HTTPS** (z. B. Hosting wie GitHub Pages).

## Vor jeder Freigabe (Checkliste)

1. `VERSION` in `sw.js` hochzählen (`v8` → `v9` …).
2. Dieselbe Zeichenkette in `index.html` bei `<p class="ver">` nachziehen.
3. Neue Dateien unter `js/` in `SHELL` in `sw.js` eintragen — **sonst ist die
   App offline kaputt**.
4. `tests/test.html` aufrufen: muss „alle N Tests bestanden" melden. Die
   Punkte 1 bis 3 werden dort mitgeprüft.
5. Auf dem Gerät einmal neu laden und schauen, ob die Versionsanzeige unten im
   Berechtigungs-Bildschirm die neue Nummer zeigt. Tut sie das nicht, hält der
   alte Service Worker die alte Fassung fest.

## Auf dem Handy nutzen
1. Seite öffnen (am besten über HTTPS-Hosting).
2. „Standort erlauben" tippen.
3. Über „Zum Home-Bildschirm hinzufügen" installieren, dann wie eine App
   starten.
