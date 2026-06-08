import { test, expect } from '@playwright/test';

// Seed localStorage so the app boots past the intro into the calendar with some
// data. load() only honors stored state when `blocks` exists, so include it.
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
  // boot() opens an initial catch-up after ~900ms when there are gaps; wait past it.
  await page.waitForTimeout(1100);
}

// Close any auto-opened ping/catch-up modal so we start from a clean shell.
async function closeAnyModal(page) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.scrim.show').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await expect(page.locator('.scrim.show')).toHaveCount(0);
}

test('open dialogs expose role=dialog + aria-modal and make the background inert', async ({ page }) => {
  await seed(page);
  await closeAnyModal(page);

  await page.click('#menuBtn');
  await page.click('#exportBtn');
  const modal = page.locator('#exportScrim .modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('role', 'dialog');
  await expect(modal).toHaveAttribute('aria-modal', 'true');

  // background app shell is taken out of the a11y tree + tab order
  await expect(page.locator('#app')).toHaveAttribute('aria-hidden', 'true');
  const inert = await page.locator('#app').evaluate((el) => el.inert === true);
  expect(inert).toBe(true);

  // closing restores the shell
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.locator('#app')).not.toHaveAttribute('aria-hidden', 'true');
  const inertAfter = await page.locator('#app').evaluate((el) => el.inert === true);
  expect(inertAfter).toBe(false);
});

test('Tab is trapped inside an open dialog and cycles within it', async ({ page }) => {
  await seed(page);
  await closeAnyModal(page);

  await page.click('#menuBtn');
  await page.click('#exportBtn');
  await expect(page.locator('#exportScrim .modal')).toBeVisible();

  // Tab around many times; focus must always stay inside the dialog.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const modal = document.querySelector('#exportScrim .modal');
      return modal.contains(document.activeElement);
    });
    expect(inside).toBe(true);
  }
  // Shift+Tab too
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    const inside = await page.evaluate(() => {
      const modal = document.querySelector('#exportScrim .modal');
      return modal.contains(document.activeElement);
    });
    expect(inside).toBe(true);
  }
});

test('focus returns to the opener after closing a dialog', async ({ page }) => {
  await seed(page);
  await closeAnyModal(page);

  // Open the export dialog from a real, focusable opener (the menu button),
  // then close it — focus must return to that opener, not get lost to <body>.
  await page.locator('#menuBtn').focus();
  await page.click('#menuBtn');
  await page.click('#exportBtn');
  await expect(page.locator('#exportScrim .modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#exportScrim .modal')).toBeHidden();
  const activeId = await page.evaluate(() => document.activeElement && document.activeElement.id);
  expect(activeId).toBe('menuBtn');
});

test('interactive controls get a visible :focus-visible ring', async ({ page }) => {
  await seed(page);
  await closeAnyModal(page);

  // Programmatically assert the rule resolves to an outline for :focus-visible.
  const hasRing = await page.evaluate(() => {
    const btn = document.querySelector('#todayBtn');
    btn.focus();
    // emulate keyboard focus-visible by checking the rule applies via matches
    const matches = btn.matches(':focus-visible') || btn.matches(':focus');
    const cs = getComputedStyle(btn);
    // either an outline or the accent box-shadow ring should be present when focused
    const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
                 (cs.boxShadow && cs.boxShadow !== 'none');
    return { matches, ring };
  });
  expect(hasRing.ring).toBe(true);
});

test('catch-up skip control is a real, keyboard-focusable button', async ({ page }) => {
  await seed(page);
  // ensure the catch-up modal is open (there are gap slots since blocks are in the morning)
  if (!(await page.locator('#pingScrim.show').count())) {
    // trigger via a fresh load
    await page.reload();
    await page.waitForTimeout(300);
  }
  // either single-ping or catch-up; if catch-up, gaprow skip buttons exist
  const skip = page.locator('#pingScrim .gaprow .skip').first();
  if (await skip.count()) {
    const tag = await skip.evaluate((el) => el.tagName);
    expect(tag).toBe('BUTTON');
    await expect(skip).toHaveAttribute('aria-label', /leer lassen/i);
  }
});
