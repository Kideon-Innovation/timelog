// DST behaviour of the slot-index → Date mapping (QA finding N5).
//
// On the spring-forward day (Europe/Berlin: 2026-03-29) the wall-clock hour
// 02:00–03:00 does not exist. Naive `d.setMinutes(idx*slotMin)` silently
// normalises those minutes onto 03:00–04:00 — the SAME Dates the real
// 03:00-slots produce — so a drag in the phantom hour would land an hour later
// and clearRange-overwrite the user's real 03:00 data. dayMinuteToDate() must
// return null for those minutes so the gesture layer can refuse the commit.
//
// TZ is pinned process-wide BEFORE any Date is constructed; Node ≥ 16 honours
// runtime changes to process.env.TZ. A sanity test asserts the pin took effect
// so a silently-ignored TZ can never fake a green run.
process.env.TZ = 'Europe/Berlin';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayMinuteToDate, minOfDay } from '../src/time.js';

const SPRING = new Date(2026, 2, 29);  // last Sunday of March 2026: 02:00 → 03:00
const FALL = new Date(2026, 9, 25);    // last Sunday of October 2026: 03:00 → 02:00
const NORMAL = new Date(2026, 5, 8);

test('sanity: this process really runs in Europe/Berlin', () => {
  // On the spring-forward day 02:30 does not exist; local Date normalises it.
  assert.equal(new Date(2026, 2, 29, 2, 30).getHours(), 3,
    'TZ pin failed — these DST assertions would be meaningless');
});

test('normal day: minute-of-day maps straight to the local wall clock', () => {
  const d = dayMinuteToDate(NORMAL, 9 * 60 + 30);
  assert.equal(minOfDay(d), 9 * 60 + 30);
  assert.equal(d.getDate(), 8);
  // minute 1440 = the exclusive end boundary = next midnight
  const end = dayMinuteToDate(NORMAL, 1440);
  assert.equal(minOfDay(end), 0);
  assert.equal(end.getDate(), 9);
});

test('normal day: works from a non-midnight day reference', () => {
  const noon = new Date(2026, 5, 8, 12, 34, 56, 789);
  assert.equal(dayMinuteToDate(noon, 60).getHours(), 1);
  assert.equal(dayMinuteToDate(noon, 60).getMinutes(), 0);
});

test('spring-forward day: minutes inside the phantom 02:00 hour return null', () => {
  assert.equal(dayMinuteToDate(SPRING, 120), null);   // 02:00
  assert.equal(dayMinuteToDate(SPRING, 135), null);   // 02:15
  assert.equal(dayMinuteToDate(SPRING, 179), null);   // 02:59
});

test('spring-forward day: minutes around the gap map normally', () => {
  assert.equal(minOfDay(dayMinuteToDate(SPRING, 90)), 90);     // 01:30 exists
  assert.equal(minOfDay(dayMinuteToDate(SPRING, 180)), 180);   // 03:00 exists
  assert.equal(minOfDay(dayMinuteToDate(SPRING, 540)), 540);   // 09:00 exists
  assert.equal(minOfDay(dayMinuteToDate(SPRING, 1440)), 0);    // next midnight
});

test('fall-back day: every wall-clock minute exists (incl. the doubled 02:xx)', () => {
  for (const m of [0, 120, 150, 180, 240, 1440]) {
    const d = dayMinuteToDate(FALL, m);
    assert.notEqual(d, null, `minute ${m} must map on the fall-back day`);
    assert.equal(minOfDay(d), m % 1440);
  }
});
