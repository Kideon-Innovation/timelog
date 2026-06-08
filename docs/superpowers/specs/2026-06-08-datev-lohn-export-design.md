# DATEV-Lohn-Export (Datei) — Design

Datum: 2026-06-08

## Problem

TimeLog erfasst Arbeitszeit lokal und exportiert heute nur als Excel
(`Datum | Wochentag | Start | Ende | Dauer | Tätigkeit`). Gewünscht: erfasste
Stunden als Datei bereitstellen, die ein Lohnbüro in **DATEV Lohn und Gehalt**
importieren kann.

## Recherche-Ergebnis (entscheidet die Richtung)

DATEV dokumentiert öffentlich nur zwei Datei-Welten:

- **DATEV-Format / EXTF** — Buchführung (Fibu): Buchungsstapel, Stammdaten.
- **ASCII Lohnimportdatenservice** — Lohn: Bewegungsdaten, Lohnarten, Stunden.

**Leistungserfassung / Eigenorganisation / Auftragswesen (Mandanten-Honorar)
hat KEINEN offenen Datei-Import.** Dort läuft Integration nur über die
zertifizierte DATEV-Partner-API (z.B. Memtime, ingentis in.time). Für eine
localStorage-PWA nicht erreichbar.

Konsequenz: Wir bedienen die **Lohn**-Schiene per Datei. Der ursprünglich
angedachte Mandanten-/Leistungs-Use-Case ist über Datei-Export nicht machbar
und wird hier bewusst nicht verfolgt.

## Format

DATEV Lohn und Gehalt — Bewegungsdaten als **Semikolon-CSV**. Die
Spaltenreihenfolge ist beim LuG-ASCII-Import frei; das Lohnbüro legt das
Importformat einmalig per ASCII-Import-Assistent fest. LODAS (starrer
`[Allgemein]`-Header) ist brüchiger und entfällt in v1.

Spalten v1:

```
Personalnummer;Datum;Lohnart;Stunden
1001;01.06.2026;100;7,75
1001;02.06.2026;100;8,25
```

- Trenner `;`, Zeilenende CRLF, eine Kopfzeile.
- Datum `TT.MM.JJJJ`.
- Stunden als deutsche Dezimalzahl mit Komma, 2 Nachkommastellen.
- Inhalt ist ASCII-rein (keine Umlaute) → keine Encoding-Stolperfallen.

## Verdichtung

15-Minuten-Blöcke werden **pro Kalendertag** zu einer Stundensumme je
(Personalnummer, Lohnart) verdichtet. Eine Zeile pro Tag.

## Konfiguration

Neue, eingeklappte Sektion im bestehenden Export-Dialog (per Default leer/zu,
damit Nicht-DATEV-Nutzer nichts davon merken):

- **Personalnummer** (Pflicht für den Lohn-Export)
- **Lohnart** (Pflicht, global fix — z.B. `100` für Normalstunden)

Werte liegen in `localStorage` unter eigenem Key (`timelog.datev.v1`), getrennt
von den Zeitdaten. Fehlt Personalnummer oder Lohnart, bricht der Lohn-Export mit
klarem Hinweis ab ("vom Lohnbüro erfragen").

## Bewusst NICHT in v1 (YAGNI)

- Per-Eintrag-Code / Kostenstelle / Mandanten-Tagging — brauchte nur der
  EO-Fall, der per Datei tot ist.
- Mehrere Lohnarten / Überstunden-Splitting — global eine Lohnart genügt für
  den Normalstunden-Fall; später nachrüstbar.
- LODAS-Format, Monatsverdichtung — später bei Bedarf.

## Nicht kaputt machen

Der bestehende xlsx-Export bleibt unverändert. Der DATEV-Code ist rein additiv:
ein zusätzlicher Button + eine eingeklappte Settings-Sektion im Export-Dialog.
Kein Eingriff ins Zeit-Datenmodell (`timelog.v1`).

## Umsetzung (index.html, single-file App)

- HTML: `<details>`-Sektion "DATEV-Lohn" (Personalnummer, Lohnart) in `modal-b`
  des `exportScrim`; zweiter Footer-Button "↓ DATEV-Lohn (.csv)".
- JS:
  - `DATEV_KEY` laden/speichern.
  - `fmtDateDE(d)` → `TT.MM.JJJJ`, `fmtHours(min)` → `"7,75"`.
  - `datevLohnRows()` → `exportRows()` nach Kalendertag gruppieren, Dauer summieren.
  - `doExportDatev()` → validieren, CSV (CRLF) bauen, als Blob herunterladen,
    `markExported()`.

## Verifikation

Playwright-Spec (Testinfra wird neu angelegt): Blöcke erzeugen, Personalnummer +
Lohnart setzen, Lohn-Export auslösen, heruntergeladene CSV prüfen (Semikolon,
Tages-Summe, Komma-Dezimal, Kopfzeile). Screenshot des Dialogs.

## Workflow

Feature-Branch → lokale Tests grün → PR → CI beobachten → babysit bis Merge.
