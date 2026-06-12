// Unit assertions for the multi-tab-safe persistence layer in src/state.js:
//   * mergeStates — the pure three-way (base/mine/theirs) slot-level merge that
//     makes two open instances unable to clobber each other (QA finding C1).
//   * save()      — merges any concurrent write from another tab BEFORE writing,
//     and never throws on a failed write; it reports via onSaveError (M1).
//   * syncFromStorage — pulls another tab's write into memory (storage event).
//
// Same stub pattern as blocks.test.js: install minimal browser globals BEFORE
// the dynamic import so state.js loads in Node unchanged.

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

let S;
before(async () => { S = await import('../src/state.js'); });

const at = (h, m = 0) => new Date(2026, 5, 8, h, m, 0); // 8 Jun 2026, local
const blk = (start, end, label) => ({ start: iso(start), end: iso(end), label });
const st = (blocks, recentLabels = [], settings = {}) => ({ blocks, recentLabels, settings });
const labels = (s) => s.blocks.map((b) => b.label).sort();

/* ---------------- mergeStates (pure) ---------------- */

test('mergeStates: additions from both sides are united', () => {
  const base = st([]);
  const mine = st([blk(at(9), at(9, 15), 'Mine')]);
  const theirs = st([blk(at(10), at(10, 15), 'Theirs')]);
  assert.deepEqual(labels(S.mergeStates(base, mine, theirs)), ['Mine', 'Theirs']);
});

test('mergeStates: the C1 scenario — tab B (stale) saves after tab A logged a block', () => {
  // base/mine = what stale tab B knows; theirs = storage incl. tab A's new entry
  const old = blk(at(8), at(8, 15), 'Alt');
  const base = st([old], [], { theme: 'light' });
  const mine = st([old], [], { theme: 'dark' });               // B only toggled the theme
  const theirs = st([old, blk(at(9), at(9, 15), 'Neu')], [], { theme: 'light' });
  const m = S.mergeStates(base, mine, theirs);
  assert.deepEqual(labels(m), ['Alt', 'Neu']);                  // A's entry survives B's save
  assert.equal(m.settings.theme, 'dark');                       // B's local change survives too
});

test('mergeStates: a deletion by theirs propagates when trusted', () => {
  const b = blk(at(9), at(9, 15), 'Weg');
  const m = S.mergeStates(st([b]), st([b]), st([]), true);
  assert.deepEqual(m.blocks, []);
});

test('mergeStates: a deletion by theirs is NOT applied when untrusted (additive)', () => {
  const b = blk(at(9), at(9, 15), 'Bleibt');
  const m = S.mergeStates(st([b]), st([b]), st([]), false);
  assert.deepEqual(labels(m), ['Bleibt']);
});

test('mergeStates: my deletion wins over theirs keeping the block', () => {
  const b = blk(at(9), at(9, 15), 'Weg');
  const m = S.mergeStates(st([b]), st([]), st([b]));
  assert.deepEqual(m.blocks, []);
});

test('mergeStates: both edited the same slot → mine wins (active writer)', () => {
  const base = st([blk(at(9), at(9, 15), 'Orig')]);
  const mine = st([blk(at(9), at(9, 15), 'Meins')]);
  const theirs = st([blk(at(9), at(9, 15), 'Deren')]);
  assert.deepEqual(labels(S.mergeStates(base, mine, theirs)), ['Meins']);
});

test('mergeStates: settings merge per key — local change wins, otherwise theirs', () => {
  const m = S.mergeStates(
    st([], [], { theme: 'light', soundOn: true, introSeen: true }),
    st([], [], { theme: 'light', soundOn: false, introSeen: true }),   // mine: toggled sound
    st([], [], { theme: 'dark', soundOn: true, introSeen: true }),     // theirs: toggled theme
  );
  assert.equal(m.settings.theme, 'dark');
  assert.equal(m.settings.soundOn, false);
  assert.equal(m.settings.introSeen, true);
});

test('mergeStates: blocks come back sorted by start; recentLabels dedupe + cap 12', () => {
  const m = S.mergeStates(
    st([], ['a']),
    st([blk(at(10), at(10, 15), 'B')], ['x', 'a']),               // mine changed → leads
    st([blk(at(9), at(9, 15), 'A')], ['a', 'y']),
  );
  assert.deepEqual(m.blocks.map((b) => b.label), ['A', 'B']);
  assert.deepEqual(m.recentLabels, ['x', 'a', 'y']);
});

/* ---------------- save() integration over the stubbed localStorage ---------------- */

test('save() merges a concurrent foreign write instead of clobbering it', () => {
  // fresh module state: storage empty, state empty
  S.state.blocks = []; S.state.recentLabels = [];
  S.save();                                                       // sync point

  // another tab writes a block directly to storage…
  const foreign = blk(at(11), at(11, 15), 'Fremd');
  localStorage.setItem(S.KEY, JSON.stringify({
    blocks: [foreign], recentLabels: [], settings: { theme: 'light' }, savedAt: Date.now(),
  }));
  // …while we add our own block in memory and save
  S.state.blocks.push(blk(at(12), at(12, 15), 'Eigen'));
  S.save();

  const stored = JSON.parse(localStorage.getItem(S.KEY));
  assert.deepEqual(stored.blocks.map((b) => b.label).sort(), ['Eigen', 'Fremd']);
  assert.deepEqual(labels(S.state), ['Eigen', 'Fremd']);          // memory has the union too
  assert.ok(Number.isFinite(stored.savedAt));                     // write stamp present
});

test('save() honours a newer foreign deletion', () => {
  // continues from the previous test: storage + memory hold Eigen + Fremd
  const mine = S.state.blocks.find((b) => b.label === 'Eigen');
  localStorage.setItem(S.KEY, JSON.stringify({
    blocks: [mine], recentLabels: [], settings: { theme: 'light' }, savedAt: Date.now() + 1,
  }));                                                            // foreign tab deleted 'Fremd'
  S.save();                                                       // no local change
  const stored = JSON.parse(localStorage.getItem(S.KEY));
  assert.deepEqual(stored.blocks.map((b) => b.label), ['Eigen']);
  assert.deepEqual(labels(S.state), ['Eigen']);
});

test('syncFromStorage pulls a foreign write into memory and reports the change', () => {
  const before = S.state.blocks.length;
  localStorage.setItem(S.KEY, JSON.stringify({
    blocks: [...S.state.blocks, blk(at(14), at(14, 15), 'Sync')],
    recentLabels: [], settings: { theme: 'light' }, savedAt: Date.now() + 2,
  }));
  assert.equal(S.syncFromStorage(), true);                        // memory changed
  assert.equal(S.state.blocks.length, before + 1);
  assert.ok(labels(S.state).includes('Sync'));
  assert.equal(S.syncFromStorage(), false);                       // nothing new now
});

/* ---------------- M1: a failed write must not throw, and must report ---------------- */

test('save() catches a quota error and reports it via onSaveError', () => {
  const seen = [];
  S.onSaveError((e) => seen.push(e));
  const realSetItem = localStorage.setItem;
  localStorage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  try {
    S.state.blocks.push(blk(at(15), at(15, 15), 'Quota'));
    assert.doesNotThrow(() => S.save());                          // M1: no unhandled exception
  } finally {
    localStorage.setItem = realSetItem;
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'QuotaExceededError');
  // memory keeps the block; the next (working) save persists it
  S.save();
  const stored = JSON.parse(localStorage.getItem(S.KEY));
  assert.ok(stored.blocks.some((b) => b.label === 'Quota'));
});
