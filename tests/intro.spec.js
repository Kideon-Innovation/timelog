import { test, expect } from '@playwright/test';

const KEY = 'timelog.v1';

// Boot fresh (introSeen=false) so the first-run intro/landing shows.
async function freshIntro(page, theme = 'light') {
  await page.goto('./');
  await page.evaluate(({ KEY, theme }) => {
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [], recentLabels: [],
      settings: { theme, introSeen: false, soundOn: true, notifyOn: false, intervalMin: 15 },
    }));
  }, { KEY, theme });
  await page.reload();
  await expect(page.locator('#intro.show')).toBeVisible();
}

// The Playwright config runs every test under both the `desktop` and
// `mobile` projects, so the above-the-fold assertion is verified on both
// viewports without per-file device overrides.
test.describe('intro / landing', () => {
  test('hero CTA is visible above the fold (desktop + mobile)', async ({ page }) => {
    await freshIntro(page);
    const cta = page.locator('#introStart');
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    const vh = page.viewportSize().height;
    expect(box).not.toBeNull();
    // Whole button must sit within the first viewport — no scrolling to reach it.
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
  });

  test('hero CTA dismisses the intro and enters the app', async ({ page }) => {
    await freshIntro(page);
    await page.locator('#introStart').click();
    await expect(page.locator('#intro')).not.toHaveClass(/show/);
    // App calendar is now interactive.
    await expect(page.locator('#cal')).toBeVisible();
    // Persistence: introSeen is written so it won't show again.
    const seen = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.introSeen, KEY);
    expect(seen).toBe(true);
    // Reload must NOT re-show the intro.
    await page.reload();
    await expect(page.locator('#intro')).not.toHaveClass(/show/);
  });

  test('closing CTA at the bottom also enters the app', async ({ page }) => {
    await freshIntro(page);
    const bottom = page.locator('#introStartBottom');
    await bottom.scrollIntoViewIfNeeded();
    await bottom.click();
    await expect(page.locator('#intro')).not.toHaveClass(/show/);
    await expect(page.locator('#cal')).toBeVisible();
  });
});
