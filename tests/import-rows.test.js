// Unit tests for the pure xlsx-import row parser (src/importRows.js), extracted
// from main.js's applyImport so the parsing/validation logic is testable without
// a DOM. Times are built with the local `new Date(y,m,d,...)` constructor and
// rendered with the local iso() — timezone-independent assertions.
//
// QA finding M5 drives the midnight-crossing rules: an end at-or-before the
// start must NOT silently become a (nearly) 24h block. Crossing midnight is only
// accepted when the end lands shortly after midnight (≤ 04:00) AND the resulting
// block stays under 12h; anything else (09:00–09:00, 14:00–13:00) is a data
// error → the row is skipped and reported via the `bad` counter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToBlocks, parseDE, parseHM } from '../src/importRows.js';

const HEAD = ['Datum', 'Wochentag', 'Start', 'Ende', 'Dauer (min)', 'Tätigkeit'];
const row = (date, start, end, label) => [date, 'Di', start, end, '', label];

test('a normal text row imports verbatim (already slot-aligned)', () => {
  const res = rowsToBlocks([HEAD, row('02.06.2026', '09:00', '10:00', 'Mandant A')], 15);
  assert.deepEqual(res, {
    ok: 1, bad: 0,
    blocks: [{ start: '2026-06-02T09:00:00', end: '2026-06-02T10:00:00', label: 'Mandant A' }],
  });
});

test('off-grid boundaries snap: floor start, ceil end to the slot grid', () => {
  const res = rowsToBlocks([HEAD, row('02.06.2026', '09:01', '09:04', 'Fein')], 6);
  assert.equal(res.ok, 1);
  assert.deepEqual(res.blocks[0],
    { start: '2026-06-02T09:00:00', end: '2026-06-02T09:06:00', label: 'Fein' });
});

test('M5: equal start/end (09:00–09:00) is a bad row, NOT a 24h block', () => {
  const res = rowsToBlocks([HEAD, row('02.06.2026', '09:00', '09:00', 'X')], 15);
  assert.equal(res.ok, 0);
  assert.equal(res.bad, 1);
  assert.deepEqual(res.blocks, []);
});

test('M5: inverted daytime times (14:00–13:00) are a bad row, NOT a 23h block', () => {
  const res = rowsToBlocks([HEAD, row('02.06.2026', '14:00', '13:00', 'X')], 15);
  assert.equal(res.ok, 0);
  assert.equal(res.bad, 1);
});

test('M5: a midnight-inverted row inside an otherwise valid file only skips that row', () => {
  const res = rowsToBlocks([
    HEAD,
    row('02.06.2026', '09:00', '10:00', 'Gut'),
    row('02.06.2026', '09:00', '09:00', 'Kaputt'),
    row('02.06.2026', '14:00', '13:00', 'Auch kaputt'),
  ], 15);
  assert.equal(res.ok, 1);
  assert.equal(res.bad, 2);
  assert.equal(res.blocks[0].label, 'Gut');
});

test('legit midnight crossing 23:45–00:00 still imports (end = next day 00:00)', () => {
  const res = rowsToBlocks([HEAD, row('02.06.2026', '23:45', '00:00', 'Spät')], 15);
  assert.equal(res.ok, 1);
  assert.deepEqual(res.blocks[0],
    { start: '2026-06-02T23:45:00', end: '2026-06-03T00:00:00', label: 'Spät' });
});

test('legit night block 22:00–02:00 crosses midnight (end ≤ 04:00, < 12h)', () => {
  const res = rowsToBlocks([HEAD, row('02.06.2026', '22:00', '02:00', 'Nacht')], 15);
  assert.equal(res.ok, 1);
  assert.deepEqual(res.blocks[0],
    { start: '2026-06-02T22:00:00', end: '2026-06-03T02:00:00', label: 'Nacht' });
});

test('crossing acceptance boundary: end exactly 04:00 is in, 04:15 is out', () => {
  const okRes = rowsToBlocks([HEAD, row('02.06.2026', '20:30', '04:00', 'Schicht')], 15);
  assert.equal(okRes.ok, 1);
  assert.equal(okRes.blocks[0].end, '2026-06-03T04:00:00');
  const badRes = rowsToBlocks([HEAD, row('02.06.2026', '20:30', '04:15', 'Schicht')], 15);
  assert.equal(badRes.ok, 0);
  assert.equal(badRes.bad, 1);
});

test('crossing duration cap: 14:00–02:00 (12h) is rejected even though end ≤ 04:00', () => {
  const res = rowsToBlocks([HEAD, row('02.06.2026', '14:00', '02:00', 'Zu lang')], 15);
  assert.equal(res.ok, 0);
  assert.equal(res.bad, 1);
});

test('missing/garbled fields count as bad rows; blank rows are ignored entirely', () => {
  const res = rowsToBlocks([
    HEAD,
    row('02.06.2026', '09:00', '10:00', ''),        // no label → bad
    row('kein datum', '09:00', '10:00', 'X'),        // bad date → bad
    [],                                              // blank → ignored
    row('02.06.2026', '9 Uhr', '10:00', 'X'),        // bad time → bad
  ], 15);
  assert.equal(res.ok, 0);
  assert.equal(res.bad, 3);
});

test('empty/headerless input yields the matching error markers', () => {
  assert.deepEqual(rowsToBlocks(null, 15), { error: 'empty' });
  assert.deepEqual(rowsToBlocks([HEAD], 15), { error: 'empty' });
  assert.deepEqual(rowsToBlocks([['Foo', 'Bar'], ['x', 'y']], 15), { error: 'columns' });
});

test('native Excel date/time cells (Date objects) parse like text cells', () => {
  assert.deepEqual(parseDE(new Date(2026, 5, 2, 0, 0, 0)), { d: 2, m: 6, y: 2026 });
  assert.deepEqual(parseHM(new Date(1899, 11, 30, 9, 30, 0)), { h: 9, min: 30 });
  const res = rowsToBlocks([
    HEAD,
    [new Date(2026, 5, 2), 'Di', new Date(1899, 11, 30, 9, 0), new Date(1899, 11, 30, 9, 0), '', 'X'],
  ], 15);
  assert.equal(res.ok, 0, 'equal Date-cell times must be rejected like equal text times');
  assert.equal(res.bad, 1);
});
