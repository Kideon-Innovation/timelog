import { test, expect } from '@playwright/test';

async function seed(page, theme = 'light') {
  await page.goto('./');
  await page.evaluate((t) => {
    const now = new Date();
    const mk = (h, m, label) => {
      const s = new Date(now); s.setHours(h, m, 0, 0);
      const e = new Date(s.getTime() + 15 * 60000);
      return { start: s.toISOString(), end: e.toISOString(), label };
    };
    const s = {
      blocks: [mk(9, 0, 'Mandant Müller'), mk(9, 15, 'Mandant Müller'), mk(10, 30, 'Doku')],
      recentLabels: ['Mandant Müller', 'Doku', 'Telefonat'],
      settings: { theme: t, introSeen: true, soundOn: true, notifyOn: false, intervalMin: 15 },
    };
    localStorage.setItem('timelog.v1', JSON.stringify(s));
  }, theme);
  await page.reload();
  await page.waitForTimeout(1100);
}

test('range label avoids a single-day dash on the 1-column view', async ({ page }, testInfo) => {
  await seed(page);
  const label = (await page.locator('#rangeLabel').innerText()).trim();
  // number of day columns rendered === DAY_COLS
  const cols = await page.locator('#cal .daycol').count();
  if (cols === 1) {
    // single day → no "X. – X." dash range, and a weekday prefix is present
    expect(label).not.toMatch(/–/);
    expect(label).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So),/);
  } else {
    // multi-day desktop view still shows the dash
    expect(label).toMatch(/–/);
  }
});

test('toggle menu items reflect on/off state via aria-pressed', async ({ page }) => {
  await seed(page, 'dark');
  await page.keyboard.press('Escape'); // close any auto modal
  await page.click('#menuBtn');
  // theme is dark → themeBtn aria-pressed true
  await expect(page.locator('#themeBtn')).toHaveAttribute('aria-pressed', 'true');
  // sound is on → soundBtn aria-pressed true
  await expect(page.locator('#soundBtn')).toHaveAttribute('aria-pressed', 'true');
  // notifications off → notifyBtn aria-pressed false
  await expect(page.locator('#notifyBtn')).toHaveAttribute('aria-pressed', 'false');
});

test('pinned modal footer stays visible with a long catch-up list', async ({ page }) => {
  await seed(page);
  // catch-up auto-opens (morning blocks + now → many gaps)
  if (!(await page.locator('#pingScrim.show').count())) test.skip(true, 'no catch-up gaps');
  const footer = page.locator('#pingScrim .modal-f');
  await expect(footer).toBeVisible();
  // the "Speichern" action lives in the footer and must be in view
  const save = footer.getByText('Speichern');
  if (await save.count()) await expect(save).toBeInViewport();
  // footer must NOT scroll away — it's a flex:0 0 auto child, body scrolls instead
  const footerScrolls = await page.evaluate(() => {
    const f = document.querySelector('#pingScrim .modal-f');
    const b = document.querySelector('#pingScrim .modal-b');
    return { bodyScrollable: b.scrollHeight > b.clientHeight + 1, footerFlex: getComputedStyle(f).flexGrow };
  });
  expect(footerScrolls.footerFlex).toBe('0');
});

test('overflow menu stays fully within the viewport on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'menu clipping only reproduces on the narrow viewport');
  await seed(page);
  await page.keyboard.press('Escape'); // close any auto modal
  await page.click('#menuBtn');
  const menu = page.locator('#menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const vw = page.viewportSize().width;
  expect(box).not.toBeNull();
  // The whole menu (incl. its left edge with the "Blockgröße" row) must be on-screen.
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
});

test('empty today column shows onboarding guidance', async ({ page }) => {
  // seed with NO blocks so today is empty
  await page.goto('./');
  await page.evaluate(() => {
    localStorage.setItem('timelog.v1', JSON.stringify({
      blocks: [], recentLabels: [],
      settings: { theme: 'light', introSeen: true, soundOn: true, notifyOn: false, intervalMin: 15 },
    }));
  });
  await page.reload();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // close any auto modal
  const hint = page.locator('#cal .daycol.today .empty-hint, #cal .empty-hint').first();
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(/Noch nichts erfasst|ziehen zum Eintragen/);
});
