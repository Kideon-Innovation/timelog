import { test, expect } from '@playwright/test';

// Two open instances (PWA window + browser tab share one localStorage) — QA
// finding C1. Before the fix, each tab held its own full in-memory copy and
// save() blind-wrote it: tab A logs an entry, tab B then performs ANY saving
// action (e.g. theme toggle) → B's stale copy overwrites storage and A's entry
// is gone. Now save() merges the current storage content first and a `storage`
// listener pulls foreign writes into memory (+ re-render).

const KEY = 'timelog.v1';
const SLOT = 15 * 60000;

// Seed: intro dismissed, last slot fully logged up to the live slot so no
// catch-up modal interferes, plus a future anchor block that defeats
// Morgen-Modus around 06:00 (same trick as catchup.spec.js).
async function seed(page) {
  await page.goto('./');
  await page.evaluate(({ KEY, SLOT }) => {
    const floor = (t) => { const d = new Date(t); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0); return d; };
    const cur = floor(new Date()).getTime();
    const mk = (start, label) => ({
      start: new Date(start).toISOString(),
      end: new Date(start + SLOT).toISOString(), label,
    });
    localStorage.setItem(KEY, JSON.stringify({
      blocks: [mk(cur - SLOT, 'Mandant Müller'), mk(cur + 4 * SLOT, 'Mandant Müller')],
      recentLabels: ['Mandant Müller'],
      settings: { theme: 'light', introSeen: true, soundOn: false, notifyOn: false, intervalMin: 15 },
    }));
  }, { KEY, SLOT });
  await page.reload();
  await page.waitForTimeout(1100);
}

test('C1: an entry logged in tab A survives a saving action in tab B', async ({ context, page }) => {
  // Crossing a slot boundary mid-test would open a legit catch-up modal over
  // the UI we drive; if one is imminent, sit it out (rare, bounded).
  const msLeft = SLOT - (Date.now() % SLOT);
  if (msLeft < 12000) await new Promise((r) => setTimeout(r, msLeft + 200));

  const tabA = page;
  await seed(tabA);
  const tabB = await context.newPage();
  await tabB.goto('./');
  await tabB.waitForTimeout(1100);

  // Tab A: log the current slot.
  await tabA.click('#logNowBtn');
  await expect(tabA.locator('#pingScrim.show')).toHaveCount(1);
  // .first(): the M7 range disclosure added Datum/Von/Bis .txt inputs to the
  // manual dialog — the label field is the first one.
  await tabA.locator('#pingScrim #pingBody input.txt').first().fill('Crosstab-Eintrag');
  await tabA.locator('#pingScrim #pingFoot button.amber').click();
  await expect(tabA.locator('#cal .block .lbl', { hasText: 'Crosstab-Eintrag' })).toHaveCount(1);

  // Tab B re-renders A's entry via the storage event (no reload).
  await expect(tabB.locator('#cal .block .lbl', { hasText: 'Crosstab-Eintrag' })).toHaveCount(1);

  // Tab B: a state-saving action (theme toggle) — the original data-loss trigger.
  await tabB.click('#menuBtn');
  await tabB.click('#themeBtn');
  await expect(tabB.locator('html')).toHaveAttribute('data-theme', 'dark');

  // A's entry is still in storage AND still painted in both tabs.
  const labels = await tabB.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)).blocks.map((b) => b.label), KEY);
  expect(labels).toContain('Crosstab-Eintrag');
  await expect(tabB.locator('#cal .block .lbl', { hasText: 'Crosstab-Eintrag' })).toHaveCount(1);
  await expect(tabA.locator('#cal .block .lbl', { hasText: 'Crosstab-Eintrag' })).toHaveCount(1);

  // …and B's theme change reached tab A (settings merge in the other direction).
  await expect(tabA.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Survives a reload of tab B (storage really holds the merge).
  await tabB.reload();
  await tabB.waitForTimeout(1100);
  await expect(tabB.locator('#cal .block .lbl', { hasText: 'Crosstab-Eintrag' })).toHaveCount(1);
});
