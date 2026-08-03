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

## Grenzen (wichtig für den echten Einsatz)
- Ein **Browser-Tab im Hintergrund** (Bildschirm aus, App gewechselt) wird
  von iOS/Android irgendwann pausiert oder beendet – eine PWA kann GPS nicht
  zuverlässig unbegrenzt im Hintergrund tracken. Die Option „Bildschirm wach
  halten" (Wake Lock) hilft, solange die App im Vordergrund/Bildschirm an ist,
  ersetzt aber kein natives Hintergrund-Tracking.
- Alle Daten liegen nur **lokal im Browser** (`localStorage`), kein Cloud-Sync.

## Starten (lokal testen)
```bash
python -m http.server 5179
```
Am Handy im selben WLAN `http://<PC-IP>:5179` öffnen. Für GPS ist ein
**sicherer Kontext** nötig: `localhost` gilt als sicher; über die IP braucht
es **HTTPS** (z. B. Hosting wie GitHub Pages).

## Auf dem Handy nutzen
1. Seite öffnen (am besten über HTTPS-Hosting).
2. „Standort erlauben" tippen.
3. Über „Zum Home-Bildschirm hinzufügen" installieren, dann wie eine App
   starten.
