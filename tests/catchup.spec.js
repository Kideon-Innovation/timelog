import { test, expect } from '@playwright/test';

// Locks the two catch-up modal UX fixes the user (joerg) reported:
//   Bug A — the per-row ✕ must be a REVERSIBLE toggle. Skipping a row and then
//           clicking again must recover the row (and restore any typed text),
//           without closing/reopening the modal.
//   Bug B — the broken native datalist dropdown (the floating ▼ popup) must be
//           gone: inputs must not carry a `list=` attribute and there must be
//           no <datalist> in the DOM. Recent labels still surface as chips.

const KEY = 'timelog.v1';

// Seed two early-morning blocks so "now" produces several catch-up gaps,
// which makes boot() auto-open the multi-row catch-up modal (openCatchup).
async function seedAndOpenCatchup(page) {
  await page.goto('./');
  await page.evaluate((KEY) => {
    const now = new Date();
    const mk = (h, m, label) => {
      const s = new Date(now); s.setHours(h, m, 0, 0);
      const e = new Date(s.getTime() + 15 * 60000);
      return { start: s.toISOString(), end: e.toISOString(), label };
    };
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [mk(8, 0, 'Mandant Müller'), mk(8, 15, 'Doku')],
      recentLabels: ['Mandant Müller', 'Doku', 'Mittag', 'Martens'],
      settings: { theme: 'light', introSeen: true, soundOn: true, notifyOn: false, intervalMin: 15 },
    }));
  }, KEY);
  await page.reload();
  await page.waitForTimeout(1300);
}

test.describe('catch-up modal UX fixes', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndOpenCatchup(page);
    // The multi-row catch-up needs >=2 gaps. If "now" is too early in the day
    // there may be none — skip rather than assert a false negative.
    const open = await page.locator('#pingScrim.show').count();
    if (!open || (await page.locator('#pingBody .gaprow').count()) < 1) {
      test.skip(true, 'no catch-up gaps at this time of day');
    }
  });

  test('Bug A: ✕ is a reversible toggle that restores typed text', async ({ page }) => {
    const row = page.locator('#pingBody .gaprow').first();
    const input = row.locator('input');
    const toggle = row.locator('.skip');

    await input.fill('Telefonat Müller');
    await expect(row).not.toHaveClass(/done/);

    // Skip: row goes inactive, input cleared + disabled, toggle becomes recover.
    await toggle.click();
    await expect(row).toHaveClass(/done/);
    await expect(input).toBeDisabled();
    await expect(input).toHaveValue('');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Recover: row active again, the previously typed text is restored.
    await toggle.click();
    await expect(row).not.toHaveClass(/done/);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Telefonat Müller');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('Bug A: a skipped row stays empty on save but is recoverable beforehand', async ({ page }) => {
    const rows = page.locator('#pingBody .gaprow');
    const first = rows.first();
    await first.locator('input').fill('Konzept');
    // skip then recover then re-skip — must end skipped (empty) deterministically
    await first.locator('.skip').click();
    await first.locator('.skip').click();
    await expect(first.locator('input')).toHaveValue('Konzept');
    await first.locator('.skip').click();
    await expect(first).toHaveClass(/done/);
    await expect(first.locator('input')).toHaveValue('');
  });

  test('Bug B: no native datalist dropdown affordance anywhere', async ({ page }) => {
    // No <datalist> in the DOM, and no input wired to one.
    await expect(page.locator('datalist')).toHaveCount(0);
    await expect(page.locator('#pingBody .gaprow input[list]')).toHaveCount(0);
    await expect(page.locator('input[list]')).toHaveCount(0);
  });

  test('Bug B: recent labels still reachable via chips', async ({ page }) => {
    // The styled suggestion chips replace the broken native dropdown.
    const chips = page.locator('#pingBody .chips .chip-b');
    expect(await chips.count()).toBeGreaterThan(0);
    // picking a chip fills the active rows (quick "all = X" behaviour)
    await chips.filter({ hasText: 'Mittag' }).first().click();
    await expect(page.locator('#pingBody .gaprow:not(.done) input').first()).toHaveValue('Mittag');
  });
});
