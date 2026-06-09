# Landing-Page: Fokus-Section + CTA-Check

**Datum:** 2026-06-09
**Scope:** `index.html` (`#intro`-Landing) + `src/style.css`

## Ausgangslage

Die Landing (`.intro` in `index.html`) hatte bereits:
- Hero mit CTA above-the-fold (`#introStart` „Kostenlos starten →“, öffnet die App direkt)
- 4 Sections: Hero · Wie es funktioniert · Warum nicht mitschneiden? · Abschluss-CTA (`#introStartBottom`)

Der Wunsch „CTA nach ganz oben kopieren, oben und unten“ war damit faktisch
schon erfüllt (vermutlich auf einem älteren Deploy entstanden). Beide CTAs
bleiben unverändert erhalten — nichts entfernt.

## Änderung

Neue **5. Section „Fokus"** zwischen dem Tool-Vergleich und dem Abschluss-CTA.
Sie steht bewusst als Klimax direkt vor dem Start-Button.

Kerngedanke (Kundenwunsch): Die regelmäßige, ruhige Ping-Frage ist mehr als
Buchhaltung — sie wirkt wie ein Pomodoro-Fokus-Anker. In dem Moment, in dem du
dein Thema benennst, bist du wieder bei der Sache; keine verlorene Stunde mit
„Was hab ich gerade getan?". Fokus und saubere Abrechnung fallen zusammen.

Tonalität: schlicht-seriös (Zielgruppe Kanzlei-Inhaber).

### Inhalt
- Kicker: „Mehr als ein Stundenzettel"
- Titel: „Du weißt wieder, woran du arbeitest."
- Lead: Pomodoro-Takt ohne starre 25-Minuten-Uhr.
- 3 Karten: „Ein Anker im Tag" · „Kein ‚Was hab ich gerade getan?'" ·
  „Fokus und saubere Abrechnung in einem" (verknüpft Fokus → Datenqualität → Abrechnung).

### Technik
- Wiederverwendung des bestehenden `.intro-section` / `.intro-points` / `.intro-point`
  Scaffoldings (auf Desktop automatisch 3-spaltig).
- Neu in CSS: `.section-lead` (zentrierter Lead unter dem Titel) und
  `.intro-focus .section-title{margin-bottom:14px}` (engerer Abstand zum Lead).
- Keine JS-Änderung, keine neuen Buttons.

### Tests
- Neuer E2E-Test in `tests/intro.spec.js`: Fokus-Section sichtbar, Titel korrekt,
  „Pomodoro" im Text, genau 3 Karten — geprüft auf Desktop + Mobile.
