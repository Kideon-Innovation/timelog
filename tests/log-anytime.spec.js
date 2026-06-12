import { test, expect } from '@playwright/test';

// M7 (WCAG 2.1.1) — arbitrary time ranges must be reachable WITHOUT a mouse.
// The manual "+ Jetzt eintragen" dialog gains an optional, default-collapsed
// Datum/Von/Bis disclosure: the default stays the current slot, but editing
// the fields lets keyboard users (and mouse users backfilling) log any range,
// saved via fillRange. The Morgen-Modus ping ("WILLKOMMEN ZURÜCK") and the
// gap pings do NOT grow these fields — they stay single-purpose.

const KEY = 'timelog.v1';
const SLOT = 15 * 60000;

async function bootClean(page) {
  await page.goto('./');
  await page.evaluate((KEY) => {
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [],            // no blocks → no auto catch-up, no Morgen-Modus
      recentLabels: ['Doku'],
      settings: {
        theme: 'light', introSeen: true, soundOn: false, notifyOn: false,
        notifyNudgeDismissed: true, intervalMin: 15,
      },
    }));
  }, KEY);
  await page.reload();
  await page.waitForTimeout(1300);
  await expect(page.locator('.scrim.show')).toHaveCount(0);
}

// Open the manual dialog keyboard-only (focus + Enter on the header button).
async function openLogNowByKeyboard(page) {
  await page.locator('#logNowBtn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pingScrim.show')).toBeVisible();
  await expect(page.locator('#pingKick')).toHaveText('MANUELL EINTRAGEN');
}

// Local YYYY-MM-DD for "yesterday" computed in the page (same TZ as the app).
const yesterdayStr = (page) => page.evaluate(() => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
});

test('the manual dialog offers a collapsed Datum/Von/Bis disclosure defaulting to the current slot', async ({ page }, testInfo) => {
  // The dialog snapshots its defaults from the current slot when it opens; the
  // assertions below recompute that slot a few seconds later. Don't let a slot
  // boundary roll over in between (same guard as the other timing tests).
  const msLeft = SLOT - (Date.now() % SLOT);
  if (msLeft < 10000) await new Promise((r) => setTimeout(r, msLeft + 200));
  await bootClean(page);
  await openLogNowByKeyboard(page);

  const det = page.locator('#pingBody details.edit-split');
  await expect(det).toHaveCount(1);
  await expect(det).not.toHaveAttribute('open', '');
  await expect(det.locator('summary')).toHaveText('Anderen Zeitraum eintragen');
  if (testInfo.project.name === 'desktop') {
    await page.waitForTimeout(300); // let the scrim's .18s fade finish
    await page.screenshot({ path: 'test-results/log-anytime-collapsed.png' });
  }

  // Toggle the disclosure with the KEYBOARD (native summary behaviour).
  await det.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(det).toHaveAttribute('open', '');

  // Defaults = current slot.
  const expected = await page.evaluate(() => {
    const z = (n) => String(n).padStart(2, '0');
    const d = new Date(); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    const e = new Date(d.getTime() + 15 * 60000);
    return {
      date: d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()),
      from: z(d.getHours()) + ':' + z(d.getMinutes()),
      to: z(e.getHours()) + ':' + z(e.getMinutes()),
    };
  });
  await expect(page.locator('#pingDate')).toHaveValue(expected.date);
  await expect(page.locator('#pingFrom')).toHaveValue(expected.from);
  await expect(page.locator('#pingTo')).toHaveValue(expected.to);
  if (testInfo.project.name === 'desktop') {
    await page.screenshot({ path: 'test-results/log-anytime-expanded.png' });
  }
});

test('keyboard backfill: yesterday 09:00–10:00 is saved across the full hour', async ({ page }) => {
  await bootClean(page);
  await openLogNowByKeyboard(page);

  const det = page.locator('#pingBody details.edit-split');
  await det.locator('summary').focus();
  await page.keyboard.press('Enter');

  const yd = await yesterdayStr(page);
  await page.locator('#pingDate').fill(yd);
  await page.locator('#pingFrom').fill('09:00');
  await page.locator('#pingTo').fill('10:00');
  const label = page.locator('#pingBody input.txt').first();
  await label.fill('Akte Schmidt');
  await label.press('Enter'); // keyboard commit

  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  const blocks = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks, KEY);
  expect(blocks.length).toBe(4); // 1h on the 15-min grid
  const starts = blocks.map((b) => b.start.slice(0, 16)).sort();
  expect(starts).toEqual([yd + 'T09:00', yd + 'T09:15', yd + 'T09:30', yd + 'T09:45']);
  expect(blocks.every((b) => b.label === 'Akte Schmidt')).toBe(true);
});

test('untouched fields keep logging the current slot (default unchanged)', async ({ page }) => {
  // Don't let the live slot roll over between open and commit.
  const msLeft = SLOT - (Date.now() % SLOT);
  if (msLeft < 10000) await new Promise((r) => setTimeout(r, msLeft + 200));
  await bootClean(page);
  await openLogNowByKeyboard(page);

  const label = page.locator('#pingBody input.txt').first();
  await label.fill('Doku');
  await label.press('Enter');

  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  const saved = await page.evaluate((KEY) => {
    const { blocks } = JSON.parse(localStorage.getItem(KEY));
    const d = new Date(); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    return { blocks, curMs: d.getTime() };
  }, KEY);
  expect(saved.blocks.length).toBe(1);
  expect(new Date(saved.blocks[0].start).getTime()).toBe(saved.curMs);
  expect(saved.blocks[0].label).toBe('Doku');
});

test('an inverted range is rejected: dialog stays open, nothing saved', async ({ page }) => {
  await bootClean(page);
  await openLogNowByKeyboard(page);

  const det = page.locator('#pingBody details.edit-split');
  await det.locator('summary').click();
  await page.locator('#pingFrom').fill('14:00');
  await page.locator('#pingTo').fill('13:00');
  const label = page.locator('#pingBody input.txt').first();
  await label.fill('Akte Schmidt');
  await label.press('Enter');

  await expect(page.locator('#pingScrim.show')).toBeVisible(); // NOT closed
  await expect(page.locator('#toast')).toHaveClass(/show/);
  const blocks = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks, KEY);
  expect(blocks.length).toBe(0);
});

test('the Morgen-Modus ping does NOT expose the range fields', async ({ page }) => {
  await page.goto('./');
  const hour = await page.evaluate(() => new Date().getHours());
  test.skip(hour < 6, 'before 06:00 local — morning mode cannot be active');

  await page.evaluate((KEY) => {
    const s = new Date(); s.setDate(s.getDate() - 1); s.setHours(23, 0, 0, 0);
    const e = new Date(s.getTime() + 15 * 60000);
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [{ id: 'n1', start: s.toISOString(), end: e.toISOString(), label: 'Spät' }],
      recentLabels: ['Doku'],
      settings: {
        theme: 'light', introSeen: true, soundOn: false, notifyOn: false,
        notifyNudgeDismissed: true, intervalMin: 15,
      },
    }));
  }, KEY);
  await page.reload();
  await page.waitForTimeout(1300);

  await expect(page.locator('#pingScrim.show')).toBeVisible();
  await expect(page.locator('#pingKick')).toHaveText('WILLKOMMEN ZURÜCK');
  await expect(page.locator('#pingBody details')).toHaveCount(0);
  await expect(page.locator('#pingDate')).toHaveCount(0);
});
