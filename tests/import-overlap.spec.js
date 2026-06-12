import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The app reads/writes local time; pin the zone so date serials map to the
// expected calendar day and the day total is deterministic.
test.use({ timezoneId: 'Europe/Berlin' });

// Pre-seed FINER blocks across 09:00–10:00 (four 15-min slots = 1h on 2026-06-02)
// plus an untouched block later in the day. Then import a COARSE row 09:00–11:00.
// Before the fix, applyImport() only overwrote the block whose start EXACTLY
// matched 09:00 — leaving 09:15/09:30/09:45 behind. The imported 09:00–11:00
// block then overlapped them: blocks render stacked/hidden AND the day total
// double-counts (45m leftover + 2h import = 2h 45m for an actual 2h span).
const SEED = {
  blocks: [
    { id: 'a', start: '2026-06-02T09:00:00', end: '2026-06-02T09:15:00', label: 'Fein A' },
    { id: 'b', start: '2026-06-02T09:15:00', end: '2026-06-02T09:30:00', label: 'Fein B' },
    { id: 'c', start: '2026-06-02T09:30:00', end: '2026-06-02T09:45:00', label: 'Fein C' },
    { id: 'd', start: '2026-06-02T09:45:00', end: '2026-06-02T10:00:00', label: 'Fein D' },
    // Untouched block, well outside the imported range — must survive verbatim.
    { id: 'z', start: '2026-06-02T14:00:00', end: '2026-06-02T14:15:00', label: 'Unberührt' },
  ],
  recentLabels: [],
  settings: { intervalMin: 15, soundOn: false, notifyOn: false, introSeen: true,
    notifyNudgeDismissed: true, exportReminderDay: '', exportNotifyDay: '', theme: 'light' },
};

// True when any two blocks on the same day overlap in time (open intervals).
function hasOverlap(blocks) {
  const sorted = [...blocks].sort((x, y) => x.start.localeCompare(y.start));
  for (let i = 1; i < sorted.length; i++) {
    if (new Date(sorted[i].start).getTime() < new Date(sorted[i - 1].end).getTime()) return true;
  }
  return false;
}

test('coarse import over finer blocks replaces the full range — no overlaps, correct day total', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript((s) => localStorage.setItem('timelog.v1', JSON.stringify(s)), SEED);
  await page.goto('/');

  // Build a coarse import row: 09:00–11:00 (2h), text shape like the app's own
  // export (German date + HH:MM strings).
  const b64 = await page.evaluate(() => {
    const X = window.XLSX;
    const aoa = [
      ['Datum', 'Wochentag', 'Start', 'Ende', 'Dauer (min)', 'Tätigkeit'],
      ['02.06.2026', 'Di', '09:00', '11:00', 120, 'Grob-Import'],
    ];
    const ws = X.utils.aoa_to_sheet(aoa);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'TimeLog');
    const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
    let bin = '';
    const arr = new Uint8Array(buf);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  });

  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
  const file = join(dir, 'coarse.xlsx');
  writeFileSync(file, Buffer.from(b64, 'base64'));

  await page.setInputFiles('#importFile', file);
  await expect(page.locator('#toast')).toContainText('Importiert: 1');

  const blocks = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('timelog.v1')).blocks
      .map((b) => ({ start: b.start, end: b.end, label: b.label }))
      .sort((a, b) => a.start.localeCompare(b.start)));

  // No leftover finer blocks inside the imported span — the coarse row fully
  // replaced 09:00–11:00.
  expect(hasOverlap(blocks), 'imported range must leave no overlapping blocks').toBe(false);

  // The finer blocks that lived inside 09:00–11:00 are gone; the untouched
  // 14:00 block survives; the imported 09:00–11:00 block is present.
  expect(blocks).toEqual([
    { start: '2026-06-02T09:00:00', end: '2026-06-02T11:00:00', label: 'Grob-Import' },
    { start: '2026-06-02T14:00:00', end: '2026-06-02T14:15:00', label: 'Unberührt' },
  ]);

  // Day total = 2h (import) + 15m (untouched) = 2h 15m — NOT 3h (double-count).
  await page.evaluate(() => {
    const dp = document.getElementById('datePick');
    dp.value = '2026-06-02';
    dp.dispatchEvent(new Event('change'));
  });
  const totals = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.col-head .tot')).map((el) => el.textContent.trim()));
  expect(totals).toContain('2h 15m');

  expect(errors).toEqual([]);
});

// An imported xlsx can carry blocks FINER than the app's slot granularity (the
// in-app minimum interval is 6 min). A hand-crafted row like 09:01–09:04 (3 min)
// or boundaries that don't sit on the slot grid produced sub-slot blocks. Those
// hit the min-height clamp in ui/calendar.js (Math.max(11, mins*PX-3)) so two
// consecutive sub-slot blocks paint on top of each other as an unreadable
// smear. applyImport() must SNAP imported boundaries to the active slot grid
// (floor start / ceil end) so imported blocks share the in-app data model:
// slot-aligned, non-overlapping, each tall enough to read.
test('sub-slot import rows snap to the slot grid — no sub-6-min smear, no overlap', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Empty store, slot size = 6 min (the app minimum).
  await page.addInitScript(() => localStorage.setItem('timelog.v1', JSON.stringify({
    blocks: [], recentLabels: [],
    settings: { intervalMin: 6, soundOn: false, notifyOn: false, introSeen: true,
      notifyNudgeDismissed: true, exportReminderDay: '', exportNotifyDay: '', theme: 'light' },
  })));
  await page.goto('/');

  // Two sub-slot rows whose boundaries are off the 6-min grid:
  //   09:01–09:04 (3 min)  -> snaps to 09:00–09:06
  //   09:10–09:13 (3 min)  -> snaps to 09:06–09:18
  const b64 = await page.evaluate(() => {
    const X = window.XLSX;
    const aoa = [
      ['Datum', 'Wochentag', 'Start', 'Ende', 'Dauer (min)', 'Tätigkeit'],
      ['02.06.2026', 'Di', '09:01', '09:04', 3, 'Fein-Import A'],
      ['02.06.2026', 'Di', '09:10', '09:13', 3, 'Fein-Import B'],
    ];
    const ws = X.utils.aoa_to_sheet(aoa);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'TimeLog');
    const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
    let bin = '';
    const arr = new Uint8Array(buf);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  });

  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
  const file = join(dir, 'subslot.xlsx');
  writeFileSync(file, Buffer.from(b64, 'base64'));

  await page.setInputFiles('#importFile', file);
  await expect(page.locator('#toast')).toContainText('Importiert: 2');

  const blocks = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('timelog.v1')).blocks
      .map((b) => ({ start: b.start, end: b.end, label: b.label }))
      .sort((a, b) => a.start.localeCompare(b.start)));

  // Every stored boundary sits on the 6-min grid (minutes divisible by 6, secs 0).
  for (const b of blocks) {
    for (const t of [b.start, b.end]) {
      const m = new Date(t).getMinutes();
      expect(m % 6, `${t} must be on the 6-min slot grid`).toBe(0);
      expect(new Date(t).getSeconds()).toBe(0);
    }
    // No block is shorter than one slot (sub-slot smear is impossible).
    expect((new Date(b.end) - new Date(b.start)) / 60000).toBeGreaterThanOrEqual(6);
  }

  // Exact snapped result: floor(start) / ceil(end) to the 6-min grid.
  expect(blocks).toEqual([
    { start: '2026-06-02T09:00:00', end: '2026-06-02T09:06:00', label: 'Fein-Import A' },
    { start: '2026-06-02T09:06:00', end: '2026-06-02T09:18:00', label: 'Fein-Import B' },
  ]);

  // No overlap (open intervals).
  expect(hasOverlap(blocks)).toBe(false);

  // And they render readably: each .block is at least the clamp height and no
  // two blocks share the same top (the smear symptom).
  await page.evaluate(() => {
    const dp = document.getElementById('datePick');
    dp.value = '2026-06-02';
    dp.dispatchEvent(new Event('change'));
  });
  const rects = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.block')).map((el) => ({
      top: el.style.top, height: parseFloat(el.style.height),
    })));
  expect(rects.length).toBe(2);
  expect(new Set(rects.map((r) => r.top)).size, 'blocks must not stack at the same top').toBe(2);

  expect(errors).toEqual([]);
});

// QA finding M5: the old midnight heuristic (`if (end <= start) end += 24h`)
// turned typo rows into silent monster blocks — 09:00–09:00 became a 24h block,
// 14:00–13:00 a 23h block. Inverted/equal daytime times must be SKIPPED and
// reported via the existing "n übersprungen" toast; genuine overnight rows
// (end shortly after midnight, block < 12h) still cross midnight.
test('inverted/equal time rows are skipped — never silent 24h blocks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(() => localStorage.setItem('timelog.v1', JSON.stringify({
    blocks: [], recentLabels: [],
    settings: { intervalMin: 15, soundOn: false, notifyOn: false, introSeen: true,
      notifyNudgeDismissed: true, exportReminderDay: '', exportNotifyDay: '', theme: 'light' },
  })));
  await page.goto('/');

  const b64 = await page.evaluate(() => {
    const X = window.XLSX;
    const aoa = [
      ['Datum', 'Wochentag', 'Start', 'Ende', 'Dauer (min)', 'Tätigkeit'],
      ['02.06.2026', 'Di', '09:00', '10:00', 60, 'Gültig'],
      ['02.06.2026', 'Di', '09:00', '09:00', 0, 'Tippfehler gleich'],   // would be 24h
      ['02.06.2026', 'Di', '14:00', '13:00', 0, 'Tippfehler invers'],   // would be 23h
      ['02.06.2026', 'Di', '23:45', '00:00', 15, 'Echt über Mitternacht'],
    ];
    const ws = X.utils.aoa_to_sheet(aoa);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'TimeLog');
    const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
    let bin = '';
    const arr = new Uint8Array(buf);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  });

  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
  const file = join(dir, 'inverted.xlsx');
  writeFileSync(file, Buffer.from(b64, 'base64'));

  await page.setInputFiles('#importFile', file);
  // 2 valid rows in, 2 typo rows skipped + reported.
  await expect(page.locator('#toast')).toContainText('Importiert: 2 Blöcke (2 übersprungen)');

  const blocks = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('timelog.v1')).blocks
      .map((b) => ({ start: b.start, end: b.end, label: b.label }))
      .sort((a, b) => a.start.localeCompare(b.start)));

  expect(blocks).toEqual([
    { start: '2026-06-02T09:00:00', end: '2026-06-02T10:00:00', label: 'Gültig' },
    { start: '2026-06-02T23:45:00', end: '2026-06-03T00:00:00', label: 'Echt über Mitternacht' },
  ]);
  // Belt and braces: nothing remotely day-sized was created.
  for (const b of blocks) {
    expect((new Date(b.end) - new Date(b.start)) / 3600000).toBeLessThan(12);
  }

  expect(errors).toEqual([]);
});
