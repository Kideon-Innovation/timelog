// Unit assertions for rangeFromFields (src/time.js) — the pure date math behind
// the manual "+ Jetzt eintragen" dialog's optional Datum/Von/Bis fields (M7:
// keyboard path for arbitrary ranges). Mirrors the import snapping rules:
// floor the start, ceil the end to the slot grid; "00:00" as Bis = midnight at
// the END of the chosen day. Run with `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeFromFields, hhmm } from '../src/time.js';

test('parses an on-grid range on the given local day', () => {
  const r = rangeFromFields('2026-06-11', '09:00', '10:00', 15);
  assert.ok(r);
  assert.equal(hhmm(r.start), '09:00');
  assert.equal(hhmm(r.end), '10:00');
  assert.equal(r.start.getFullYear(), 2026);
  assert.equal(r.start.getMonth(), 5);
  assert.equal(r.start.getDate(), 11);
  assert.equal(r.end.getDate(), 11);
});

test('snaps off-grid times outward to the slot grid (floor start, ceil end)', () => {
  const r = rangeFromFields('2026-06-11', '09:07', '09:50', 15);
  assert.ok(r);
  assert.equal(hhmm(r.start), '09:00');
  assert.equal(hhmm(r.end), '10:00');
  // a sub-slot sliver still becomes one full slot
  const tiny = rangeFromFields('2026-06-11', '09:01', '09:02', 15);
  assert.equal(hhmm(tiny.start), '09:00');
  assert.equal(hhmm(tiny.end), '09:15');
});

test('respects the active slot size', () => {
  const r = rangeFromFields('2026-06-11', '09:10', '09:40', 30);
  assert.ok(r);
  assert.equal(hhmm(r.start), '09:00');
  assert.equal(hhmm(r.end), '10:00');
});

test('"00:00" as Bis means midnight at the END of the day', () => {
  const r = rangeFromFields('2026-06-11', '23:00', '00:00', 15);
  assert.ok(r);
  assert.equal(hhmm(r.start), '23:00');
  assert.equal(hhmm(r.end), '00:00');
  assert.equal(r.end.getDate(), 12); // next-day midnight, 1h block
  assert.equal((r.end - r.start) / 60000, 60);
});

test('rejects Bis at or before Von (no silent 23h blocks)', () => {
  assert.equal(rangeFromFields('2026-06-11', '14:00', '13:00', 15), null);
  assert.equal(rangeFromFields('2026-06-11', '09:00', '09:00', 15), null);
});

test('rejects missing fields', () => {
  assert.equal(rangeFromFields('', '09:00', '10:00', 15), null);
  assert.equal(rangeFromFields('2026-06-11', '', '10:00', 15), null);
  assert.equal(rangeFromFields('2026-06-11', '09:00', '', 15), null);
});
