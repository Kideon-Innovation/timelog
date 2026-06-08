import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Europe/Berlin: the app reads/writes local time; pin it so date serials map
// to the expected calendar day.
test.use({ timezoneId: 'Europe/Berlin' });

const EMPTY_STORE = {
  blocks: [], recentLabels: [],
  settings: { intervalMin: 15, soundOn: false, notifyOn: false, introSeen: true,
    notifyNudgeDismissed: true, exportReminderDay: '', exportNotifyDay: '', theme: 'light' },
};

// Reproduces joerg's broken import: a workbook that has been opened/edited and
// re-saved in REAL Microsoft Excel. Excel stores the "Datum" column as a true
// date cell — so on re-read the Datum value comes back as an Excel serial
// number ("46175"), and the Start/Ende as time cells, NOT as the German text
// strings the app's own export writes. The import must still restore the blocks.
test('imports an .xlsx with Excel-native date/time cells (edited-in-Excel file)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript((s) => localStorage.setItem('timelog.v1', JSON.stringify(s)), EMPTY_STORE);
  await page.goto('/');

  // Build an Excel-TYPED workbook (date + time cells), exactly what Excel emits
  // after a save, and return its bytes.
  const b64 = await page.evaluate(() => {
    const X = window.XLSX;
    const aoa = [
      ['Datum', 'Wochentag', 'Start', 'Ende', 'Dauer (min)', 'Tätigkeit'],
      [new Date(2026, 5, 2), 'Di', new Date(2026, 5, 2, 9, 0), new Date(2026, 5, 2, 9, 15), 15, 'Akte 4711'],
      // midnight wrap: 23:45 → 00:00
      [new Date(2026, 5, 2), 'Di', new Date(2026, 5, 2, 23, 45), new Date(2026, 5, 2, 0, 0), 15, 'Spätschicht'],
    ];
    const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true });
    ws['A2'].z = 'dd.mm.yyyy'; ws['A3'].z = 'dd.mm.yyyy';
    ws['C2'].z = 'hh:mm'; ws['D2'].z = 'hh:mm';
    ws['C3'].z = 'hh:mm'; ws['D3'].z = 'hh:mm';
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'TimeLog');
    const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
    let bin = '';
    const arr = new Uint8Array(buf);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  });

  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
  const file = join(dir, 'edited-in-excel.xlsx');
  writeFileSync(file, Buffer.from(b64, 'base64'));

  await page.setInputFiles('#importFile', file);

  await expect(page.locator('#toast')).toContainText('Importiert: 2');

  const blocks = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('timelog.v1')).blocks
      .map((b) => ({ start: b.start, end: b.end, label: b.label }))
      .sort((a, b) => a.start.localeCompare(b.start)));

  expect(blocks).toEqual([
    { start: '2026-06-02T09:00:00', end: '2026-06-02T09:15:00', label: 'Akte 4711' },
    { start: '2026-06-02T23:45:00', end: '2026-06-03T00:00:00', label: 'Spätschicht' },
  ]);

  expect(errors).toEqual([]);
});
