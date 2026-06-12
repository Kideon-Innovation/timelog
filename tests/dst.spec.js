import { test, expect } from '@playwright/test';

// QA finding N5 — DST spring-forward day (Europe/Berlin: 2026-03-29).
//
// The drag layer's naive `setMinutes(idx*slotMin)` maps the visually selected
// (but nonexistent) 02:00–03:00 hour onto 03:00–04:00 — the SAME times the real
// 03:00 slots produce. Committing such a gesture lands one hour later than what
// the user saw and clearRange-overwrites (or zero-lengths) their real 03:00
// data. The fix refuses those commits with a toast instead.
//
// Mouse drags → desktop project only (same convention as drag-resize-move.spec).

test.use({ timezoneId: 'Europe/Berlin' });

const PX_PER_MIN = 116 / 60;          // mirrors state.js HOUR_PX/PX_PER_MIN
const SLOT_PX = 15 * PX_PER_MIN;

// Pin "now" to noon on the spring-forward day; seed a victim block in the real
// 03:00 hour plus a past block ending at the current slot (gapSlots() === [],
// morningMode() === false → no auto-ping intercepts the pointer).
async function seedDstDay(page) {
  await page.clock.install({ time: new Date('2026-03-29T12:00:00+02:00') });
  await page.goto('./');
  await page.evaluate(() => {
    const SLOT = 15 * 60000;
    const cur = Math.floor(Date.now() / SLOT) * SLOT;
    localStorage.setItem('timelog.v1', JSON.stringify({
      blocks: [
        { id: 'v', start: '2026-03-29T03:00:00', end: '2026-03-29T04:00:00', label: 'Opfer' },
        { id: 'p', start: new Date(cur - SLOT).toISOString(), end: new Date(cur).toISOString(), label: 'Past' },
      ],
      recentLabels: ['Opfer'],
      settings: { theme: 'light', introSeen: true, soundOn: false, notifyOn: false,
        intervalMin: 15, notifyNudgeDismissed: true, exportReminderDay: '', exportNotifyDay: '' },
    }));
  });
  await page.reload();
  await page.waitForTimeout(1100);               // past the boot ~900ms catch-up window
  for (const _ of [0, 1]) {
    if (await page.locator('.scrim.show').count()) await page.keyboard.press('Escape');
  }
  // Bring the 02:00–04:00 rows into the viewport (scrollToNow parked us at noon).
  await page.evaluate(() => document.getElementById('calWrap').scrollTo(0, 0));
}

async function readBlocks(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).blocks
    .map(b => ({ start: b.start, end: b.end, label: b.label }))
    .sort((a, b) => a.start.localeCompare(b.start)));
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'mouse-pointer drags run on the desktop project');
});

test('range-select in the phantom 02:00 hour is refused — no entry dialog at 03:00', async ({ page }) => {
  await seedDstDay(page);
  const grid = page.locator('.daycol.today .daygrid');
  const box = await grid.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + 120 * PX_PER_MIN + 4;        // inside the visual 02:00 slot
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + SLOT_PX, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator('#toast')).toContainText('Zeitumstellung');
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);  // no entry dialog
  // Nothing was written; the real 03:00 block is untouched.
  const blocks = await readBlocks(page);
  expect(blocks).toContainEqual(
    { start: '2026-03-29T03:00:00', end: '2026-03-29T04:00:00', label: 'Opfer' });
  expect(blocks.length).toBe(2);
});

test('moving a block onto the phantom 02:00 hour is refused — block stays put', async ({ page }) => {
  await seedDstDay(page);
  const block = page.locator('#cal .block').filter({ hasText: 'Opfer' }).first();
  await expect(block).toBeVisible();
  const box = await block.boundingBox();
  const x = box.x + box.width / 2, y0 = box.y + box.height / 2;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x, y0 - 4 * SLOT_PX, { steps: 8 });      // 03:00 → visual 02:00
  await page.mouse.up();

  await expect(page.locator('#toast')).toContainText('Zeitumstellung');
  const blocks = await readBlocks(page);
  expect(blocks).toContainEqual(
    { start: '2026-03-29T03:00:00', end: '2026-03-29T04:00:00', label: 'Opfer' });
  expect(blocks.length).toBe(2);
});
