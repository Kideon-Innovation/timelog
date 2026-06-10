import { test, expect } from '@playwright/test';

const KEY = 'timelog.v1';

// Open the app with a faked navigator.userAgent, dismiss the intro, then open the
// install-help modal from the menu. On desktop Chromium no `beforeinstallprompt`
// fires, so the install button falls through to openInstallHelp() — which is the
// platform-specific instruction path we want to assert on.
async function openInstallHelp(page, userAgent, { platform, maxTouchPoints } = {}) {
  await page.addInitScript(({ ua, platform, maxTouchPoints }) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => ua });
    // iPadOS reports a desktop-Mac UA but betrays itself via platform + touch —
    // that's how the app's isIOS check tells an iPad apart from a real Mac.
    if (platform !== undefined) Object.defineProperty(navigator, 'platform', { get: () => platform });
    if (maxTouchPoints !== undefined) Object.defineProperty(navigator, 'maxTouchPoints', { get: () => maxTouchPoints });
  }, { ua: userAgent, platform, maxTouchPoints });
  await page.goto('./');
  await page.evaluate((KEY) => {
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [], recentLabels: [],
      settings: { theme: 'light', introSeen: true, soundOn: true, notifyOn: false, intervalMin: 15 },
    }));
  }, KEY);
  await page.reload();
  await page.locator('#menuBtn').click();
  await page.locator('#installBtn').click();
  await expect(page.locator('#installScrim.show')).toBeVisible();
}

const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

test.describe('install help — platform-specific instructions', () => {
  test('macOS Safari: Share → "Zum Dock hinzufügen" (not the address-bar icon)', async ({ page }) => {
    await openInstallHelp(page, MAC_SAFARI);
    await expect(page.locator('#installTitle')).toHaveText('Auf dem Mac installieren');
    const body = page.locator('#installBody');
    await expect(body).toContainText('Zum Dock hinzufügen');
    // Must NOT show the Chrome/Edge address-bar instruction — Safari has no such icon.
    await expect(body).not.toContainText('Adressleiste');
    // Lead must not call it the "Home-Bildschirm" — that's an iOS term; on Mac it's the Dock.
    const lead = page.locator('#installLead');
    await expect(lead).toContainText('Dock');
    await expect(lead).not.toContainText('Home-Bildschirm');
  });

  test('macOS Chrome: keeps the address-bar install instruction', async ({ page }) => {
    await openInstallHelp(page, MAC_CHROME);
    await expect(page.locator('#installTitle')).toHaveText('Installieren');
    await expect(page.locator('#installBody')).toContainText('Adressleiste');
  });

  test('iPhone Safari: still the Home-Bildschirm flow', async ({ page }) => {
    await openInstallHelp(page, IPHONE);
    await expect(page.locator('#installTitle')).toHaveText('Auf iPhone / iPad installieren');
    await expect(page.locator('#installBody')).toContainText('Home-Bildschirm');
  });

  // iPadOS sends a Mac-like Safari UA; only platform=MacIntel + touch points give
  // it away. It must get the iOS Home-Bildschirm flow, NOT the Mac Dock flow.
  test('iPad masquerading as Mac: iOS flow wins, not the Mac Dock flow', async ({ page }) => {
    await openInstallHelp(page, MAC_SAFARI, { platform: 'MacIntel', maxTouchPoints: 5 });
    await expect(page.locator('#installTitle')).toHaveText('Auf iPhone / iPad installieren');
    const body = page.locator('#installBody');
    await expect(body).toContainText('Home-Bildschirm');
    await expect(body).not.toContainText('Zum Dock hinzufügen');
  });
});
