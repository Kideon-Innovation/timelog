import { test, expect } from '@playwright/test';

const KEY = 'timelog.v1';

// Boot fresh (introSeen=false) so the first-run welcome shows.
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
// `mobile` projects, so these assertions are verified on both viewports.
//
// The full marketing landing was pulled OUT of the product (it now lives at
// https://kideon.de/time). What remains is a minimal, quiet first-run welcome:
// brand + one-line pitch + a single "Loslegen" CTA + an external "Mehr erfahren"
// link. Opening the app should go (near-)straight to the tool.
test.describe('first-run welcome', () => {
  test('welcome CTA is visible above the fold (desktop + mobile)', async ({ page }) => {
    await freshIntro(page);
    const cta = page.locator('#introStart');
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    const vh = page.viewportSize().height;
    expect(box).not.toBeNull();
    // Whole button must sit within the first viewport — no scrolling to reach it.
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
  });

  test('welcome CTA dismisses the intro and enters the app', async ({ page }) => {
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

  test('welcome links out to the external marketing page (kideon.de/time)', async ({ page }) => {
    await freshIntro(page);
    const more = page.locator('.welcome-more a');
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('href', 'https://kideon.de/time');
    await expect(more).toHaveAttribute('target', '_blank');
  });

  test('no in-product marketing wall: the old landing sections are gone', async ({ page }) => {
    await freshIntro(page);
    // The comparison / focus / 3-step pitch and the in-app demo were removed.
    await expect(page.locator('.intro-counter')).toHaveCount(0);
    await expect(page.locator('.intro-focus')).toHaveCount(0);
    await expect(page.locator('.intro-demo')).toHaveCount(0);
    await expect(page.locator('#introStartBottom')).toHaveCount(0);
  });

  // The welcome is now a small modal-style card, not a full-screen wall: the app
  // shows through behind it and you can simply click it away.
  test('the app is visible behind the welcome card', async ({ page }) => {
    await freshIntro(page);
    // Calendar sits behind the translucent scrim — not hidden, just out of reach.
    await expect(page.locator('#cal')).toBeVisible();
  });

  test('compliance badges are shown (DSGVO / §203 / lokal)', async ({ page }) => {
    await freshIntro(page);
    const badges = page.locator('.intro-badges li');
    await expect(badges).toHaveCount(3);
    await expect(page.locator('.intro-badges')).toContainText('DSGVO');
    await expect(page.locator('.intro-badges')).toContainText('203');
    await expect(page.locator('.intro-badges')).toContainText('lokal');
  });

  test('clicking the backdrop dismisses the welcome and enters the app', async ({ page }) => {
    await freshIntro(page);
    // Click the scrim itself (top-left corner, outside the centered card).
    await page.locator('#intro').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#intro')).not.toHaveClass(/show/);
    const seen = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.introSeen, KEY);
    expect(seen).toBe(true);
  });

  test('the × button dismisses the welcome', async ({ page }) => {
    await freshIntro(page);
    await page.locator('#introClose').click();
    await expect(page.locator('#intro')).not.toHaveClass(/show/);
    const seen = await page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).settings.introSeen, KEY);
    expect(seen).toBe(true);
  });

  test('re-openable from the menu via "Was ist das?"', async ({ page }) => {
    await freshIntro(page);
    await page.locator('#introStart').click();
    await expect(page.locator('#intro')).not.toHaveClass(/show/);
    await page.locator('#menuBtn').click();
    await page.locator('#aboutBtn').click();
    await expect(page.locator('#intro.show')).toBeVisible();
  });
});
