// Unit assertions for the "Morgen-Modus" (morning mode) gap suppression:
// after a night without logging, the app must NOT ask retroactive gap
// questions — only the present-tense dialog for the current slot. The pure
// decision logic lives in src/blocks.js (morningMode + the gapSlots guard);
// `now` is injected so every scenario is deterministic.
//
// Rule (all three must hold):
//   1. the latest logged block ended AT or BEFORE today 06:00 local,
//   2. `now` is strictly AFTER today 06:00 local,
//   3. no block starts at/after today 06:00 local.
// Then gapSlots(now) === [] (no retro questions; the night stays empty).
//
// Same browser-global stubbing pattern as tests/blocks.test.js — stubs must be
// in place BEFORE the dynamic import of state/blocks.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { iso } from '../src/time.js';

// --- minimal browser-global stubs (must exist before importing state/blocks) ---
function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
globalThis.localStorage = makeLocalStorage();
globalThis.window = { matchMedia: () => ({ matches: false }) };
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = { now: () => Date.now() };
}

let B; let S;
before(async () => {
  B = await import('../src/blocks.js');
  S = await import('../src/state.js');
});

// "Today" for these scenarios: 8 Jun 2026 (local). day 7 = yesterday.
const d = (day, h, m = 0) => new Date(2026, 5, day, h, m, 0);
const blk = (start, end, label) => ({ start: iso(start), end: iso(end), label });
// A 15-min block starting at the given local time.
const slot = (day, h, m, label = 'X') => blk(d(day, h, m), new Date(d(day, h, m).getTime() + 15 * 60000), label);

beforeEach(() => {
  S.state.blocks = [];
  S.state.recentLabels = [];
  S.setSlotMin(15);
});

test('MORNING_BOUNDARY_HOUR is the named 06:00 constant', () => {
  assert.equal(S.MORNING_BOUNDARY_HOUR, 6);
});

/* ---------- morningMode() decision ---------- */

test('morningMode: last block yesterday 23:00, now 09:30 → active', () => {
  S.state.blocks = [slot(7, 23, 0)];
  assert.equal(B.morningMode(d(8, 9, 30)), true);
});

test('morningMode: night work ending 03:15 today, now 09:30 → active', () => {
  S.state.blocks = [slot(8, 3, 0)];
  assert.equal(B.morningMode(d(8, 9, 30)), true);
});

test('morningMode: block ends exactly at 06:00 (05:45–06:00), now 06:30 → active', () => {
  S.state.blocks = [slot(8, 5, 45)];
  assert.equal(B.morningMode(d(8, 6, 30)), true);
});

test('morningMode: a block at 07:00 today exists, now 09:30 → NOT active', () => {
  S.state.blocks = [slot(7, 23, 0), slot(8, 7, 0)];
  assert.equal(B.morningMode(d(8, 9, 30)), false);
});

test('morningMode: block starting exactly at 06:00 counts as morning block → NOT active', () => {
  S.state.blocks = [slot(8, 6, 0)];
  assert.equal(B.morningMode(d(8, 9, 30)), false);
});

test('morningMode: now 05:30 (before boundary) → NOT active, night work keeps normal flow', () => {
  S.state.blocks = [slot(7, 23, 0)];
  assert.equal(B.morningMode(d(8, 5, 30)), false);
});

test('morningMode: now exactly 06:00 is not yet "after" the boundary → NOT active', () => {
  S.state.blocks = [slot(8, 5, 0)];
  assert.equal(B.morningMode(d(8, 6, 0)), false);
});

test('morningMode: no blocks at all (first-time user) → NOT active', () => {
  assert.equal(B.morningMode(d(8, 9, 30)), false);
});

test('morningMode: block straddling the boundary (05:45–06:15) ended after 06:00 → NOT active', () => {
  S.state.blocks = [blk(d(8, 5, 45), d(8, 6, 15), 'Nacht')];
  assert.equal(B.morningMode(d(8, 9, 30)), false);
});

/* ---------- gapSlots(now) under morning mode ---------- */

test('gapSlots: morning mode suppresses ALL retro gaps (yesterday 23:00 → now 09:30)', () => {
  S.state.blocks = [slot(7, 23, 0)];
  assert.deepEqual(B.gapSlots(d(8, 9, 30)), []);
});

test('gapSlots: morning mode after night work (03:00 block, now 09:30) → no gaps', () => {
  S.state.blocks = [slot(8, 3, 0)];
  assert.deepEqual(B.gapSlots(d(8, 9, 30)), []);
});

test('gapSlots: block at 07:00 today → NORMAL retro gaps within the 2h cap', () => {
  S.state.blocks = [slot(8, 7, 0)];
  const gaps = B.gapSlots(d(8, 9, 30));
  // cap window starts 07:30 (now-2h), last block ends 07:15 → gaps 07:30..09:15
  assert.equal(gaps.length, 8);
  assert.equal(iso(gaps[0]), iso(d(8, 7, 30)));
  assert.equal(iso(gaps[gaps.length - 1]), iso(d(8, 9, 15)));
});

test('gapSlots: before 06:00 the night keeps normal behaviour (now 05:30)', () => {
  S.state.blocks = [slot(7, 23, 0)];
  const gaps = B.gapSlots(d(8, 5, 30));
  // 2h cap → 03:30..05:15, all asked retroactively as before
  assert.equal(gaps.length, 8);
  assert.equal(iso(gaps[0]), iso(d(8, 3, 30)));
  assert.equal(iso(gaps[gaps.length - 1]), iso(d(8, 5, 15)));
});

test('gapSlots: after logging the current slot at 09:30, later ticks resume normal gaps but never re-ask the night', () => {
  // user was in morning mode and logged 09:30–09:45; next tick at 11:00
  S.state.blocks = [slot(7, 23, 0), slot(8, 9, 30)];
  assert.equal(B.morningMode(d(8, 11, 0)), false); // a block after 06:00 exists now
  const gaps = B.gapSlots(d(8, 11, 0));
  // gaps start after the 09:30 block (09:45), NOT in the night and NOT before the block
  assert.equal(iso(gaps[0]), iso(d(8, 9, 45)));
  assert.equal(gaps.length, 5); // 09:45, 10:00, 10:15, 10:30, 10:45
  assert.ok(gaps.every((g) => g.getTime() >= d(8, 9, 45).getTime()));
});

test('gapSlots: no blocks at all → [] (first-time user, unchanged)', () => {
  assert.deepEqual(B.gapSlots(d(8, 9, 30)), []);
});

/* ---------- interplay: morning mode × grouped catch-up ----------
   openCatchup renders groupGapRuns(gapSlots(now)). These compose the two
   features end-to-end at the data layer: in morning mode the composition
   yields NO runs (so the grouped catch-up dialog has nothing to show — only
   the present-tense ping appears), and once morning mode ends the normal
   gaps come back as grouped runs. */

test('interplay: morning mode → groupGapRuns(gapSlots(now)) is [] (no catch-up runs for the night)', () => {
  S.state.blocks = [slot(7, 23, 0)];
  assert.equal(B.morningMode(d(8, 9, 30)), true);
  assert.deepEqual(B.groupGapRuns(B.gapSlots(d(8, 9, 30))), []);
});

test('interplay: after the first morning block, daytime gaps group into ONE contiguous run', () => {
  // morning mode ended by the 09:30 block; next tick at 11:00 → gaps 09:45..10:45
  S.state.blocks = [slot(7, 23, 0), slot(8, 9, 30)];
  assert.equal(B.morningMode(d(8, 11, 0)), false);
  const runs = B.groupGapRuns(B.gapSlots(d(8, 11, 0)));
  assert.equal(runs.length, 1);
  assert.equal(iso(runs[0].start), iso(d(8, 9, 45)));
  assert.equal(iso(runs[0].end), iso(d(8, 11, 0)));
  assert.equal(runs[0].slots.length, 5); // 09:45, 10:00, 10:15, 10:30, 10:45
});

test('interplay: before 06:00 the night gap stays a normal grouped run (no morning suppression)', () => {
  S.state.blocks = [slot(7, 23, 0)];
  const runs = B.groupGapRuns(B.gapSlots(d(8, 5, 30)));
  // 2h cap → 03:30..05:15, contiguous → exactly one run
  assert.equal(runs.length, 1);
  assert.equal(iso(runs[0].start), iso(d(8, 3, 30)));
  assert.equal(iso(runs[0].end), iso(d(8, 5, 30)));
  assert.equal(runs[0].slots.length, 8);
});
