import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Three 15-min blocks on 2026-06-02 (= 0,75 h) and one on 2026-06-03 (= 0,25 h).
// Proves per-day aggregation, German comma decimal, and the column layout.
const SEED = {
  blocks: [
    { id: 'b1', start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T09:15:00.000Z', label: 'A' },
    { id: 'b2', start: '2026-06-02T09:15:00.000Z', end: '2026-06-02T09:30:00.000Z', label: 'A' },
    { id: 'b3', start: '2026-06-02T09:30:00.000Z', end: '2026-06-02T09:45:00.000Z', label: 'B' },
    { id: 'b4', start: '2026-06-03T09:00:00.000Z', end: '2026-06-03T09:15:00.000Z', label: 'C' },
  ],
  recentLabels: [],
  settings: { intervalMin: 15, soundOn: false, notifyOn: false, introSeen: true,
    notifyNudgeDismissed: true, exportReminderDay: '', exportNotifyDay: '', theme: 'light' },
};

test('DATEV-Lohn export writes per-day semicolon CSV', async ({ page }) => {
  await page.addInitScript((seed) => {
    localStorage.setItem('timelog.v1', JSON.stringify(seed));
  }, SEED);
  await page.goto('/');

  // Open the export dialog directly (menu navigation is irrelevant to this feature).
  await page.evaluate(() => document.getElementById('exportScrim').classList.add('show'));

  await page.evaluate(() => { document.getElementById('datevDetails').open = true; });
  await page.fill('#datevPnr', '1001');
  await page.fill('#datevLa', '100');
  await page.screenshot({ path: 'test-results/datev-dialog.png' });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#expDatev'),
  ]);

  expect(download.suggestedFilename()).toBe('datev_lohn_2026-06-02_bis_2026-06-03.csv');
  const csv = readFileSync(await download.path(), 'utf8');

  expect(csv).toBe(
    'Personalnummer;Datum;Lohnart;Stunden\r\n' +
    '1001;02.06.2026;100;0,75\r\n' +
    '1001;03.06.2026;100;0,25\r\n'
  );
});

test('DATEV-Lohn export refuses without Personalnummer/Lohnart', async ({ page }) => {
  await page.addInitScript((seed) => {
    localStorage.setItem('timelog.v1', JSON.stringify(seed));
  }, SEED);
  await page.goto('/');
  await page.evaluate(() => document.getElementById('exportScrim').classList.add('show'));

  let downloadStarted = false;
  page.on('download', () => { downloadStarted = true; });
  await page.click('#expDatev');

  await expect(page.locator('#toast')).toContainText('Personalnummer und Lohnart');
  expect(downloadStarted).toBe(false);
});

// QA finding N3: a ";" inside Personalnummer/Lohnart would shift the CSV
// columns (6 instead of 4) and DATEV Lohn und Gehalt would misread the file.
// Both fields are digits-only by definition → refuse anything else with the
// same toast mechanism as missing fields.
test('DATEV-Lohn export refuses non-digit Personalnummer/Lohnart (CSV injection)', async ({ page }) => {
  await page.addInitScript((seed) => {
    localStorage.setItem('timelog.v1', JSON.stringify(seed));
  }, SEED);
  await page.goto('/');
  await page.evaluate(() => document.getElementById('exportScrim').classList.add('show'));
  await page.evaluate(() => { document.getElementById('datevDetails').open = true; });
  await page.fill('#datevPnr', '10;01');
  await page.fill('#datevLa', '1;00');

  let downloadStarted = false;
  page.on('download', () => { downloadStarted = true; });
  await page.click('#expDatev');

  await expect(page.locator('#toast')).toContainText('nur Ziffern');
  expect(downloadStarted).toBe(false);
  // The dialog stays open with the details section expanded so the user can fix it.
  await expect(page.locator('#datevDetails')).toHaveAttribute('open', '');
});
