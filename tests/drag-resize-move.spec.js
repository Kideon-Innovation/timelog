import { test, expect } from '@playwright/test';

// Direct-manipulation (Google-Calendar-style) move + resize on existing blocks.
// Exercises the gesture state machine in src/ui/drag.js end-to-end with real
// pointer drags (mouse). Touch long-press shares the same code path.
//
// Determinism: every block is placed relative to a FUTURE anchor (cur + 2h) so
// it never falls inside the 2-hour catch-up window before "now" — that keeps
// gapSlots() empty and the auto-ping from intercepting our pointer drags,
// regardless of the wall-clock time the suite runs at. Expected slot labels are
// computed from the same anchor, never hard-coded.

const PX_PER_MIN = 116 / 60;          // must mirror state.js HOUR_PX/PX_PER_MIN
const SLOT_PX = 15 * PX_PER_MIN;      // one 15-min slot in pixels

function hhmm(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Pin a fixed, mid-day, off-15-min-boundary instant so the suite is independent
// of the real wall-clock. Two wall-clock hazards this removes deterministically:
//   1. cur+2h rolling past midnight (the mobile single-day view wouldn't render
//      a block that landed on tomorrow → block not found).
//   2. the 15-min boundary tick firing mid-drag (onBoundary → render() rebuilds
//      the calendar under the pointer and aborts the gesture). With the clock
//      frozen, that timer never fires unless a test fast-forwards it on purpose.
// Z (UTC) keeps the app's local-time reads and the ISO storage in lockstep on
// the UTC CI/dev runners (the existing time assertions already assume UTC).
const FIXED_NOW = '2026-06-10T12:07:00Z';

// `blocks`: array of [slotOffset, slots, label] — slotOffset is in 15-min slots
// from the anchor (cur + 2h). Returns { anchor } so the test can compute the
// expected times. Seeds a gap-free past so no catch-up ping opens.
async function seed(page, blocks) {
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await page.goto('./');
  const anchor = await page.evaluate((blocks) => {
    const SLOT = 15 * 60000;
    const floor = (t) => Math.floor(t / SLOT) * SLOT;
    const cur = floor(Date.now());
    const anchor = cur + 8 * SLOT;                 // +2h into the future
    const out = [];
    for (const [off, slots, label] of blocks) {
      for (let i = 0; i < slots; i++) {
        const s = anchor + (off + i) * SLOT;
        out.push({ start: new Date(s).toISOString(), end: new Date(s + SLOT).toISOString(), label });
      }
    }
    // One past block ending at the current slot → gapSlots() === [] → no ping.
    out.push({ start: new Date(cur - SLOT).toISOString(), end: new Date(cur).toISOString(), label: 'Past' });
    localStorage.setItem('timelog.v1', JSON.stringify({
      blocks: out, recentLabels: out.map(b => b.label),
      settings: { theme: 'light', introSeen: true, soundOn: false, notifyOn: false, intervalMin: 15 },
    }));
    return anchor;
  }, blocks);
  await page.reload();
  await page.waitForTimeout(1100);                 // past the boot ~900ms catch-up window
  for (const _ of [0, 1]) {
    if (await page.locator('.scrim.show').count()) await page.keyboard.press('Escape');
  }
  return anchor;
}

async function readBlocks(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).blocks
    .map(b => ({ start: b.start.slice(11, 16), end: b.end.slice(11, 16), label: b.label }))
    .sort((a, b) => a.start.localeCompare(b.start)));
}

// Drag from the center-x of a block, starting at offsetY within it, by dy px.
async function dragFrom(page, locator, offsetY, dy) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2, y0 = box.y + offsetY;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x, y0 + dy, { steps: 8 });
  await page.mouse.up();
}
// Grab the body (vertical center) — robust against the resize edge-zones.
async function dragBody(page, locator, dy) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await dragFrom(page, locator, box.height / 2, dy);
}

const SLOT_MS = 15 * 60000;

// Touch-driven move/resize via CDP (synthetic touch). Long-press for body-move,
// edge handle for resize.
async function touchSeq(page, x, y, dy, { hold = 0, steps = 6 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (i / steps) * dy }] });
    await page.waitForTimeout(15);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/* ---------- desktop: mouse pointer drags ---------- */
test.describe('desktop pointer', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'mouse-pointer interactions run on the desktop project');
  });

test('move a block by dragging its body snaps to 15 min and lands at the new time', async ({ page }) => {
  const anchor = await seed(page, [[0, 1, 'Mandant Müller']]);
  const block = page.locator('#cal .block').filter({ hasText: 'Mandant Müller' }).first();
  await expect(block).toBeVisible();
  await dragBody(page, block, 2 * SLOT_PX);        // down 2 slots
  await page.waitForTimeout(200);
  const blocks = await readBlocks(page);
  const start = hhmm(anchor + 2 * SLOT_MS), end = hhmm(anchor + 3 * SLOT_MS);
  expect(blocks).toContainEqual({ start, end, label: 'Mandant Müller' });
  expect(blocks.find(b => b.start === hhmm(anchor) && b.label === 'Mandant Müller')).toBeUndefined();
});

test('resize the bottom edge grows the block and snaps to 15 min', async ({ page }) => {
  const anchor = await seed(page, [[0, 1, 'Doku']]);
  const block = page.locator('#cal .block').filter({ hasText: 'Doku' }).first();
  const box = await block.boundingBox();
  await dragFrom(page, block, box.height - 2, 2 * SLOT_PX);   // bottom edge, down 2 slots
  await page.waitForTimeout(200);
  const doku = (await readBlocks(page)).filter(b => b.label === 'Doku');
  expect(doku.length).toBe(3);
  expect(doku[0].start).toBe(hhmm(anchor));
  expect(doku[doku.length - 1].end).toBe(hhmm(anchor + 3 * SLOT_MS));
});

test('resize cannot shrink a single-slot block below one slot', async ({ page }) => {
  const anchor = await seed(page, [[0, 1, 'Telefonat']]);
  const block = page.locator('#cal .block').filter({ hasText: 'Telefonat' }).first();
  const box = await block.boundingBox();
  await dragFrom(page, block, box.height - 2, -5 * SLOT_PX);  // drag bottom edge up past the top
  await page.waitForTimeout(200);
  const blocks = await readBlocks(page);
  expect(blocks).toContainEqual({ start: hhmm(anchor), end: hhmm(anchor + SLOT_MS), label: 'Telefonat' });
});

test('moving onto a partially-occupied neighbour TRIMS it, not deletes it', async ({ page }) => {
  // mover at offset 0; neighbour spans offsets 4..7 (4 slots). Move mover down 4
  // slots → it lands on offset 4, covering only the neighbour's first slot.
  const anchor = await seed(page, [[0, 1, 'Move me'], [4, 4, 'Neighbour']]);
  const mover = page.locator('#cal .block').filter({ hasText: 'Move me' }).first();
  await dragBody(page, mover, 4 * SLOT_PX);
  await page.waitForTimeout(300);
  const blocks = await readBlocks(page);
  const nb = blocks.filter(b => b.label === 'Neighbour');
  expect(nb.length).toBeGreaterThan(0);
  expect(nb[0].start).toBe(hhmm(anchor + 5 * SLOT_MS));      // trimmed: first slot gone
  expect(blocks).toContainEqual({ start: hhmm(anchor + 4 * SLOT_MS), end: hhmm(anchor + 5 * SLOT_MS), label: 'Move me' });
});

test('a full-cover move shows a confirm dialog; cancel reverts, confirm deletes', async ({ page }) => {
  const anchor = await seed(page, [[0, 1, 'Mover'], [4, 1, 'Victim']]);
  let mover = page.locator('#cal .block').filter({ hasText: 'Mover' }).first();
  await dragBody(page, mover, 4 * SLOT_PX);                   // fully covers Victim
  await expect(page.locator('#confirmScrim.show')).toBeVisible();
  await expect(page.locator('#confirmSub')).toContainText('Victim');
  await page.locator('#confirmCancel').click();
  await page.waitForTimeout(150);
  let blocks = await readBlocks(page);
  expect(blocks).toContainEqual({ start: hhmm(anchor), end: hhmm(anchor + SLOT_MS), label: 'Mover' });
  expect(blocks).toContainEqual({ start: hhmm(anchor + 4 * SLOT_MS), end: hhmm(anchor + 5 * SLOT_MS), label: 'Victim' });

  mover = page.locator('#cal .block').filter({ hasText: 'Mover' }).first();
  await dragBody(page, mover, 4 * SLOT_PX);
  await expect(page.locator('#confirmScrim.show')).toBeVisible();
  await page.locator('#confirmOk').click();
  await page.waitForTimeout(200);
  blocks = await readBlocks(page);
  expect(blocks.find(b => b.label === 'Victim')).toBeUndefined();
  expect(blocks).toContainEqual({ start: hhmm(anchor + 4 * SLOT_MS), end: hhmm(anchor + 5 * SLOT_MS), label: 'Mover' });
});

test('victim block is highlighted red live DURING the drag', async ({ page }) => {
  await seed(page, [[0, 1, 'Mover'], [4, 1, 'Victim']]);
  const mover = page.locator('#cal .block').filter({ hasText: 'Mover' }).first();
  await mover.scrollIntoViewIfNeeded();
  const box = await mover.boundingBox();
  const x = box.x + box.width / 2, y0 = box.y + box.height / 2;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x, y0 + 4 * SLOT_PX, { steps: 8 });   // hover over Victim, don't release
  const victim = page.locator('#cal .block').filter({ hasText: 'Victim' }).first();
  await expect(victim).toHaveClass(/dm-victim/);
  await page.screenshot({ path: 'test-results/dm-victim-live.png' });
  await page.mouse.up();
  if (await page.locator('#confirmScrim.show').count()) await page.locator('#confirmCancel').click();
});

test('after a move an Undo toast appears and restores the prior state', async ({ page }) => {
  const anchor = await seed(page, [[0, 1, 'Mandant Müller']]);
  const block = page.locator('#cal .block').filter({ hasText: 'Mandant Müller' }).first();
  await dragBody(page, block, 2 * SLOT_PX);
  const toast = page.locator('#toast.show');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Verschoben');
  await page.screenshot({ path: 'test-results/dm-undo-toast.png' });
  await page.locator('#toast .toast-act').click();
  await page.waitForTimeout(200);
  const blocks = await readBlocks(page);
  expect(blocks).toContainEqual({ start: hhmm(anchor), end: hhmm(anchor + SLOT_MS), label: 'Mandant Müller' });
  expect(blocks.find(b => b.start === hhmm(anchor + 2 * SLOT_MS) && b.label === 'Mandant Müller')).toBeUndefined();
});

test('a plain click on a block still opens the edit modal (no accidental move)', async ({ page }) => {
  const anchor = await seed(page, [[0, 1, 'Mandant Müller']]);
  const block = page.locator('#cal .block').filter({ hasText: 'Mandant Müller' }).first();
  await block.click();
  await expect(page.locator('#editScrim .modal')).toBeVisible();
  await page.locator('#editCancel').click();
  const blocks = await readBlocks(page);
  expect(blocks).toContainEqual({ start: hhmm(anchor), end: hhmm(anchor + SLOT_MS), label: 'Mandant Müller' });
});

test('creating a NEW block by dragging empty grid still works (no regression)', async ({ page }) => {
  await seed(page, [[0, 1, 'Existing']]);
  const block = page.locator('#cal .block').filter({ hasText: 'Existing' }).first();
  await block.scrollIntoViewIfNeeded();
  const bbox = await block.boundingBox();
  const x = bbox.x + bbox.width / 2;
  const y = bbox.y + 6 * SLOT_PX;                  // ~1.5h below the block = empty grid
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 3 * SLOT_PX, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#pingScrim.show')).toBeVisible();
  await expect(page.locator('#pingKick')).toHaveText('ZEITRAUM EINTRAGEN');
});

// Regression: the 15-min boundary tick (onBoundary → render + catch-up ping)
// must NOT tear down an in-progress drag. Pre-fix, a render() mid-gesture
// replaced the captured block element and the move silently aborted — which made
// every drag flaky in the ~1-2s window around :00/:15/:30/:45. Here we hold the
// pointer mid-drag and fast-forward the clock across the 12:15 boundary; the
// move must still land.
test('a 15-min boundary tick mid-drag does not abort the move', async ({ page }) => {
  const anchor = await seed(page, [[0, 1, 'Boundary']]);   // clock pinned at 12:07
  const block = page.locator('#cal .block').filter({ hasText: 'Boundary' }).first();
  await expect(block).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  const x = box.x + box.width / 2, y0 = box.y + box.height / 2;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x, y0 + 2 * SLOT_PX, { steps: 8 });  // drag active, pointer still held
  await page.clock.fastForward('08:30');                     // 12:07 → past the 12:15 boundary
  await page.mouse.up();
  await page.waitForTimeout(300);
  const blocks = await readBlocks(page);
  expect(blocks).toContainEqual({ start: hhmm(anchor + 2 * SLOT_MS), end: hhmm(anchor + 3 * SLOT_MS), label: 'Boundary' });
});

}); // desktop pointer

/* ---------- mobile: touch (long-press move + edge resize) ---------- */
test.describe('mobile touch', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'touch interactions run on the mobile project');
  });

  test('long-press then drag MOVES a block (snaps 15 min)', async ({ page }) => {
    const anchor = await seed(page, [[0, 1, 'Touchy']]);
    const block = page.locator('#cal .block').filter({ hasText: 'Touchy' }).first();
    await block.scrollIntoViewIfNeeded();
    const box = await block.boundingBox();
    await touchSeq(page, box.x + box.width / 2, box.y + box.height / 2, 3 * SLOT_PX, { hold: 340 });
    await page.waitForTimeout(300);
    if (await page.locator('#confirmScrim.show').count()) await page.locator('#confirmCancel').click();
    const moved = (await readBlocks(page)).find(b => b.label === 'Touchy');
    expect(moved.start).toBe(hhmm(anchor + 3 * SLOT_MS));
  });

  test('dragging the bottom edge handle RESIZES on touch', async ({ page }) => {
    await seed(page, [[0, 1, 'Rz']]);
    const block = page.locator('#cal .block').filter({ hasText: 'Rz' }).first();
    await block.scrollIntoViewIfNeeded();
    const box = await block.boundingBox();
    await touchSeq(page, box.x + box.width / 2, box.y + box.height - 2, 2 * SLOT_PX);  // edge → no hold
    await page.waitForTimeout(300);
    const cnt = (await readBlocks(page)).filter(b => b.label === 'Rz').length;
    expect(cnt).toBe(3);
  });

  test('a quick tap still opens the edit modal on touch', async ({ page }) => {
    await seed(page, [[0, 1, 'Touchy']]);
    const block = page.locator('#cal .block').filter({ hasText: 'Touchy' }).first();
    await block.scrollIntoViewIfNeeded();
    const box = await block.boundingBox();
    await touchSeq(page, box.x + box.width / 2, box.y + box.height / 2, 0, { hold: 80, steps: 0 });
    await expect(page.locator('#editScrim.show')).toBeVisible();
  });
});
