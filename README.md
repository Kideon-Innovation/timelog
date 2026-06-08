# TimeLog

**Zeiterfassung für Kanzleien.** · **Für Berufsgeheimnisträger (§203) · DSGVO-konform · Funktioniert offline**
Live: https://timelog.kideon.de/

TimeLog ist eine App für die Zeiterfassung in Kanzleien — Steuer- und Rechtsberatung. Sie
fragt dich in festem Takt — *„woran arbeitest du gerade, für welchen Mandanten?"* — du
tippst ein Stichwort, und dein Tag wächst als farbige Blöcke in einer Kalenderansicht. Am
Monatsende exportierst du alles als Excel: fertiger Stundenzettel, abrechenbar.

**Was du einträgst, verlässt nie deinen Computer.** Kein Server, kein Konto, keine Übertragung
an Dritte — auch Mandantennamen bleiben ausschließlich auf deinem Gerät. Niemand außer dir kann
sie sehen. Damit ist TimeLog **für Berufsgeheimnisträger gemacht**: deine Verschwiegenheitspflicht
(§203 StGB) bleibt gewahrt, und DSGVO-konform ist es gleich mit. Genau deshalb läuft die App auch
komplett **offline**.

Der Takt ist wählbar: **60, 30, 20, 15, 10 oder 6 Minuten** (Standard 15). Kürzerer Takt =
feinere Auflösung, häufigere Nachfragen.

![TimeLog – 3-Tage-Kalender](screenshots/desktop-dark.png)

## Idee

In einer Kanzlei ist jede vergessene Viertelstunde **Honorar, das du nicht abrechnest.**
Manuelle Zeiterfassung zahlt sich nur aus, wenn du sie konsequent mitschreibst — und genau
daran scheitert sie im Alltag. Automatische Tracker wiederum sehen zwar App, Fenster und
Datei, aber nie die *Sache*: welcher Mandant, welches Aktenzeichen weiß nur du. Also
rekonstruierst du es am Monatsende doch wieder aus dem Gedächtnis.

TimeLog dreht das um: **es fragt dich**, in regelmäßigem Takt. Ein Stichwort — Mandant,
Sache, Tätigkeit — und du bist durch. Daraus entsteht ohne Disziplin-Aufwand ein lückenloser,
abrechenbarer Stundenzettel.

**Leere Blöcke sind gewollt.** Nicht erfasst = kein Block. TimeLog drängt dich nie,
Lücken zu füllen; leer lassen ist immer ein Klick. Eine dezente Aktivitätsspur im Kalender
zeigt dir nebenbei, wann der Rechner überhaupt an war — so siehst du auf einen Blick, welche
Lücken echte Pausen sind und welche noch nachzutragen sind.

## Wie es funktioniert

1. **Öffnen** — als installierte App, durch Doppelklick auf die Datei oder im Browser.
   Beim ersten Start fragt TimeLog, ob es dich an die Eingabe erinnern darf.
2. **Nachfrage** — im gewählten Takt meldet sich TimeLog (Ton + kurzer Hinweis, auf Wunsch
   auch als Erinnerung des Geräts). Du tippst ein Stichwort, wählst eine der letzten
   Tätigkeiten, klickst **„Weiter wie eben"** oder lässt leer. Den Takt stellst du oben um.
3. **Nachtragen** — warst du weg, fragt TimeLog beim Zurückkommen die verpassten Einträge
   der letzten ~2 Stunden ab. Einzeln füllen, „alle = X" sammeln oder leer lassen.
4. **Prüfen & nachtragen** — der gefüllte Tag steht als Blöcke in einer 3-Tage-Ansicht im
   Stil eines Kalenders. Blöcke anklicken zum Bearbeiten/Löschen, mit ◀ ▶ durch die Tage.
   Mit der Maus (oder am Handy: gedrückt halten und ziehen) ziehst du im Kalender einen
   Zeitbereich auf und trägst einen Block über mehrere Zeitfenster nach.
5. **Exportieren** — **↓ Excel** schreibt `Datum | Wochentag | Start | Ende | Dauer |
   Tätigkeit` als Excel-Datei, optional mit Datumsfilter.

## Als App installieren

TimeLog lässt sich wie eine normale App installieren: eigenes Fenster, offline lauffähig,
eigenes Symbol auf Startbildschirm bzw. im Dock.

- **Chrome / Edge (Desktop & Android):** Installieren-Symbol in der Adressleiste — oder den
  **„↗ App installieren"**-Button oben rechts in der App.
- **iPhone / iPad (Safari):** Teilen <kbd>⬆</kbd> → **„Zum Home-Bildschirm"** → Hinzufügen.
- Der **„↗ App installieren"**-Button in der App führt dich plattformgerecht durch die Schritte.

Nach der Installation startet TimeLog im eigenen Fenster, ohne Browser-Leiste, und läuft
komplett offline.

| Tagesansicht (Mobile) | Nachfrage | Installations-Hilfe |
|---|---|---|
| ![](screenshots/mobile-dark.png) | ![](screenshots/mobile-ping.png) | ![](screenshots/mobile-install.png) |

## Features

- **Wie eine echte App installierbar** — eigenes Symbol, eigenes Fenster, Schnellzugriffe
  („Jetzt eintragen", „Export").
- **Voll offline** — einmal geladen, läuft alles ohne Internet, auch der Excel-Export.
- **Passt sich an**: 3-Tage-Kalender am Computer, 1-Tag-Ansicht mit großen Dialogen am Handy.
- **Touch & Maus**: am Computer Zeitbereich mit der Maus aufziehen, am Handy gedrückt halten
  und ziehen.
- Wählbarer Takt (60/30/20/15/10/6 Min) mit mitlaufendem Countdown.
- Nachtragen verpasster Nachfragen (bis 2 h zurück), einzeln oder gesammelt füllen.
- 3-Tage-Kalender im vertrauten Kalender-Stil, „Jetzt"-Linie, aktuelles Zeitfenster markiert.
- Im Kalender einen Block über mehrere Zeitfenster ziehen (überschreibt Bestehendes).
- Feste Farbe pro Tätigkeit (gleiches Stichwort = gleiche Farbe).
- Hell-/Dunkel-Ansicht, Schnellauswahl der zuletzt genutzten Tätigkeiten.
- Excel-Export mit Datumsfilter.

![TimeLog – Light Theme](screenshots/desktop-light.png)

## Berufsgeheimnis (§203) & Datenschutz

**Was du einträgst, verlässt nie deinen Computer.** Alle Eingaben — auch Mandantennamen —
werden ausschließlich auf deinem Gerät gespeichert. Es gibt keinen Server, kein Konto und
keine Übertragung an Dritte. Niemand außer dir kann die Daten sehen.

Für Berufsgeheimnisträger ist das der entscheidende Punkt: Weil die vertraulichen Inhalte
das Gerät nie verlassen, wird auch kein Dienstleister zur „mitwirkenden Person" — genau das
Problem, das Cloud-Software für Kanzleien sonst hat, entsteht hier gar nicht erst. Deine
Verschwiegenheitspflicht nach **§203 StGB** bleibt gewahrt. Und weil keine personenbezogenen
Daten an Dritte gehen, ist es zugleich die einfachste Form von **DSGVO-Konformität** — es
gibt keine Auftragsverarbeitung, weil es keinen Verarbeiter gibt.

Praktische Folge: Wechselst du den Browser oder löschst den Speicher, sind die Daten weg —
exportiere also bei Bedarf regelmäßig als Excel. Die dezente **Aktivitätsspur** (wann der
Rechner an war) bleibt ebenfalls rein lokal, umfasst nur die letzten 7 Tage und landet nie
im Excel-Export.

> Hinweis: Die App lädt beim Start ihre Schriftarten von Google Fonts. Dabei werden keine
> Eingaben übertragen — nur deine IP-Adresse wird an Google übermittelt, wie bei jedem
> Aufruf einer Website mit eingebundenen Web-Schriften. Das berührt das Berufsgeheimnis
> (§203) nicht; deine Mandantendaten bleiben in jedem Fall ausschließlich auf dem Gerät.

## Tech

Vanilla HTML/CSS/JS, kein Framework, kein Build-Step. Die PWA besteht aus `index.html` +
`manifest.webmanifest` + `sw.js` (Service Worker) + `icons/`. [SheetJS](https://sheetjs.com)
ist lokal unter `vendor/` gebündelt, damit der Export auch offline (und von `file://`)
funktioniert. Sonst keine Abhängigkeiten.

Alle Pfade sind **relativ** — die App läuft unverändert auf dem GitHub-Pages-Subpfad
(`…/timelogging/`) wie auf jeder anderen Domain.

### Icons & Screenshots neu generieren

Benötigt das global installierte Playwright. Die generierten PNGs sind eingecheckt — die
Skripte braucht man nur, wenn sich Branding oder Layout ändern:

```bash
PLAYWRIGHT_MODULE="$(npm root -g)/@playwright/test/index.js" node scripts/generate-icons.mjs
PORT=8000 PLAYWRIGHT_MODULE="$(npm root -g)/@playwright/test/index.js" node scripts/screenshots.mjs
```

## Deployment (GitHub Pages)

Repo → Settings → Pages → Source: `main` / root. Fertig. GitHub Pages liefert über HTTPS aus,
damit funktionieren Service Worker und Installation out of the box.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
