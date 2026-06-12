import { test, expect } from '@playwright/test';

// "Deine Daten verlassen nie dieses Gerät" is the core sales pitch (intro lead,
// DSGVO/§203-StGB badges). That promise must hold at the network level from the
// very first request: NO request may leave the local origin — not even for
// fonts (Google-Fonts CDN leaks the visitor's IP; LG München I, 3 O 17493/20).
// Fonts are self-hosted in src/fonts/ — this guards against the CDN sneaking back in.

test('app loads without a single request to an external host', async ({ page, baseURL }) => {
  const allowedHosts = new Set([new URL(baseURL).hostname, 'localhost', '127.0.0.1']);
  const external = [];
  page.on('request', (req) => {
    const host = new URL(req.url()).hostname;
    if (host && !allowedHosts.has(host)) external.push(req.url());
  });

  await page.goto('./');
  // First-run intro shows → dismiss into the app shell, exercise a dialog.
  await page.locator('#introStart').click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500); // let SW registration + any lazy loads settle

  expect(external, `external requests detected:\n${external.join('\n')}`).toEqual([]);
});

test('self-hosted webfonts actually load (no silent fallback to system fonts)', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => ({
    sans: document.fonts.check('14px "DM Sans"'),
    serif: document.fonts.check('30px "Instrument Serif"'),
    mono: document.fonts.check('22px "JetBrains Mono"'),
  }));
  expect(loaded).toEqual({ sans: true, serif: true, mono: true });
});
