// Unit assertions for the deliberately-left-empty slot store (QA finding M2):
// skipping a slot ("Nicht am PC", run-✕/slot-✕, "Alle leer lassen") creates no
// block, so without persistence gapSlots() re-reported it as a gap at EVERY
// boundary — beep + dialog every 15 min for an already-answered slot.
// markSkipped() persists those slot starts under timelog.skipped.v1 (own key,
// never inside timelog.v1 → can never leak into the Excel export or the
// calendar) and gapSlots() excludes them.
//
// Same stub pattern as blocks.test.js.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { iso } from '../src/time.js';

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

const SKIP_KEY = 'timelog.skipped.v1';
let B; let S;
before(async () => {
  B = await import('../src/blocks.js');
  S = await import('../src/state.js');
});

const at = (h, m = 0) => new Date(2026, 5, 8, h, m, 0); // 8 Jun 2026, local
const blk = (start, end, label) => ({ start: iso(start), end: iso(end), label });
// deterministic "now": 12:07 → live slot 12:00, catch-up window from 10:00
const NOW = at(12, 7);

function reset() {
  S.state.blocks = [blk(at(10), at(10, 15), 'Mandant')]; // last end 10:15
  S.state.recentLabels = [];
  S.setSlotMin(15);
  localStorage.removeItem(SKIP_KEY);
}

test('without skips, every unfilled slot up to the live one is a gap', () => {
  reset();
  const gaps = B.gapSlots(NOW);
  assert.equal(gaps.length, 7); // 10:15 … 11:45
  assert.equal(gaps[0].getTime(), at(10, 15).getTime());
  assert.equal(gaps[6].getTime(), at(11, 45).getTime());
});

test('markSkipped removes those slots from gapSlots — the M2 re-ping fix', () => {
  reset();
  B.markSkipped([at(10, 15), at(10, 30)], NOW);
  const gaps = B.gapSlots(NOW);
  assert.equal(gaps.length, 5);
  assert.equal(gaps[0].getTime(), at(10, 45).getTime());
  // skipping the rest silences the catch-up entirely
  B.markSkipped(gaps, NOW);
  assert.deepEqual(B.gapSlots(NOW), []);
});

test('skips are persisted under their own key and never touch state.blocks', () => {
  reset();
  B.markSkipped([at(11)], NOW);
  const stored = JSON.parse(localStorage.getItem(SKIP_KEY));
  assert.deepEqual(stored, [iso(at(11))]);
  // nothing leaked into the block list → calendar render and Excel export
  // (both read state.blocks) can never show a deliberately-empty slot
  assert.equal(S.state.blocks.length, 1);
  assert.ok(!JSON.parse(localStorage.getItem(S.KEY) || '{"blocks":[]}')
    .blocks.some((b) => b.start === iso(at(11))));
});

test('gapSlots honours skips written by ANOTHER instance (re-reads storage)', () => {
  reset();
  // simulate another tab / a previous session having written the skip store
  localStorage.setItem(SKIP_KEY, JSON.stringify([iso(at(10, 15))]));
  const gaps = B.gapSlots(NOW);
  assert.equal(gaps.length, 6);
  assert.equal(gaps[0].getTime(), at(10, 30).getTime());
});

test('markSkipped merges additively with stored skips and prunes stale ones', () => {
  reset();
  const stale = iso(new Date(NOW.getTime() - 25 * 3600000)); // > 24h old
  localStorage.setItem(SKIP_KEY, JSON.stringify([stale, iso(at(10, 15))]));
  B.markSkipped([at(10, 30)], NOW);
  const stored = JSON.parse(localStorage.getItem(SKIP_KEY));
  assert.ok(!stored.includes(stale), 'stale entry pruned');
  assert.ok(stored.includes(iso(at(10, 15))), 'existing skip kept (additive merge)');
  assert.ok(stored.includes(iso(at(10, 30))), 'new skip added');
});

test('a corrupt skip store degrades to "no skips" instead of crashing', () => {
  reset();
  localStorage.setItem(SKIP_KEY, '{not json');
  assert.equal(B.gapSlots(NOW).length, 7);
  B.markSkipped([at(10, 15)], NOW); // overwrites the corrupt payload
  assert.deepEqual(JSON.parse(localStorage.getItem(SKIP_KEY)), [iso(at(10, 15))]);
});

test('a slot with a real block does not also need a skip to stay quiet', () => {
  reset();
  B.setBlock(at(10, 15), 'Doku');
  const gaps = B.gapSlots(NOW);
  assert.equal(gaps.length, 6);
  assert.ok(!gaps.some((g) => g.getTime() === at(10, 15).getTime()));
});
