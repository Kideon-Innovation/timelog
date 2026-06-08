// Rasterize the brand SVGs into PWA PNG icons using the globally-installed
// Playwright Chromium. No ImageMagick / rsvg needed.
// Playwright is expected to be installed globally. Point PLAYWRIGHT_MODULE at the
// resolved @playwright/test entry, e.g.:
//   PLAYWRIGHT_MODULE="$(npm root -g)/@playwright/test/index.js" node scripts/generate-icons.mjs
// The generated PNGs are committed, so this only needs to run when the brand SVGs change.
const pwModule = process.env.PLAYWRIGHT_MODULE || '@playwright/test';
const pw = await import(pwModule).catch(() => {
  console.error(`Cannot load Playwright from "${pwModule}".\n` +
    'Set PLAYWRIGHT_MODULE to your global @playwright/test entry, e.g.\n' +
    '  PLAYWRIGHT_MODULE="$(npm root -g)/@playwright/test/index.js" node scripts/generate-icons.mjs');
  process.exit(1);
});
const { chromium } = pw.default || pw;
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'public/icons/icon.svg'), 'utf8');
const svgMask = readFileSync(resolve(root, 'public/icons/icon-maskable.svg'), 'utf8');

const jobs = [
  { svg, size: 192, out: 'public/icons/icon-192.png' },
  { svg, size: 512, out: 'public/icons/icon-512.png' },
  { svg, size: 180, out: 'public/icons/apple-touch-icon.png' },
  { svg, size: 32,  out: 'public/icons/favicon-32.png' },
  { svg, size: 16,  out: 'public/icons/favicon-16.png' },
  { svg: svgMask, size: 512, out: 'public/icons/icon-maskable-512.png' },
  { svg: svgMask, size: 192, out: 'public/icons/icon-maskable-192.png' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  const dataUri = 'data:image/svg+xml;base64,' + Buffer.from(j.svg).toString('base64');
  const html = `<!doctype html><html><body style="margin:0;width:${j.size}px;height:${j.size}px">
    <img src="${dataUri}" width="${j.size}" height="${j.size}" style="display:block"></body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  const buf = await page.locator('img').screenshot({ omitBackground: true });
  writeFileSync(resolve(root, j.out), buf);
  console.log('wrote', j.out, j.size + 'px', buf.length + 'b');
}
await browser.close();
