import { test, expect } from '@playwright/test';

// Core-flow safety net. These cover the must-not-regress behaviours that the
// a11y/ui specs don't assert directly: app boot + calendar render, the
// ping/log-now → commit → PERSIST-across-reload path, drag-to-select range
// entry, the menu, and the Excel export (count + real download). This net
// exists so the subsequent CSS/JS module extractions are provably behaviour-
// preserving.

const KEY = 'timelog.v1';

// Seed localStorage so the app boots past the intro into the calendar.
// load() only honours stored state when `blocks` exists.
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
  // boot() may auto-open a catch-up after ~900ms; wait past it.
  await page.waitForTimeout(1100);
}

// Close any auto-opened ping/catch-up modal so we start from a clean shell.
async function closeAnyModal(page) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.scrim.show').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

test('app boots and renders the 3-day (or 1-day mobile) calendar', async ({ page }) => {
  await seed(page);
  await closeAnyModal(page);

  // The calendar mounts and renders the expected number of day columns:
  // 3 on desktop, 1 on the narrow mobile viewport. Either way, > 0 and a
  // "today" column exists.
  const cols = await page.locator('#cal .daycol').count();
  expect(cols === 1 || cols === 3).toBe(true);
  await expect(page.locator('#cal .daycol.today')).toHaveCount(1);
  // range label is populated (not the placeholder dash)
  const label = (await page.locator('#rangeLabel').innerText()).trim();
  expect(label).not.toBe('—');
});

test('log-now: committing a label paints a block that PERSISTS across reload', async ({ page }) => {
  await seed(page);
  await closeAnyModal(page);

  // Open the manual "Jetzt eintragen" ping for the current slot.
  await page.click('#logNowBtn');
  await expect(page.locator('#pingScrim.show')).toHaveCount(1);

  const label = 'Persist-Test-' + Date.now();
  const input = page.locator('#pingScrim #pingBody input.txt');
  await input.fill(label);
  // Commit via the primary "Eintragen" action in the modal footer.
  await page.locator('#pingScrim #pingFoot button.amber').click();

  // Modal closes and a matching block is painted in the calendar.
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  await expect(page.locator('#cal .block .lbl', { hasText: label })).toHaveCount(1);

  // Persisted to localStorage under the current slot.
  const stored = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  expect(stored.blocks.some((b) => b.label === label)).toBe(true);

  // And it survives a full reload (the whole point of local-only storage).
  await page.reload();
  await page.waitForTimeout(1100);
  await closeAnyModal(page);
  await expect(page.locator('#cal .block .lbl', { hasText: label })).toHaveCount(1);
});

test('drag-to-select a range creates a block', async ({ page }, testInfo) => {
  // Mouse press-drag selects immediately (desktop). On touch devices the app
  // deliberately requires a ~260ms long-press before a drag selects (so the
  // calendar can still scroll), which page.mouse can't faithfully emulate —
  // so this gesture-level flow is asserted on the desktop project only.
  test.skip(testInfo.project.name !== 'desktop', 'drag-select gesture is desktop (mouse) only');
  await seed(page);
  await closeAnyModal(page);

  // Mouse press-drag inside today's column selects a range immediately and
  // opens the "Zeitraum eintragen" modal on release. The calendar auto-scrolls
  // to centre "now", so the column top can sit far above the viewport — pick a
  // drag span that is provably inside the visible intersection of the column
  // and the viewport (and clear of the sticky column head).
  const col = page.locator('#cal .daycol.today').first();
  const span = await col.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const head = el.querySelector('.col-head');
    const headBottom = head ? head.getBoundingClientRect().bottom : r.top;
    const visTop = Math.max(r.top, headBottom) + 8;
    const visBottom = Math.min(r.bottom, window.innerHeight) - 8;
    return { x: r.left + r.width / 2, top: visTop, bottom: visBottom };
  });
  // Need room for a multi-slot drag inside the visible window.
  expect(span.bottom - span.top).toBeGreaterThan(60);
  const x = span.x;
  const y1 = span.top + 10;
  const y2 = Math.min(span.bottom - 10, y1 + 80);
  await page.mouse.move(x, y1);
  await page.mouse.down();
  await page.mouse.move(x, y1 + 20);
  await page.mouse.move(x, y2);
  await page.mouse.up();

  // Range-entry modal opens.
  await expect(page.locator('#pingScrim.show')).toHaveCount(1);
  await expect(page.locator('#pingKick')).toHaveText('ZEITRAUM EINTRAGEN');

  const label = 'Drag-Test-' + Date.now();
  const input = page.locator('#pingScrim #pingBody input.txt');
  await input.fill(label);
  await page.locator('#pingScrim #pingFoot button.amber').click();

  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  // The dragged range paints at least one block with our label.
  await expect(page.locator('#cal .block .lbl', { hasText: label })).not.toHaveCount(0);
  const stored = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  expect(stored.blocks.some((b) => b.label === label)).toBe(true);
});

test('touch: tapping an empty slot opens the entry dialog and it STAYS open', async ({ page }, testInfo) => {
  // Regression for the mobile "can't log anything" bug: a touch tap on a slot
  // opened the range-entry modal, but the tap's synthesised compatibility
  // mousedown then landed on the freshly-shown backdrop and instantly closed
  // it again (the backdrop-close listener fired on `mousedown`). Touch only.
  test.skip(testInfo.project.name !== 'mobile', 'tap-to-log is a touch gesture');
  await seed(page);
  await closeAnyModal(page);

  // Pick a point provably inside the visible part of today's column, clear of
  // the sticky head and the left heartbeat rail.
  const col = page.locator('#cal .daycol.today').first();
  const pt = await col.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const head = el.querySelector('.col-head');
    const headBottom = head ? head.getBoundingClientRect().bottom : r.top;
    const visTop = Math.max(r.top, headBottom) + 8;
    const visBottom = Math.min(r.bottom, window.innerHeight) - 8;
    return { x: r.left + r.width / 2, y: (visTop + visBottom) / 2 };
  });
  await page.touchscreen.tap(pt.x, pt.y);

  // The dialog opens AND survives the trailing synthesised mouse/click events.
  await expect(page.locator('#pingScrim.show')).toHaveCount(1);
  await expect(page.locator('#pingKick')).toHaveText('ZEITRAUM EINTRAGEN');
  await page.waitForTimeout(300); // let any ghost click fire
  await expect(page.locator('#pingScrim.show')).toHaveCount(1);

  // And committing from that dialog still works on touch.
  const label = 'Tap-Test-' + Date.now();
  await page.locator('#pingScrim #pingBody input.txt').fill(label);
  await page.locator('#pingScrim #pingFoot button.amber').tap();
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  const stored = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
  expect(stored.blocks.some((b) => b.label === label)).toBe(true);
});

test('the overflow menu stays fully within the viewport', async ({ page }) => {
  // Regression for the mobile layout bug: the dropdown is anchored right:0 to a
  // menu button that sits near the LEFT edge on phones, so a 216px panel spilled
  // off the left of the screen (items clipped). openMenu() now nudges it back in.
  await seed(page);
  await closeAnyModal(page);

  await page.click('#menuBtn');
  await expect(page.locator('#menu')).toBeVisible();
  const fits = await page.locator('#menu').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  });
  expect(fits).toBe(true);
});

test('menu opens from the hamburger button', async ({ page }) => {
  await seed(page);
  await closeAnyModal(page);

  await expect(page.locator('#menuBtn')).toHaveAttribute('aria-expanded', 'false');
  await page.click('#menuBtn');
  await expect(page.locator('#menuBtn')).toHaveAttribute('aria-expanded', 'true');
  // The export entry point is reachable inside the open menu.
  await expect(page.locator('#exportBtn')).toBeVisible();
});

test('Excel export is reachable, reports the row count, and triggers a download', async ({ page }) => {
  // Seed two real blocks so the export has rows.
  const now = new Date();
  const mk = (h, m, label) => {
    const s = new Date(now); s.setHours(h, m, 0, 0);
    const e = new Date(s.getTime() + 15 * 60000);
    return { start: s.toISOString(), end: e.toISOString(), label };
  };
  await seed(page, [mk(9, 0, 'Mandant Müller'), mk(10, 30, 'Doku')]);
  await closeAnyModal(page);

  await page.click('#menuBtn');
  await page.click('#exportBtn');
  await expect(page.locator('#exportScrim .modal')).toBeVisible();

  // Count row reflects the seeded blocks ("2 Blöcke im Zeitraum").
  await expect(page.locator('#expCount')).toContainText('2 Blöcke');

  // Clicking the export action triggers a real .xlsx download.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#expGo'),
  ]);
  expect(download.suggestedFilename()).toMatch(/^timelog_.*\.xlsx$/);
});
