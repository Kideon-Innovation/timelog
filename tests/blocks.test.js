// Unit assertions for the pure block/domain layer extracted into src/blocks.js.
// These pin the CURRENT behaviour so the extraction (and any future change) is
// provably behaviour-preserving. Pure ESM, no DOM — run with Node's built-in
// test runner: `node --test tests/blocks.test.js`.
//
// blocks.js → state.js touch a handful of browser globals at *module-init*
// time (localStorage, window.matchMedia, performance). We install minimal
// in-memory stubs BEFORE importing so the modules load in Node unchanged. The
// import is therefore dynamic (after the stubs are in place).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { iso, minOfDay } from '../src/time.js';

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

// Imported after stubs are in place. Filled in the `before` hook.
let B; let S;
before(async () => {
  B = await import('../src/blocks.js');
  S = await import('../src/state.js');
});

// Convenience: build a block object the way the app stores them.
const blk = (start, end, label) => ({ start: iso(start), end: iso(end), label });
const at = (h, m = 0) => new Date(2026, 5, 8, h, m, 0); // 8 Jun 2026, local

// Reset state.blocks/recentLabels between tests for isolation.
function resetState() {
  S.state.blocks = [];
  S.state.recentLabels = [];
  S.setSlotMin(15);
}

test('colorFor is deterministic and stays inside the palette', () => {
  resetState();
  assert.equal(B.colorFor('Mandant A'), B.colorFor('Mandant A')); // stable
  assert.ok(S.PALETTE.includes(B.colorFor('Mandant A')));
  assert.ok(S.PALETTE.includes(B.colorFor('')));
  assert.ok(S.PALETTE.includes(B.colorFor('völlig anderes Label 123')));
  // different labels generally map to palette entries; same label never drifts
  const a = B.colorFor('x'); const b = B.colorFor('x');
  assert.equal(a, b);
});

test('tint appends the fill-alpha suffix', () => {
  assert.equal(B.tint('#abcdef'), '#abcdef3a');
});

test('blocksInRange returns blocks that overlap [s,e) (half-open)', () => {
  resetState();
  S.state.blocks = [
    blk(at(9), at(9, 15), 'A'),   // fully inside
    blk(at(8), at(9), 'B'),       // ends exactly at range start → excluded
    blk(at(10), at(10, 15), 'C'), // ends exactly at range end → excluded (be>S false at edge)
    blk(at(8, 30), at(9, 30), 'D'), // straddles start → included
  ];
  const out = B.blocksInRange(at(9), at(10));
  const labels = out.map((b) => b.label).sort();
  assert.deepEqual(labels, ['A', 'D']);
});

test('clearRange clips straddling blocks and drops fully-covered ones', () => {
  resetState();
  S.state.blocks = [
    blk(at(8), at(8, 30), 'before'),   // wholly before → kept untouched
    blk(at(8, 45), at(9, 15), 'left'), // straddles left edge → clipped to end 09:00
    blk(at(9, 15), at(9, 45), 'mid'),  // fully inside → removed
    blk(at(9, 45), at(10, 15), 'right'), // straddles right edge → clipped to start 10:00
    blk(at(11), at(11, 30), 'after'),  // wholly after → kept untouched
  ];
  B.clearRange(at(9), at(10));
  const byLabel = Object.fromEntries(S.state.blocks.map((b) => [b.label, b]));
  assert.ok(byLabel.before && byLabel.after);   // untouched edges survive
  assert.equal(byLabel.mid, undefined);          // fully-covered removed
  assert.equal(byLabel.left.end, iso(at(9)));    // left remainder clipped to S
  assert.equal(byLabel.left.start, iso(at(8, 45)));
  assert.equal(byLabel.right.start, iso(at(10))); // right remainder clipped to E
  assert.equal(byLabel.right.end, iso(at(10, 15)));
});

test('fillRange paints slot-sized blocks across [s,e), clipping the final slot', () => {
  resetState();
  S.setSlotMin(15);
  B.fillRange(at(9), at(9, 40), 'Task'); // 40 min @ 15 → 09:00, 09:15, 09:30(→09:40 clip)
  const sorted = [...S.state.blocks].sort((a, b) => new Date(a.start) - new Date(b.start));
  assert.equal(sorted.length, 3);
  assert.deepEqual(sorted.map((b) => b.start.slice(11, 16)), ['09:00', '09:15', '09:30']);
  assert.deepEqual(sorted.map((b) => b.end.slice(11, 16)), ['09:15', '09:30', '09:40']); // last clipped
  assert.ok(sorted.every((b) => b.label === 'Task'));
  assert.equal(S.state.recentLabels[0], 'Task'); // bumpRecent ran
});

test('fillRange with a blank label only clears the range', () => {
  resetState();
  S.state.blocks = [blk(at(9), at(9, 15), 'old')];
  B.fillRange(at(9), at(10), '   ');
  assert.equal(S.state.blocks.length, 0);
});

test('setBlock inserts, edits, and deletes the slot at a start time', () => {
  resetState();
  S.setSlotMin(15);
  B.setBlock(at(9), 'First');
  assert.equal(S.state.blocks.length, 1);
  assert.equal(B.blockAt(at(9)).label, 'First');
  B.setBlock(at(9), 'Edited');               // same slot → edit in place
  assert.equal(S.state.blocks.length, 1);
  assert.equal(B.blockAt(at(9)).label, 'Edited');
  B.setBlock(at(9), '');                      // blank → delete
  assert.equal(B.blockAt(at(9)), undefined);
  assert.equal(S.state.blocks.length, 0);
});

test('bumpRecent dedupes and caps at 12, most-recent-first', () => {
  resetState();
  for (let i = 0; i < 15; i++) B.bumpRecent('L' + i);
  assert.equal(S.state.recentLabels.length, 12);
  assert.equal(S.state.recentLabels[0], 'L14');
  B.bumpRecent('L5'); // existing → moves to front, no duplicate
  assert.equal(S.state.recentLabels[0], 'L5');
  assert.equal(S.state.recentLabels.filter((l) => l === 'L5').length, 1);
});

test('lastLabel prefers the latest block, falls back to recentLabels', () => {
  resetState();
  assert.equal(B.lastLabel(), ''); // nothing anywhere
  S.state.recentLabels = ['fromRecent'];
  assert.equal(B.lastLabel(), 'fromRecent');
  S.state.blocks = [blk(at(9), at(9, 15), 'early'), blk(at(11), at(11, 15), 'latest')];
  assert.equal(B.lastLabel(), 'latest');
});

test('mergeRuns coalesces adjacent same-label blocks only', () => {
  const runs = B.mergeRuns([
    blk(at(9), at(9, 15), 'A'),
    blk(at(9, 15), at(9, 30), 'A'),   // contiguous + same label → merges
    blk(at(9, 30), at(9, 45), 'B'),   // different label → new seg
    blk(at(10), at(10, 15), 'B'),     // same label but a gap → new seg
  ]);
  assert.equal(runs.length, 3);
  assert.equal(runs[0].label, 'A');
  assert.equal(runs[0].start, iso(at(9)));
  assert.equal(runs[0].end, iso(at(9, 30)));     // merged span
  assert.equal(runs[0].blocks.length, 2);
  assert.equal(runs[1].label, 'B');
  assert.equal(runs[2].label, 'B');              // not merged across the gap
});

test('mergeRuns sorts unsorted input before coalescing', () => {
  const runs = B.mergeRuns([
    blk(at(9, 15), at(9, 30), 'A'),
    blk(at(9), at(9, 15), 'A'),
  ]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].start, iso(at(9)));
  assert.equal(runs[0].end, iso(at(9, 30)));
});

test('gapSlots returns [] for a fresh user with no blocks', () => {
  resetState();
  assert.deepEqual(B.gapSlots(), []);
});

test('groupGapRuns returns [] for no slots', () => {
  resetState();
  assert.deepEqual(B.groupGapRuns([]), []);
});

test('groupGapRuns wraps a single slot into one run spanning one slot', () => {
  resetState();
  const runs = B.groupGapRuns([at(9)]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].start.getTime(), at(9).getTime());
  assert.equal(runs[0].end.getTime(), at(9, 15).getTime());
  assert.equal(runs[0].slots.length, 1);
});

test('groupGapRuns merges contiguous slots into one run', () => {
  resetState();
  const runs = B.groupGapRuns([at(12), at(12, 15), at(12, 30), at(12, 45)]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].start.getTime(), at(12).getTime());
  assert.equal(runs[0].end.getTime(), at(13).getTime()); // last slot + 15 min
  assert.equal(runs[0].slots.length, 4);
  assert.deepEqual(runs[0].slots.map((d) => d.getTime()),
    [at(12), at(12, 15), at(12, 30), at(12, 45)].map((d) => d.getTime()));
});

test('groupGapRuns splits at non-contiguous slots into separate runs', () => {
  resetState();
  // 10:00–10:30 (2 slots) and 11:15–11:30 (1 slot) — the PO example
  const runs = B.groupGapRuns([at(10), at(10, 15), at(11, 15)]);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].start.getTime(), at(10).getTime());
  assert.equal(runs[0].end.getTime(), at(10, 30).getTime());
  assert.equal(runs[0].slots.length, 2);
  assert.equal(runs[1].start.getTime(), at(11, 15).getTime());
  assert.equal(runs[1].end.getTime(), at(11, 30).getTime());
  assert.equal(runs[1].slots.length, 1);
});

test('groupGapRuns honours the active slot size for contiguity', () => {
  resetState();
  S.setSlotMin(30);
  const runs = B.groupGapRuns([at(9), at(9, 30), at(10, 30)]);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].end.getTime(), at(10).getTime()); // 2×30 min
  assert.equal(runs[1].end.getTime(), at(11).getTime());
});

test('beat stamps a heartbeat once and beatRuns merges contiguous slots', () => {
  resetState();
  S.setSlotMin(15);
  // beat() stamps the *current* slot; assert idempotence of the return flag.
  globalThis.localStorage.removeItem('timelog.heartbeat.v1');
  const first = B.beat();
  const second = B.beat();
  assert.equal(typeof first, 'boolean');
  assert.equal(second, false); // same slot again → no new slot added

  // beatRuns for "today" must include a run covering the just-stamped slot,
  // sized to one slotMin window (15 min).
  const today = new Date();
  const runs = B.beatRuns(today);
  assert.ok(runs.length >= 1);
  const slotStart = Math.floor(minOfDay(today) / 15) * 15;
  const hit = runs.find((r) => r.startMin <= slotStart && r.endMin >= slotStart + 15);
  assert.ok(hit, 'a run should cover the current slot with a 15-min window');
  // beatRuns for an unrelated day has no marks
  assert.deepEqual(B.beatRuns(new Date(2000, 0, 1)), []);
});
