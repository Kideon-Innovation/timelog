import { test, expect } from '@playwright/test';

// Catch-up modal ("Was war seit eben los?") — grouped gap entry.
//
// Contiguous gap slots are grouped into ONE run with a single range label +
// ONE input (a 1h hole is one "12:00–13:00" entry, not 4× "Pause"). Runs with
// more than one slot expose an "Einzeln bearbeiten" disclosure (same pattern
// as the edit dialog) with per-slot rows for overrides.
//
// This file also locks the two original catch-up UX fixes (joerg):
//   Bug A — every ✕ (run-level AND slot-level) must be a REVERSIBLE toggle.
//           Skipping and clicking again must recover the row and restore any
//           typed text, without closing/reopening the modal.
//   Bug B — no native <datalist> dropdown anywhere; recent labels surface as
//           chips instead.

const KEY = 'timelog.v1';
const SLOT = 15 * 60000;

// Seed one block ending `gapSlotCount` slots before the current slot, so
// gapSlots() deterministically yields exactly that many contiguous gap slots
// (one run), independent of wall-clock time. boot() then auto-opens the
// catch-up modal.
async function seedAndOpenCatchup(page, gapSlotCount = 4) {
  // Crossing a 15-min slot boundary mid-test would shift the live slot and
  // break the count/offset assertions (5 gaps instead of 4). If we're within
  // a few seconds of a boundary, sit it out first — rare, bounded wait.
  const msLeftInSlot = SLOT - (Date.now() % SLOT);
  if (msLeftInSlot < 10000) await new Promise((r) => setTimeout(r, msLeftInSlot + 200));
  await page.goto('./');
  await page.evaluate(({ KEY, gapSlotCount, SLOT }) => {
    const floor = (t) => { const d = new Date(t); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0); return d; };
    const cur = floor(new Date()).getTime();
    const mk = (start, label) => ({
      start: new Date(start).toISOString(),
      end: new Date(start + SLOT).toISOString(), label,
    });
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [mk(cur - (gapSlotCount + 1) * SLOT, 'Mandant Müller')],
      recentLabels: ['Mandant Müller', 'Doku', 'Mittag', 'Martens'],
      settings: { theme: 'light', introSeen: true, soundOn: true, notifyOn: false, intervalMin: 15 },
    }));
  }, { KEY, gapSlotCount, SLOT });
  await page.reload();
  await page.waitForTimeout(1300);
  await expect(page.locator('#pingScrim.show')).toBeVisible();
}

// Labels of the blocks saved AFTER the seeded filler block (the catch-up result).
async function savedGapLabels(page) {
  return page.evaluate(({ KEY, SLOT }) => {
    const floor = (t) => { const d = new Date(t); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0); return d; };
    const cur = floor(new Date()).getTime();
    const { blocks } = JSON.parse(localStorage.getItem(KEY));
    return blocks
      .filter((b) => b.label !== 'Mandant Müller')
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .map((b) => ({ label: b.label, offset: (cur - new Date(b.start).getTime()) / SLOT }));
  }, { KEY, SLOT });
}

test.describe('grouped catch-up: one input per contiguous gap', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndOpenCatchup(page);
  });

  test('a contiguous gap renders as ONE group: range label, one input, expandable slot rows', async ({ page }, testInfo) => {
    const runs = page.locator('#pingBody .gaprun');
    await expect(runs).toHaveCount(1);
    // top row shows the time range of the whole run, not a single slot
    const top = runs.first().locator('.gaprow').first();
    await expect(top.locator('.tg')).toHaveText(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
    // exactly one visible input until the disclosure is opened
    const split = runs.first().locator('details.edit-split');
    await expect(split).toHaveCount(1);
    await expect(split).not.toHaveAttribute('open', '');
    await expect(split.locator('summary')).toHaveText('Einzeln bearbeiten');
    // PR/QA screenshots land in the gitignored test-results/, NOT in
    // docs/screenshots/ — otherwise every local run dirties the committed,
    // manually curated PNGs that the PR body embeds.
    if (testInfo.project.name === 'desktop') {
      await page.screenshot({ path: 'test-results/catchup-grouped-collapsed.png' });
    }
    // expanding reveals one row per 15-min slot
    await split.locator('summary').click();
    await expect(split.locator('.gaprow')).toHaveCount(4);
    if (testInfo.project.name === 'desktop') {
      await page.screenshot({ path: 'test-results/catchup-grouped-expanded.png' });
    }
  });

  test('the top input fills ALL slots of the run on save', async ({ page }) => {
    await page.locator('#pingBody .gaprun .gaprow input').first().fill('Pause');
    await page.locator('#pingFoot .btn.amber').click();
    await expect(page.locator('#pingScrim.show')).toHaveCount(0);
    const saved = await savedGapLabels(page);
    expect(saved.map((b) => b.label)).toEqual(['Pause', 'Pause', 'Pause', 'Pause']);
  });

  test('an edited slot row wins over the top label; untouched rows get the top label', async ({ page }) => {
    const run = page.locator('#pingBody .gaprun').first();
    await run.locator('.gaprow input').first().fill('Pause');
    await run.locator('details.edit-split summary').click();
    await run.locator('details.edit-split .gaprow input').nth(1).fill('Telefonat Müller');
    await page.locator('#pingFoot .btn.amber').click();
    const saved = await savedGapLabels(page);
    expect(saved.map((b) => b.label)).toEqual(['Pause', 'Telefonat Müller', 'Pause', 'Pause']);
  });

  test('a slot-level skip keeps that slot unlogged while the top label fills the rest', async ({ page }) => {
    const run = page.locator('#pingBody .gaprun').first();
    await run.locator('.gaprow input').first().fill('Pause');
    await run.locator('details.edit-split summary').click();
    await run.locator('details.edit-split .gaprow .skip').nth(2).click();
    await page.locator('#pingFoot .btn.amber').click();
    const saved = await savedGapLabels(page);
    // 4 gap slots at offsets 4,3,2,1 before the current slot; slot index 2 (offset 2) skipped
    expect(saved.map((b) => b.label)).toEqual(['Pause', 'Pause', 'Pause']);
    expect(saved.map((b) => b.offset)).toEqual([4, 3, 1]);
  });

  test('a skipped run saves nothing', async ({ page }) => {
    const run = page.locator('#pingBody .gaprun').first();
    await run.locator('.gaprow input').first().fill('Pause');
    await run.locator('.gaprow .skip').first().click();
    await page.locator('#pingFoot .btn.amber').click();
    expect(await savedGapLabels(page)).toEqual([]);
  });

  test('Bug A: the run-level ✕ is a reversible toggle that restores typed text', async ({ page }) => {
    const run = page.locator('#pingBody .gaprun').first();
    const row = run.locator('.gaprow').first();
    const input = row.locator('input');
    const toggle = row.locator('.skip');
    const split = run.locator('details.edit-split');

    await input.fill('Telefonat Müller');
    await expect(row).not.toHaveClass(/done/);

    // Skip: row goes inactive, input cleared + disabled, disclosure hidden.
    await toggle.click();
    await expect(row).toHaveClass(/done/);
    await expect(input).toBeDisabled();
    await expect(input).toHaveValue('');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(split).toBeHidden();

    // Recover: row active again, the previously typed text is restored.
    await toggle.click();
    await expect(row).not.toHaveClass(/done/);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Telefonat Müller');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(split).toBeVisible();
  });

  test('Bug A: the slot-level ✕ is a reversible toggle that restores typed text', async ({ page }) => {
    const run = page.locator('#pingBody .gaprun').first();
    await run.locator('details.edit-split summary').click();
    const row = run.locator('details.edit-split .gaprow').first();
    const input = row.locator('input');
    const toggle = row.locator('.skip');

    await input.fill('Konzept');
    // skip then recover then re-skip — must end skipped (empty) deterministically
    await toggle.click();
    await expect(row).toHaveClass(/done/);
    await expect(input).toBeDisabled();
    await expect(input).toHaveValue('');
    await toggle.click();
    await expect(input).toHaveValue('Konzept');
    await toggle.click();
    await expect(row).toHaveClass(/done/);
    await expect(input).toHaveValue('');
  });

  test('Bug B: no native datalist dropdown affordance anywhere', async ({ page }) => {
    // No <datalist> in the DOM, and no input wired to one.
    await expect(page.locator('datalist')).toHaveCount(0);
    await expect(page.locator('#pingBody input[list]')).toHaveCount(0);
    await expect(page.locator('input[list]')).toHaveCount(0);
  });

  test('Bug B: recent labels still reachable via chips', async ({ page }) => {
    // The styled suggestion chips replace the broken native dropdown.
    const chips = page.locator('#pingBody .chips .chip-b');
    expect(await chips.count()).toBeGreaterThan(0);
    // picking a chip fills the active run inputs (quick "all = X" behaviour)
    await chips.filter({ hasText: 'Mittag' }).first().click();
    await expect(page.locator('#pingBody .gaprun .gaprow:not(.done) input').first()).toHaveValue('Mittag');
  });
});
