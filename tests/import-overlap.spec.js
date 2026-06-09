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
