import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Pin the timezone so the app's local-time iso()/hhmm() formatting is
// deterministic across machines (export writes local HH:MM, import re-parses
// as local — the round-trip is only stable within a fixed zone).
test.use({ timezoneId: 'Europe/Berlin' });

// Three blocks. The 3rd is the midnight-wrap case: 23:45 → 00:00 of the next
// day. The app stores it as end = next-day 00:00; the export prints "00:00" as
// the end time, and the import must wrap it back to the next day (not collapse
// it to a zero/negative-length block). Times are timezone-naive local strings,
// exactly the shape iso() produces in the running app.
const SEED = {
  blocks: [
    { id: 'b1', start: '2026-06-02T09:00:00', end: '2026-06-02T09:15:00', label: 'Mandant Müller' },
    { id: 'b2', start: '2026-06-02T09:15:00', end: '2026-06-02T09:30:00', label: 'Akte 4711' },
    { id: 'b3', start: '2026-06-02T23:45:00', end: '2026-06-03T00:00:00', label: 'Spätschicht' },
  ],
  recentLabels: [],
  settings: { intervalMin: 15, soundOn: false, notifyOn: false, introSeen: true,
    notifyNudgeDismissed: true, exportReminderDay: '', exportNotifyDay: '', theme: 'light' },
};

test('Excel export → import round-trip restores all blocks (incl. midnight wrap)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript((seed) => {
    localStorage.setItem('timelog.v1', JSON.stringify(seed));
  }, SEED);
  await page.goto('/');

  // XLSX must be available as a global for export/import to work at all.
  expect(await page.evaluate(() => typeof window.XLSX)).toBe('object');

  // --- EXPORT ---
  await page.evaluate(() => document.getElementById('exportScrim').classList.add('show'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#expGo'),
  ]);
  expect(download.suggestedFilename()).toBe('kideon_time_2026-06-02_bis_2026-06-02.xlsx');
  const xlsxPath = await download.path();
  const bytes = readFileSync(xlsxPath);

  // A valid .xlsx is a ZIP: starts with "PK\x03\x04" and is non-trivial in size.
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes[0]).toBe(0x50); // 'P'
  expect(bytes[1]).toBe(0x4b); // 'K'

  // Parse the produced workbook IN THE BROWSER (proves window.XLSX can read its
  // own output) and assert the cell contents are the expected human-readable rows.
  const b64 = bytes.toString('base64');
  const sheet = await page.evaluate((b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const wb = window.XLSX.read(arr, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  }, b64);

  expect(sheet[0]).toEqual(['Datum', 'Wochentag', 'Start', 'Ende', 'Dauer (min)', 'Tätigkeit']);
  // 3 data rows.
  expect(sheet.length).toBe(4);
  // Midnight-wrap row: end printed as 00:00, duration 15 min.
  const wrapRow = sheet.find((r) => r[5] === 'Spätschicht');
  expect(wrapRow).toBeTruthy();
  expect(wrapRow[2]).toBe('23:45');
  expect(wrapRow[3]).toBe('00:00');
  expect(String(wrapRow[4])).toBe('15');

  // --- IMPORT into a fresh, empty app ---
  // Open a SECOND page in the same context that seeds an EMPTY store before the
  // app boots (its own init script wins; the first page's seed does not apply
  // here). This proves import repopulates from nothing.
  //
  // The exporting page must be CLOSED first: since the cross-tab storage
  // protection (QA C1), a still-open instance treats an external wipe of
  // timelog.v1 (page2's empty init seed carries no savedAt stamp) as an
  // untrusted deletion and writes its blocks back — by design, two open
  // instances can never lose blocks. Import-into-empty needs a lone tab.
  const context = page.context();
  await page.close();
  const page2 = await context.newPage();
  page2.on('pageerror', (e) => errors.push(String(e)));
  await page2.addInitScript(() => {
    localStorage.setItem('timelog.v1', JSON.stringify({
      blocks: [], recentLabels: [],
      settings: { intervalMin: 15, soundOn: false, notifyOn: false, introSeen: true,
        notifyNudgeDismissed: true, exportReminderDay: '', exportNotifyDay: '', theme: 'light' },
    }));
  });
  await page2.goto('/');
  // Start empty.
  expect(await page2.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).blocks.length)).toBe(0);

  await page2.setInputFiles('#importFile', xlsxPath);

  // Import succeeded toast.
  await expect(page2.locator('#toast')).toContainText('Importiert: 3');

  // State must contain exactly the 3 round-tripped blocks with stable start/end/label.
  const blocks = await page2.evaluate(() =>
    JSON.parse(localStorage.getItem('timelog.v1')).blocks
      .map((b) => ({ start: b.start, end: b.end, label: b.label }))
      .sort((a, b) => a.start.localeCompare(b.start)));

  expect(blocks).toEqual([
    { start: '2026-06-02T09:00:00', end: '2026-06-02T09:15:00', label: 'Mandant Müller' },
    { start: '2026-06-02T09:15:00', end: '2026-06-02T09:30:00', label: 'Akte 4711' },
    // midnight wrap restored to next-day 00:00 (NOT collapsed/negative).
    { start: '2026-06-02T23:45:00', end: '2026-06-03T00:00:00', label: 'Spätschicht' },
  ]);

  // The imported blocks must actually render on the calendar. Jump the visible
  // window to the imported blocks' day (2026-06-02) via the date picker.
  await page2.evaluate(() => {
    const dp = document.getElementById('datePick');
    dp.value = '2026-06-02';
    dp.dispatchEvent(new Event('change'));
  });
  const labelsOnCalendar = await page2.evaluate(() =>
    Array.from(document.querySelectorAll('.block')).map((el) => el.textContent).join(' '));
  expect(labelsOnCalendar).toContain('Mandant Müller');
  expect(labelsOnCalendar).toContain('Spätschicht');

  expect(errors, 'no uncaught page errors').toEqual([]);
});
