import { test, expect } from '@playwright/test';

const LONG = 'Mandant Müller-Lüdenscheidt & Partner Steuerberatungsgesellschaft mbH';

// Seed the calendar past the intro with a long label so truncation/legend assertions
// have something to bite on. `daysAgo` lets a test place a block in the past to make the
// export reminder overdue.
async function seed(page, { theme = 'light', daysAgo = 0 } = {}) {
  await page.goto('./');
  await page.evaluate(({ t, LONG, daysAgo }) => {
    const base = new Date(Date.now() - daysAgo * 86400000);
    const mk = (h, m, label) => {
      const s = new Date(base); s.setHours(h, m, 0, 0);
      const e = new Date(s.getTime() + 15 * 60000);
      return { start: s.toISOString(), end: e.toISOString(), label };
    };
    localStorage.setItem('timelog.v1', JSON.stringify({
      blocks: [mk(9, 0, LONG), mk(9, 15, LONG), mk(10, 30, 'Doku')],
      recentLabels: [LONG, 'Doku', 'Telefonat'],
      settings: { theme: t, introSeen: true, soundOn: true, notifyOn: false,
        intervalMin: 15, notifyNudgeDismissed: false },
    }));
    localStorage.removeItem('timelog.lastExport.v1');
  }, { t: theme, LONG, daysAgo });
  await page.reload();
  await page.waitForTimeout(1100);
}

async function closeModal(page) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.scrim.show').count())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

test('toast is exposed to assistive tech as a polite live region', async ({ page }) => {
  await seed(page);
  const toast = page.locator('#toast');
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast).toHaveAttribute('aria-live', 'polite');
});

test('legend chips truncate instead of wrapping and keep the full label on title', async ({ page }, testInfo) => {
  // The legend lives in the subbar, which is hidden on the narrow mobile layout.
  test.skip(testInfo.project.name === 'mobile', 'legend is display:none on mobile');
  await seed(page);
  await closeModal(page);
  const chip = page.locator('#legend .chip').filter({ hasText: 'Mandant Müller' }).first();
  await expect(chip).toBeVisible();
  // full text preserved for hover/AT
  await expect(chip).toHaveAttribute('title', LONG);
  // the label span clips with ellipsis (nowrap + hidden overflow) and the long
  // label is actually truncated rather than wrapped/overflowing.
  const lbl = chip.locator('.lbl');
  const css = await lbl.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { ws: cs.whiteSpace, ov: cs.overflow, te: cs.textOverflow,
             clipped: el.scrollWidth > el.clientWidth };
  });
  expect(css.ws).toBe('nowrap');
  expect(css.te).toBe('ellipsis');
  expect(css.clipped).toBe(true);
});

test('recent-label chips in edit dialog stay one line and never overflow the modal', async ({ page }) => {
  await seed(page);
  await closeModal(page);
  await page.locator('#cal .block').first().click();
  await expect(page.locator('#editScrim .modal')).toBeVisible();
  const chip = page.locator('#editChips .chip-b').filter({ hasText: 'Mandant Müller' }).first();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('title', LONG);
  const m = await chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    const chipsBox = el.parentElement.getBoundingClientRect();
    const chipBox = el.getBoundingClientRect();
    return {
      ws: cs.whiteSpace, te: cs.textOverflow,
      oneLine: el.clientHeight < 40,           // not wrapped to multiple rows
      withinContainer: chipBox.right <= chipsBox.right + 0.5, // no horizontal overflow
    };
  });
  expect(m.ws).toBe('nowrap');
  expect(m.te).toBe('ellipsis');
  expect(m.oneLine).toBe(true);
  expect(m.withinContainer).toBe(true);
});

test('only one notification banner shows at a time — the data-loss nudge wins', async ({ page }) => {
  // Block 8 days old + no prior export → export reminder overdue; notifications are
  // off → the notify nudge also qualifies. Only the export nudge may be visible.
  await seed(page, { daysAgo: 8 });
  await closeModal(page);
  await expect(page.locator('#exportNudge')).toBeVisible();
  await expect(page.locator('#notifyNudge')).toBeHidden();

  // Dismiss the export nudge → the notify nudge is now allowed to take its place.
  await page.locator('#exportNudgeDismiss').click();
  await expect(page.locator('#exportNudge')).toBeHidden();
  await expect(page.locator('#notifyNudge')).toBeVisible();
});

test('export dialog warns when Von is after Bis instead of silently showing 0', async ({ page }) => {
  await seed(page);
  await closeModal(page);
  await page.click('#menuBtn');
  await page.click('#exportBtn');
  await expect(page.locator('#exportScrim .modal')).toBeVisible();
  await page.fill('#expFrom', '2026-06-20');
  await page.fill('#expTo', '2026-06-01');
  await page.dispatchEvent('#expTo', 'change');
  const count = page.locator('#expCount');
  await expect(count).toHaveClass(/warn/);
  await expect(count).toContainText(/Von/);
  // Fixing the order clears the warning and restores the count.
  await page.fill('#expTo', '2026-06-30');
  await page.dispatchEvent('#expTo', 'change');
  await expect(count).not.toHaveClass(/warn/);
  await expect(count).toContainText(/Blöcke/);
});

// The inline #expCount warns on an inverted range, but pressing Export/DATEV
// anyway used to toast the generic "Nichts zu exportieren" — a different,
// confusing message for the same problem. Both export buttons must surface the
// same "Von liegt nach Bis" wording so the messages agree.
test('export buttons surface the inverted-range message instead of "Nichts zu exportieren"', async ({ page }) => {
  await seed(page);
  await closeModal(page);
  await page.click('#menuBtn');
  await page.click('#exportBtn');
  await expect(page.locator('#exportScrim .modal')).toBeVisible();
  await page.fill('#expFrom', '2026-06-20');
  await page.fill('#expTo', '2026-06-01');
  await page.dispatchEvent('#expTo', 'change');

  const toast = page.locator('#toast');

  // Excel export with an inverted range → "Von liegt nach Bis", NOT generic.
  await page.click('#expGo');
  await expect(toast).toContainText(/„Von“ liegt nach „Bis“/);
  await expect(toast).not.toContainText('Nichts zu exportieren');
  // The dialog must stay open so the user can fix the range.
  await expect(page.locator('#exportScrim .modal')).toBeVisible();

  // DATEV-Lohn export with an inverted range → same message. Provide the
  // mandatory Personalnummer/Lohnart so we reach the range check, not the
  // missing-config toast. The inputs live in a collapsed <details> — open it.
  await page.evaluate(() => { document.getElementById('datevDetails').open = true; });
  await page.fill('#datevPnr', '12345');
  await page.fill('#datevLa', '200');
  await page.click('#expDatev');
  await expect(toast).toContainText(/„Von“ liegt nach „Bis“/);
  await expect(toast).not.toContainText('Nichts zu exportieren');
});

test('heartbeat rail marks are not in the tab order but stay SR-discoverable', async ({ page }) => {
  await seed(page);
  await closeModal(page);
  const beat = page.locator('#cal .beat').first();
  if (!(await beat.count())) test.skip(true, 'no heartbeat runs for this day');
  await expect(beat).toHaveAttribute('role', 'img');
  await expect(beat).toHaveAttribute('aria-label', /Aktivitätsspur/);
  await expect(beat).toHaveAttribute('tabindex', '-1');
});
