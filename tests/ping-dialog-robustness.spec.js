import { test, expect } from '@playwright/test';

// Ping/dialog robustness — QA findings M3, M4, N1, N2.
//
//   M3 — a tab return (visibilitychange) or boundary tick while the catch-up
//        is already open must NOT rebuild the dialog body: typed text survives.
//   M4 — a ping must never stack on top of another open dialog (edit/export/…);
//        it is deferred and delivered once the dialog is closed.
//   N1 — the single-ping kicker reflects the configured block size
//        ("30-MINUTEN-PING" at 30 min), not a hardcoded "15".
//   N2 — the catch-up focuses its first gap input once the scrim is visible
//        (same 60ms pattern as the single ping).
//
// Same real-clock seed pattern as tests/catchup.spec.js: a filler block ending
// `gapSlotCount` slots before now plus a FUTURE anchor block that defeats
// Morgen-Modus without adding gaps.

const KEY = 'timelog.v1';

async function seedGaps(page, { gapSlotCount = 4, intervalMin = 15 } = {}) {
  // Crossing a slot boundary mid-test would shift the live slot and change the
  // gap count; if we're within a few seconds of one, sit it out first.
  const slotMs = intervalMin * 60000;
  const msLeft = slotMs - (Date.now() % slotMs);
  if (msLeft < 10000) await new Promise((r) => setTimeout(r, msLeft + 200));
  await page.goto('./');
  await page.evaluate(({ KEY, gapSlotCount, intervalMin }) => {
    const slotMs = intervalMin * 60000;
    const floor = (t) => {
      const d = new Date(t);
      d.setMinutes(Math.floor(d.getMinutes() / intervalMin) * intervalMin, 0, 0);
      return d;
    };
    const cur = floor(new Date()).getTime();
    const mk = (start, label) => ({
      start: new Date(start).toISOString(),
      end: new Date(start + slotMs).toISOString(), label,
    });
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [
        mk(cur - (gapSlotCount + 1) * slotMs, 'Mandant Müller'),
        // future anchor: defeats Morgen-Modus, invisible to gapSlots()
        mk(cur + 4 * slotMs, 'Anker'),
      ],
      recentLabels: ['Mandant Müller', 'Doku'],
      settings: {
        theme: 'light', introSeen: true, soundOn: false, notifyOn: false,
        notifyNudgeDismissed: true, intervalMin,
      },
    }));
  }, { KEY, gapSlotCount, intervalMin });
  await page.reload();
  await page.waitForTimeout(1300); // boot's 900ms initial catch-up timer
}

// Simulate returning to the tab: the page is visible (document.hidden=false),
// so dispatching visibilitychange runs the real "back on the tab" handler.
const tabReturn = (page) =>
  page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('M3: typed catch-up text survives a tab return', async ({ page }) => {
  await seedGaps(page);
  await expect(page.locator('#pingScrim.show')).toBeVisible();
  const input = page.locator('#pingBody .gaprun .gaprow input').first();
  await input.fill('Telefonat Müller');

  await tabReturn(page);

  await expect(page.locator('#pingScrim.show')).toBeVisible();
  await expect(page.locator('#pingBody .gaprun')).toHaveCount(1); // not rebuilt
  await expect(input).toHaveValue('Telefonat Müller');            // text NOT lost
});

test('M4: a ping never stacks on top of an open edit dialog — it is deferred', async ({ page }) => {
  await seedGaps(page);
  await expect(page.locator('#pingScrim.show')).toBeVisible();
  // Dismiss WITHOUT saving ("Alle leer lassen") — the gaps stay open.
  await page.locator('#pingFoot .btn.ghost').click();
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);

  // Open the edit dialog on the seeded past block.
  await page.locator('#cal .block', { hasText: 'Mandant Müller' }).first().click();
  await expect(page.locator('#editScrim.show')).toBeVisible();

  // Tab return with gaps pending: the ping must NOT open over the edit dialog.
  await tabReturn(page);
  await expect(page.locator('#editScrim.show')).toBeVisible();
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  await expect(page.locator('.scrim.show')).toHaveCount(1);

  // Esc closes ONLY the edit dialog (nothing stacked underneath)…
  await page.keyboard.press('Escape');
  await expect(page.locator('.scrim.show')).toHaveCount(0);

  // …and the deferred ping is delivered on the next tab return.
  await tabReturn(page);
  await expect(page.locator('#pingScrim.show')).toBeVisible();
});

test('Enter-committing the edit dialog closes it for good (no ghost reopen)', async ({ page }) => {
  // Same Chromium quirk the manual ping had: closing on Enter keydown restores
  // focus to the opener (the calendar block), and the keydown's default
  // activation click then lands on that block — reopening the dialog.
  await seedGaps(page);
  await expect(page.locator('#pingScrim.show')).toBeVisible();
  await page.locator('#pingFoot .btn.ghost').click(); // dismiss catch-up
  await page.locator('#cal .block', { hasText: 'Mandant Müller' }).first().click();
  await expect(page.locator('#editScrim.show')).toBeVisible();

  const inp = page.locator('#editInput');
  await inp.fill('Mandant Meier');
  await inp.press('Enter');

  await expect(page.locator('#editScrim.show')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.locator('.scrim.show')).toHaveCount(0); // stays closed
});

test('Enter-committing the drag range dialog does not ghost-click the menu open', async ({ page }) => {
  // Variant of the same Chromium quirk: the range-entry dialog is opened by a
  // pointer drag, so closeScrim's focus restore falls back to #menuBtn — and
  // the committing Enter keydown's default activation click landed there,
  // popping the hamburger menu open right after saving.
  const slotMs = 15 * 60000;
  await page.goto('./');
  await page.evaluate(({ KEY, slotMs }) => {
    const cur = Math.floor(Date.now() / slotMs) * slotMs;
    localStorage.setItem(KEY, JSON.stringify({
      // one past block ending at the current slot → gapSlots() === [] → no ping
      blocks: [{ start: new Date(cur - slotMs).toISOString(), end: new Date(cur).toISOString(), label: 'Past' }],
      recentLabels: ['Past'],
      settings: {
        theme: 'light', introSeen: true, soundOn: false, notifyOn: false,
        notifyNudgeDismissed: true, intervalMin: 15,
      },
    }));
  }, { KEY, slotMs });
  await page.reload();
  await page.waitForTimeout(1300);

  // Drag a range on today's column (same approach as core-flow.spec.js).
  const col = page.locator('#cal .daycol.today').first();
  const span = await col.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const head = el.querySelector('.col-head');
    const headBottom = head ? head.getBoundingClientRect().bottom : r.top;
    return { x: r.left + r.width / 2, top: Math.max(r.top, headBottom) + 8 };
  });
  await page.mouse.move(span.x, span.top + 10);
  await page.mouse.down();
  await page.mouse.move(span.x, span.top + 30);
  await page.mouse.move(span.x, span.top + 90);
  await page.mouse.up();
  await expect(page.locator('#pingKick')).toHaveText('ZEITRAUM EINTRAGEN');

  const input = page.locator('#pingScrim #pingBody input.txt');
  await input.fill('Akte Nord');
  await input.press('Enter');

  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.locator('#menu')).toBeHidden();   // menu must NOT pop open
  await expect(page.locator('.scrim.show')).toHaveCount(0);
});

test('N1: the single-ping kicker shows the configured block size', async ({ page }) => {
  await seedGaps(page, { gapSlotCount: 1, intervalMin: 30 });
  await expect(page.locator('#pingScrim.show')).toBeVisible();
  await expect(page.locator('#pingKick')).toHaveText('30-MINUTEN-PING');
});

test('N2: the catch-up focuses its first gap input on open', async ({ page }) => {
  await seedGaps(page);
  await expect(page.locator('#pingScrim.show')).toBeVisible();
  await expect(page.locator('#pingBody .gaprun .gaprow input').first()).toBeFocused();
});
