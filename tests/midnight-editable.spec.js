import { test, expect } from '@playwright/test';

// Regression for the "00:00–01:00 is not editable" bug.
//
// The day column heads are position:sticky;top:0. Originally the timeline content
// (hour lines, blocks, the drag surface) was painted at top:0 of the SAME box as
// the head, so midnight sat *behind* the opaque sticky head — with no scroll
// position where it could ever surface. You could neither drag-select a midnight
// slot nor click an existing midnight block to edit it.
//
// The fix flows the timeline into a .daybody that sits BELOW the head in normal
// flow, so 00:00 lands just under the head and is reachable. These tests pin
// that: a midnight block must render clear of the head, be clickable into the
// edit dialog, and a drag at the very top of the column must create a 00:00 entry.

const KEY = 'timelog.v1';

async function seed(page, blocks = []) {
  await page.goto('./');
  await page.evaluate(({ blocks, KEY }) => {
    localStorage.setItem(KEY, JSON.stringify({
      blocks,
      recentLabels: ['Mandant Müller', 'Doku', 'Telefonat'],
      settings: { theme: 'light', introSeen: true, soundOn: true, notifyOn: false, intervalMin: 15 },
    }));
  }, { blocks, KEY });
  await page.reload();
  await page.waitForTimeout(1100); // boot() may auto-open a catch-up after ~900ms
}

async function closeAnyModal(page) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.scrim.show').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

// A 00:00–00:15 block on today, built in local time so it lands at midnight.
function midnightBlock(label) {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(s.getTime() + 15 * 60000);
  return { start: s.toISOString(), end: e.toISOString(), label };
}

// Scroll the calendar to the very top so midnight is the topmost timeline row.
async function scrollCalTop(page) {
  await page.locator('#calWrap').evaluate(el => el.scrollTo(0, 0));
  await page.waitForTimeout(50);
}

test('a 00:00 block renders clear of the sticky day head (not occluded)', async ({ page }) => {
  const label = 'Mitternacht-' + Date.now();
  await seed(page, [midnightBlock(label)]);
  await closeAnyModal(page);
  await scrollCalTop(page);

  const block = page.locator('#cal .daycol.today .block', { hasText: label }).first();
  await expect(block).toHaveCount(1);

  // The block's top edge must sit at or below the head's bottom edge. Pre-fix it
  // sat behind the head (blockTop < headBottom), which is exactly what made
  // midnight uneditable.
  const clear = await page.locator('#cal .daycol.today').first().evaluate((col) => {
    const head = col.querySelector('.col-head').getBoundingClientRect();
    const blk = col.querySelector('.block').getBoundingClientRect();
    return blk.top >= head.bottom - 1;
  });
  expect(clear).toBe(true);
});

test('clicking a 00:00 block opens the edit dialog', async ({ page }) => {
  const label = 'Edit-Mitternacht-' + Date.now();
  await seed(page, [midnightBlock(label)]);
  await closeAnyModal(page);
  await scrollCalTop(page);

  // If the head still covered midnight, Playwright's actionability check would
  // report the click intercepted by .col-head — so this both opens the dialog
  // and proves the block is reachable.
  await page.locator('#cal .daycol.today .block', { hasText: label }).first().click();
  await expect(page.locator('#editScrim.show')).toHaveCount(1);
});

test('drag-selecting at the top of the column creates a 00:00 entry', async ({ page }, testInfo) => {
  // Mouse press-drag is desktop-only (touch needs a long-press page.mouse can't fake).
  test.skip(testInfo.project.name !== 'desktop', 'drag-select gesture is desktop (mouse) only');
  await seed(page);
  await closeAnyModal(page);
  await scrollCalTop(page);

  // Drag inside the midnight band: just below the head, at the very top of the
  // timeline body. Pre-fix this region was behind the head and the drag handler
  // bailed out (pointerdown landed on .col-head), so no selection was possible.
  const span = await page.locator('#cal .daycol.today .daybody').first().evaluate((body) => {
    const r = body.getBoundingClientRect();
    return { x: r.left + r.width / 2, top: r.top };
  });
  const x = span.x, y1 = span.top + 4, y2 = span.top + 40;
  await page.mouse.move(x, y1);
  await page.mouse.down();
  await page.mouse.move(x, y1 + 12);
  await page.mouse.move(x, y2);
  await page.mouse.up();

  await expect(page.locator('#pingScrim.show')).toHaveCount(1);
  await expect(page.locator('#pingKick')).toHaveText('ZEITRAUM EINTRAGEN');

  const label = 'Drag-Mitternacht-' + Date.now();
  await page.locator('#pingScrim #pingBody input.txt').fill(label);
  await page.locator('#pingScrim #pingFoot button.amber').click();

  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  const stored = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  const created = stored.blocks.find((b) => b.label === label);
  expect(created).toBeTruthy();
  // The selection started at the very top of the day → the entry begins at 00:00.
  expect(new Date(created.start).getHours()).toBe(0);
  expect(new Date(created.start).getMinutes()).toBe(0);
});
