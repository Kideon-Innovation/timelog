import { test, expect } from '@playwright/test';

// Regression for the "dead midnight row" bug: the sticky .col-head used to be
// painted ON TOP of the first hour row (00:00–01:00 sat at top:0 inside the same
// column), so a press-drag or tap at 00:00 / 00:30 hit the header and never
// reached the grid — the user could not log anything in the first hour.
//
// The fix moves the absolutely-positioned hour grid into a .daygrid wrapper that
// sits in normal flow BELOW the header, so slot 0 starts clear of the header.
// These tests assert (a) the structural invariant — the grid begins at/after the
// header's bottom — and (b) the behaviour — drag-creating at 00:00 and at 00:30
// produces a block at exactly that time.

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
  await page.waitForTimeout(1100);
}

async function closeAnyModal(page) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.scrim.show').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

test('the hour grid begins at/below the sticky header — no midnight dead zone', async ({ page }) => {
  await seed(page);
  await closeAnyModal(page);

  // Scroll the calendar all the way up so the 00:00 row is in view.
  await page.locator('#calWrap').evaluate((w) => w.scrollTo({ top: 0 }));
  await page.waitForTimeout(50);

  const geom = await page.locator('#cal .daycol.today').first().evaluate((col) => {
    const head = col.querySelector('.col-head');
    const grid = col.querySelector('.daygrid');
    return {
      headBottom: head.getBoundingClientRect().bottom,
      gridTop: grid.getBoundingClientRect().top,
    };
  });

  // The grid's top edge (slot 0 = 00:00) must not be hidden under the header.
  // Allow a sub-pixel rounding fudge.
  expect(geom.gridTop).toBeGreaterThanOrEqual(geom.headBottom - 1);
});

// Drag-create at a precise time at the very top of the grid. Mouse-only: touch
// requires the ~260ms long-press the harness can't faithfully emulate.
test('drag-create at 00:00 and at 00:30 in the first hour produces blocks at the right time', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'drag-select gesture is desktop (mouse) only');
  await seed(page);
  await closeAnyModal(page);

  // Make the very top of the day grid (00:00) visible.
  await page.locator('#calWrap').evaluate((w) => w.scrollTo({ top: 0 }));
  await page.waitForTimeout(50);

  const grid = page.locator('#cal .daycol.today .daygrid').first();

  // Helper: drag inside the grid from pixel offset y0 down by `slots` 15-min
  // slots, commit with `label`, and return the stored block start "HH:MM".
  async function dragCreate(yOffset, label) {
    const box = await grid.evaluate((g) => {
      const r = g.getBoundingClientRect();
      // px per 15-min slot, derived straight from the live grid height: the grid
      // spans 24h = 96 slots of 15 min. (Reading a CSS var here would be wrong —
      // the grid is laid out from state.js's HOUR_PX, not the --hour/--slot vars.)
      const slotPx = r.height / 96;
      return { left: r.left, width: r.width, top: r.top, slotPx };
    });
    const x = box.left + box.width / 2;
    // +1px nudges us safely inside the slot rather than on its top boundary.
    const y1 = box.top + yOffset + 1;
    const y2 = y1 + box.slotPx; // drag down one slot so it's an unambiguous drag

    await page.mouse.move(x, y1);
    await page.mouse.down();
    await page.mouse.move(x, y1 + 4);
    await page.mouse.move(x, y2);
    await page.mouse.up();

    await expect(page.locator('#pingScrim.show')).toHaveCount(1);
    await expect(page.locator('#pingKick')).toHaveText('ZEITRAUM EINTRAGEN');
    await page.locator('#pingScrim #pingBody input.txt').fill(label);
    await page.locator('#pingScrim #pingFoot button.amber').click();
    await expect(page.locator('#pingScrim.show')).toHaveCount(0);

    return page.evaluate(({ KEY, label }) => {
      const st = JSON.parse(localStorage.getItem(KEY));
      const b = st.blocks.find((x) => x.label === label);
      if (!b) return null;
      const d = new Date(b.start);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }, { KEY, label });
  }

  // px per 15-min slot, derived from the live grid height (24h = 96 slots).
  // Used to land the second drag at 00:30 (= 2 slots down from the grid top).
  const slotPx = await grid.evaluate((g) => g.getBoundingClientRect().height / 96);

  const midnightLabel = 'Midnight-' + Date.now();
  const startAtMidnight = await dragCreate(0, midnightLabel);
  expect(startAtMidnight).toBe('00:00');

  const halfPastLabel = 'HalfPast-' + Date.now();
  const startAtHalfPast = await dragCreate(2 * slotPx, halfPastLabel);
  expect(startAtHalfPast).toBe('00:30');

  // Both blocks are painted in the calendar.
  await expect(page.locator('#cal .block .lbl', { hasText: midnightLabel })).not.toHaveCount(0);
  await expect(page.locator('#cal .block .lbl', { hasText: halfPastLabel })).not.toHaveCount(0);
});

// Guard 1f40aed: moving the grid content into .daygrid must NOT regress the
// heartbeat .beat tooltip — on hover the beat still lifts above blocks (z>=61)
// and its card shows. The beat now lives inside .daygrid alongside the blocks.
test('heartbeat .beat tooltip still shows above blocks on hover (no regression of 1f40aed)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'hover tooltip is a desktop (mouse) interaction');

  // Seed a heartbeat run for today (its own localStorage key, read at module
  // load — so it must be set BEFORE the app boots). Stamps land on slot
  // boundaries so beatRuns() merges them into one visible rail.
  await page.goto('./');
  await page.evaluate(({ KEY }) => {
    const d = new Date();
    const stamps = [];
    for (let s = 0; s < 4; s++) { const t = new Date(d); t.setHours(9, s * 15, 0, 0); stamps.push(t.toISOString()); }
    localStorage.setItem('timelog.heartbeat.v1', JSON.stringify(stamps));
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [],
      recentLabels: [],
      settings: { theme: 'light', introSeen: true, soundOn: true, notifyOn: false, intervalMin: 15 },
    }));
  }, { KEY });
  await page.reload();
  await page.waitForTimeout(1100);
  await closeAnyModal(page);

  const beat = page.locator('#cal .daycol.today .beat').first();
  await expect(beat).toHaveCount(1);
  await beat.scrollIntoViewIfNeeded();
  await beat.hover();
  await page.waitForTimeout(200);

  await expect(beat.locator('.beat-tip')).toBeVisible();
  const z = await beat.evaluate((b) => Number(getComputedStyle(b).zIndex));
  expect(z).toBeGreaterThanOrEqual(61);
});
