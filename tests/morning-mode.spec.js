import { test, expect } from '@playwright/test';

// Morgen-Modus E2E: after a night without logging (last block before today
// 06:00, no block after 06:00 yet), boot must NOT open the retroactive
// catch-up modal. Instead it opens the present-tense dialog for the CURRENT
// slot ("Woran arbeitest du gerade?") and the night gap stays empty.
// Once a block after 06:00 exists, the normal catch-up behaviour returns.
//
// Same real-clock seed+skip pattern as tests/catchup.spec.js: scenarios that
// need "now" on a specific side of 06:00 skip instead of asserting a false
// negative at the wrong time of day. The pure decision logic is covered
// deterministically in tests/morning.test.js — this spec pins the wiring.

const KEY = 'timelog.v1';

const SETTINGS = {
  theme: 'light', introSeen: true, soundOn: false, notifyOn: false,
  notifyNudgeDismissed: true, intervalMin: 15,
};

// Seed blocks (built in-page so "yesterday/today" use the browser's clock),
// reload, and give boot()'s 900ms initial catch-up timer time to fire.
async function seedAndBoot(page, mkBlocks) {
  await page.goto('./');
  await page.evaluate(({ KEY, SETTINGS, mkBlocksSrc }) => {
    // eslint-disable-next-line no-new-func
    const mkBlocks = new Function('return (' + mkBlocksSrc + ')')();
    localStorage.setItem(KEY, JSON.stringify({
      blocks: mkBlocks(),
      recentLabels: ['Mandant Müller', 'Doku'],
      settings: SETTINGS,
    }));
  }, { KEY, SETTINGS, mkBlocksSrc: mkBlocks.toString() });
  await page.reload();
  await page.waitForTimeout(1300);
}

test.describe('Morgen-Modus', () => {
  test('after a night gap only the present-tense dialog opens — no retro questions', async ({ page }) => {
    // Needs "now" after 06:00 local; before that, normal behaviour is correct.
    await page.goto('./');
    const hour = await page.evaluate(() => new Date().getHours());
    test.skip(hour < 6, 'before 06:00 local — morning mode cannot be active');

    await seedAndBoot(page, () => {
      // last block: yesterday 23:00–23:15 → night gap reaches across 06:00
      const s = new Date(); s.setDate(s.getDate() - 1); s.setHours(23, 0, 0, 0);
      const e = new Date(s.getTime() + 15 * 60000);
      return [{ id: 'n1', start: s.toISOString(), end: e.toISOString(), label: 'Spät' }];
    });

    // Present-tense dialog for the current slot…
    await expect(page.locator('#pingScrim')).toHaveClass(/show/);
    await expect(page.locator('#pingTitle')).toHaveText('Woran arbeitest du gerade?');
    await expect(page.locator('#pingKick')).toHaveText('WILLKOMMEN ZURÜCK');
    // …and NOT the multi-row catch-up (no retro gap rows).
    await expect(page.locator('#pingBody .gaprow')).toHaveCount(0);

    // Leaving the slot empty must not fill the night: still exactly 1 block.
    await page.locator('#pingFoot .btn.ghost').click();
    const blocks = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks, KEY);
    expect(blocks.length).toBe(1);
    expect(blocks[0].label).toBe('Spät');
  });

  test('a block after 06:00 restores the normal retroactive catch-up', async ({ page }) => {
    // Needs a 07:00 block in the past plus ≥2 gaps → run from 08:00 local on.
    await page.goto('./');
    const hour = await page.evaluate(() => new Date().getHours());
    test.skip(hour < 8, 'needs a past 07:00 block and multiple gaps');

    await seedAndBoot(page, () => {
      const mk = (id, h, m, label) => {
        const s = new Date(); s.setHours(h, m, 0, 0);
        return { id, start: s.toISOString(), end: new Date(s.getTime() + 15 * 60000).toISOString(), label };
      };
      // night block + a morning block at 07:00 → morning mode must be OFF
      const n = new Date(); n.setDate(n.getDate() - 1); n.setHours(23, 0, 0, 0);
      return [
        { id: 'n1', start: n.toISOString(), end: new Date(n.getTime() + 15 * 60000).toISOString(), label: 'Spät' },
        mk('m1', 7, 0, 'Früh'),
      ];
    });

    // Normal retro catch-up modal with gap rows (past tense, not "gerade").
    await expect(page.locator('#pingScrim')).toHaveClass(/show/);
    await expect(page.locator('#pingTitle')).not.toHaveText('Woran arbeitest du gerade?');
    expect(await page.locator('#pingBody .gaprow').count()).toBeGreaterThan(0);
  });
});
