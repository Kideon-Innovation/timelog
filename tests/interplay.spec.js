import { test, expect } from '@playwright/test';

// Interplay of the QA fixes that landed on separate branches and meet here:
//
//   M2 × M3/M4 — "Alle leer lassen" persists the skips (M2). The same gaps
//        must then stay quiet on EVERY ping delivery path the robustness
//        fixes route through: the visibilitychange catch-up (M3/M4's
//        deferred delivery) and boot's initial catch-up.
//   M7 × M2 — "Nicht am PC / leer lassen" in the manual dialog with an
//        EDITED Datum/Von/Bis range clears that range via fillRange("");
//        every slot of the edited range must also be marked skipped, or the
//        very gaps the user just answered would re-ping at the next boundary.
//
// Same real-clock seed pattern as leave-empty.spec.js / catchup.spec.js.

const KEY = 'timelog.v1';
const SKIP_KEY = 'timelog.skipped.v1';
const SLOT = 15 * 60000;

async function seedGapsAndBoot(page, gapSlotCount = 4) {
  // Crossing a slot boundary mid-test would create a new, legitimately
  // un-answered gap; if one is imminent, sit it out first.
  const msLeft = SLOT - (Date.now() % SLOT);
  if (msLeft < 12000) await new Promise((r) => setTimeout(r, msLeft + 200));
  await page.goto('./');
  await page.evaluate(({ KEY, gapSlotCount, SLOT }) => {
    const floor = (t) => { const d = new Date(t); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0); return d; };
    const cur = floor(new Date()).getTime();
    const mk = (start, label) => ({
      start: new Date(start).toISOString(),
      end: new Date(start + SLOT).toISOString(), label,
    });
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [
        mk(cur - (gapSlotCount + 1) * SLOT, 'Mandant Müller'),
        mk(cur + 4 * SLOT, 'Anker'), // future anchor: defeats Morgen-Modus
      ],
      recentLabels: ['Mandant Müller', 'Doku'],
      settings: {
        theme: 'light', introSeen: true, soundOn: false, notifyOn: false,
        notifyNudgeDismissed: true, intervalMin: 15,
      },
    }));
  }, { KEY, gapSlotCount, SLOT });
  await page.reload();
  await page.waitForTimeout(1300); // boot's 900ms initial catch-up timer
  await expect(page.locator('#pingScrim.show')).toBeVisible();
}

const tabReturn = (page) =>
  page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

const storedState = (page) =>
  page.evaluate(({ KEY, SKIP_KEY }) => ({
    blocks: JSON.parse(localStorage.getItem(KEY)).blocks,
    skipped: JSON.parse(localStorage.getItem(SKIP_KEY) || '[]'),
  }), { KEY, SKIP_KEY });

test('M2 × M3/M4: "Alle leer lassen" silences the deferred/visibility re-ping paths too', async ({ page }) => {
  await seedGapsAndBoot(page);

  // M3 while the dialog is open: a tab return must not rebuild the body.
  const input = page.locator('#pingBody .gaprun .gaprow input').first();
  await input.fill('Telefonat');
  await tabReturn(page);
  await expect(input).toHaveValue('Telefonat');

  // Answer with "Alle leer lassen" → skips persisted (M2).
  await page.locator('#pingFoot .btn.ghost', { hasText: 'Alle leer lassen' }).click();
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  expect((await storedState(page)).skipped).toHaveLength(4);

  // The visibilitychange catch-up (the path M4 defers into) must stay quiet —
  // the gaps were answered, there is nothing to deliver.
  await tabReturn(page);
  await page.waitForTimeout(400);
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);

  // …and so must boot's initial catch-up after a reload.
  await page.reload();
  await page.waitForTimeout(1300);
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
});

test('M7 × M2: "Nicht am PC" over an edited range skips every slot of that range', async ({ page }) => {
  // The edited range below spans the last hour; just after midnight it would
  // cross a calendar day, which a single Datum field cannot express.
  test.skip(new Date().getHours() === 0, 'gap range would cross midnight');
  await seedGapsAndBoot(page);

  // Dismiss the boot catch-up WITHOUT answering (Esc) — gaps stay open.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  expect((await storedState(page)).skipped).toHaveLength(0);

  // Manual dialog, range edited to cover exactly the 4 open gap slots.
  await page.locator('#logNowBtn').click();
  await expect(page.locator('#pingKick')).toHaveText('MANUELL EINTRAGEN');
  await page.locator('#pingBody details.edit-split summary').click();
  const range = await page.evaluate(() => {
    const z = (n) => String(n).padStart(2, '0');
    const cur = new Date(); cur.setMinutes(Math.floor(cur.getMinutes() / 15) * 15, 0, 0);
    const from = new Date(cur.getTime() - 4 * 15 * 60000);
    return {
      date: from.getFullYear() + '-' + z(from.getMonth() + 1) + '-' + z(from.getDate()),
      from: z(from.getHours()) + ':' + z(from.getMinutes()),
      to: z(cur.getHours()) + ':' + z(cur.getMinutes()),
    };
  });
  await page.locator('#pingDate').fill(range.date);
  await page.locator('#pingFrom').fill(range.from);
  await page.locator('#pingTo').fill(range.to);
  await page.locator('#pingFoot .btn.ghost', { hasText: 'Nicht am PC' }).click();
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);

  // The whole edited range counts as answered: 4 skips, no phantom blocks,
  // the two seed blocks untouched.
  const { blocks, skipped } = await storedState(page);
  expect(skipped).toHaveLength(4);
  expect(blocks).toHaveLength(2);

  // No re-ping — neither on a tab return nor on the next boot.
  await tabReturn(page);
  await page.waitForTimeout(400);
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(1300);
  await expect(page.locator('#pingScrim.show')).toHaveCount(0);
});
