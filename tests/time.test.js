// Unit assertions for the pure helpers extracted into src/time.js.
// These pin the CURRENT behaviour so the extraction (and any future change)
// is provably behaviour-preserving. Pure ESM, no DOM — run with Node's built-in
// test runner: `node --test tests/time.test.js`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startOfDay, addDays, floorSlot, nextBoundary, iso, hhmm,
  sameDay, minOfDay, minLabel, blockDurMin, fmtDur, esc,
} from '../src/time.js';

test('startOfDay zeroes the time-of-day', () => {
  const d = new Date(2026, 5, 8, 14, 37, 12, 500); // 8 Jun 2026 14:37:12.5 local
  const s = startOfDay(d);
  assert.equal(s.getHours(), 0);
  assert.equal(s.getMinutes(), 0);
  assert.equal(s.getSeconds(), 0);
  assert.equal(s.getMilliseconds(), 0);
  assert.equal(s.getDate(), 8);
  // does not mutate the input
  assert.equal(d.getHours(), 14);
});

test('addDays shifts whole days and handles month rollover', () => {
  const d = new Date(2026, 5, 8, 9, 0, 0); // 8 Jun
  assert.equal(addDays(d, 2).getDate(), 10);
  assert.equal(addDays(d, -8).getMonth(), 4); // May
  assert.equal(d.getDate(), 8); // input untouched
});

test('floorSlot floors to the slotMin boundary', () => {
  const d = new Date(2026, 5, 8, 9, 37, 45, 250);
  const f15 = floorSlot(d, 15);
  assert.equal(hhmm(f15), '09:30');
  assert.equal(f15.getSeconds(), 0);
  assert.equal(f15.getMilliseconds(), 0);
  assert.equal(hhmm(floorSlot(new Date(2026, 5, 8, 9, 5), 15)), '09:00');
  assert.equal(hhmm(floorSlot(new Date(2026, 5, 8, 9, 50), 30)), '09:30');
  assert.equal(hhmm(floorSlot(new Date(2026, 5, 8, 9, 7), 6)), '09:06');
});

test('nextBoundary is one slot past the floored slot start', () => {
  assert.equal(hhmm(nextBoundary(new Date(2026, 5, 8, 9, 37), 15)), '09:45');
  assert.equal(hhmm(nextBoundary(new Date(2026, 5, 8, 9, 0), 15)), '09:15');
  assert.equal(hhmm(nextBoundary(new Date(2026, 5, 8, 9, 50), 30)), '10:00');
});

test('iso renders local YYYY-MM-DDTHH:MM:00 with zero-padding', () => {
  assert.equal(iso(new Date(2026, 0, 3, 4, 5, 0)), '2026-01-03T04:05:00');
  assert.equal(iso(new Date(2026, 11, 31, 23, 9, 0)), '2026-12-31T23:09:00');
});

test('hhmm zero-pads hours and minutes', () => {
  assert.equal(hhmm(new Date(2026, 0, 1, 9, 5)), '09:05');
  assert.equal(hhmm(new Date(2026, 0, 1, 0, 0)), '00:00');
  assert.equal(hhmm(new Date(2026, 0, 1, 23, 59)), '23:59');
});

test('sameDay compares calendar day only', () => {
  assert.equal(sameDay(new Date(2026, 5, 8, 1, 0), new Date(2026, 5, 8, 23, 0)), true);
  assert.equal(sameDay(new Date(2026, 5, 8), new Date(2026, 5, 9)), false);
  assert.equal(sameDay(new Date(2026, 5, 8), new Date(2025, 5, 8)), false);
});

test('minOfDay returns minute-of-day', () => {
  assert.equal(minOfDay(new Date(2026, 5, 8, 0, 0)), 0);
  assert.equal(minOfDay(new Date(2026, 5, 8, 9, 30)), 570);
  assert.equal(minOfDay(new Date(2026, 5, 8, 23, 59)), 1439);
});

test('minLabel formats a minute count as HH:MM and wraps at 24h', () => {
  assert.equal(minLabel(0), '00:00');
  assert.equal(minLabel(570), '09:30');
  assert.equal(minLabel(1439), '23:59');
  assert.equal(minLabel(1440), '00:00'); // wraps
});

test('blockDurMin computes minutes between ISO start/end', () => {
  assert.equal(blockDurMin({ start: '2026-06-08T09:00:00', end: '2026-06-08T09:15:00' }), 15);
  assert.equal(blockDurMin({ start: '2026-06-08T09:00:00', end: '2026-06-08T10:30:00' }), 90);
});

test('fmtDur renders human durations', () => {
  assert.equal(fmtDur(45), '45m');
  assert.equal(fmtDur(60), '1h');
  assert.equal(fmtDur(90), '1h 30m');
  assert.equal(fmtDur(125), '2h 5m');
  assert.equal(fmtDur(0), '0m');
});

test('esc escapes the 4 HTML-significant characters', () => {
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(esc('plain text'), 'plain text');
});
