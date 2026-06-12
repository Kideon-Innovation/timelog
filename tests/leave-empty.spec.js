import { test, expect } from '@playwright/test';

// "Leer lassen" must be remembered — QA finding M2. Skipping a gap creates no
// block, so gapSlots() used to re-report it at EVERY slot boundary: beep +
// notification + dialog every 15 min for slots the user already answered.
// Skips are now persisted (timelog.skipped.v1) and excluded from gapSlots().
// A reload re-runs boot()'s initial catch-up (~900 ms) — the strongest probe
// for "would it ping again?" without waiting for a real 15-min boundary.
//
// Covered paths: "Alle leer lassen", run-✕ on save, slot-✕ on save, and the
// single-ping "Nicht am PC / leer lassen". Plus: skipped slots never become
// blocks (→ can never appear in the calendar or the Excel export).

const KEY = 'timelog.v1';
const SKIP_KEY = 'timelog.skipped.v1';
const SLOT = 15 * 60000;

// Same deterministic seeding as catchup.spec.js: one filler block ending
// `gapSlotCount` slots ago (+ a future anchor that defeats Morgen-Modus).
async function seedAndOpenPing(page, gapSlotCount = 4) {
  // These tests reload mid-flow; crossing a slot boundary then creates a NEW,
  // legitimately un-answered gap and a legit ping. Sit out imminent boundaries.
  const msLeftInSlot = SLOT - (Date.now() % SLOT);
  if (msLeftInSlot < 12000) await new Promise((r) => setTimeout(r, msLeftInSlot + 200));
  await page.goto('./');
  await page.evaluate(({ KEY, gapSlotCount, SLOT }) => {
    const floor = (t) => { const d = new Date(t); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0); return d; };
    const cur = floor(new Date()).getTime();
    const mk = (start, label) => ({
      start: new Date(start).toISOString(),
      end: new Date(start + SLOT).toISOString(), label,
    });
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [
        mk(cur - (gapSlotCount + 1) * SLOT, 'Mandant Müller'),
        mk(cur + 4 * SLOT, 'Mandant Müller'),
      ],
      recentLabels: ['Mandant Müller', 'Doku'],
      settings: { theme: 'light', introSeen: true, soundOn: false, notifyOn: false, intervalMin: 15 },
    }));
  }, { KEY, gapSlotCount, SLOT });
  await page.reload();
  await page.waitForTimeout(1300);
  await expect(page.locator('#pingScrim.show')).toBeVisible();
}

// Reload and let boot()'s initial catch-up window pass — the re-ping probe.
async function reloadAndExpectNoPing(page) {
  await page.reload();
  await page.waitForTimeout(1300);
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
}

async function storedState(page) {
  return page.evaluate(({ KEY, SKIP_KEY }) => ({
    blocks: JSON.parse(localStorage.getItem(KEY)).blocks,
    skipped: JSON.parse(localStorage.getItem(SKIP_KEY) || '[]'),
  }), { KEY, SKIP_KEY });
}

test('"Alle leer lassen" silences those gaps for good — no re-ping after reload', async ({ page }) => {
  await seedAndOpenPing(page);
  await page.locator('#pingFoot .btn.ghost', { hasText: 'Alle leer lassen' }).click();
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);

  const { blocks, skipped } = await storedState(page);
  expect(blocks).toHaveLength(2);          // nothing added → nothing in calendar/export
  expect(skipped).toHaveLength(4);         // all 4 gap slots remembered as deliberately empty

  await reloadAndExpectNoPing(page);
  // still no phantom blocks painted for the skipped range
  expect((await storedState(page)).blocks).toHaveLength(2);
});

test('a run skipped via ✕ and saved does not re-ping', async ({ page }) => {
  await seedAndOpenPing(page);
  await page.locator('#pingBody .gaprun .gaprow .skip').first().click();
  await page.locator('#pingFoot .btn.amber').click();
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);

  const { blocks, skipped } = await storedState(page);
  expect(blocks).toHaveLength(2);
  expect(skipped).toHaveLength(4);

  await reloadAndExpectNoPing(page);
});

test('a single slot skipped via ✕ stays quiet while the rest is filled', async ({ page }) => {
  await seedAndOpenPing(page);
  const run = page.locator('#pingBody .gaprun').first();
  await run.locator('.gaprow input').first().fill('Pause');
  await run.locator('details.edit-split summary').click();
  await run.locator('details.edit-split .gaprow .skip').nth(2).click();
  await page.locator('#pingFoot .btn.amber').click();

  const { blocks, skipped } = await storedState(page);
  expect(blocks.filter((b) => b.label === 'Pause')).toHaveLength(3); // 3 filled
  expect(skipped).toHaveLength(1);                                   // 1 deliberately empty

  await reloadAndExpectNoPing(page);
});

test('single-gap ping: "Nicht am PC / leer lassen" is remembered', async ({ page }) => {
  await seedAndOpenPing(page, 1);
  // one gap → the single-slot ping with the skip footer button
  await page.locator('#pingFoot .btn.ghost', { hasText: 'Nicht am PC' }).click();
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);

  const { blocks, skipped } = await storedState(page);
  expect(blocks).toHaveLength(2);
  expect(skipped).toHaveLength(1);

  await reloadAndExpectNoPing(page);
});

test('closing the catch-up WITHOUT answering (Esc) still re-pings — only answers are remembered', async ({ page }) => {
  await seedAndOpenPing(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  expect((await storedState(page)).skipped).toHaveLength(0);

  // the gaps are still unanswered → the next boot asks again (by design)
  await page.reload();
  await page.waitForTimeout(1300);
  await expect(page.locator('#pingScrim.show')).toBeVisible();
});
