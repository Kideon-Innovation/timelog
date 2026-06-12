// Pure xlsx-import row parser — extracted from main.js's applyImport so the
// parsing/validation rules are unit-testable without a DOM (tests/import-rows.
// test.js). main.js keeps the I/O shell (FileReader, SheetJS, toasts, state).
//
// Accepts BOTH the app's own text export ("02.06.2026" / "09:00") AND files
// that were opened/edited and re-saved in real Excel — where the Datum/Start/
// Ende columns come back as native date/time cells. With {raw:true,cellDates:
// true} SheetJS hands those over as JS Date objects, so parse those directly
// from their local components; fall back to the German text regex otherwise.
import { iso, floorSlot, nextBoundary } from './time.js';

export function parseDE(v) {
  if (v instanceof Date && !isNaN(v)) return { d: v.getDate(), m: v.getMonth() + 1, y: v.getFullYear() };
  const m = String(v || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? { d: +m[1], m: +m[2], y: +m[3] } : null;
}
export function parseHM(v) {
  if (v instanceof Date && !isNaN(v)) return { h: v.getHours(), min: v.getMinutes() };
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? { h: +m[1], min: +m[2] } : null;
}

// Midnight-crossing acceptance window (QA finding M5). An end at-or-before the
// start is only treated as "crosses midnight" when the end lands shortly after
// midnight AND the resulting block stays plausibly short. The old unconditional
// `end += 24h` turned typos like 09:00–09:00 into a silent 24h block (and
// 14:00–13:00 into 23h); such rows are data errors → skipped + reported.
const CROSS_MAX_END_MIN = 4 * 60;   // end must be at or before 04:00
const CROSS_MAX_DUR_MIN = 12 * 60;  // and the crossing block must be < 12h

/**
 * Turn sheet_to_json(header:1) rows into slot-aligned block candidates.
 * Returns { error: 'empty' | 'columns' } for unusable input, otherwise
 * { ok, bad, blocks: [{start, end, label}] } with local-iso timestamps.
 */
export function rowsToBlocks(rows, slotMin) {
  if (!rows || rows.length < 2) return { error: 'empty' };
  const head = rows[0].map(h => String(h || '').trim().toLowerCase());
  const ci = { date: head.indexOf('datum'), start: head.indexOf('start'),
    end: head.indexOf('ende'), label: head.findIndex(h => h.startsWith('tätigkeit')) };
  if (ci.date < 0 || ci.start < 0 || ci.end < 0 || ci.label < 0) return { error: 'columns' };
  let ok = 0, bad = 0; const blocks = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || !r.length) continue;
    const d = parseDE(r[ci.date]), s = parseHM(r[ci.start]), e = parseHM(r[ci.end]);
    const label = String(r[ci.label] || '').trim();
    if (!d || !s || !e || !label) { bad++; continue; }
    let start = new Date(d.y, d.m - 1, d.d, s.h, s.min, 0, 0);
    let end = new Date(d.y, d.m - 1, d.d, e.h, e.min, 0, 0);
    if (end.getTime() <= start.getTime()) {
      const endMin = e.h * 60 + e.min;
      const durMin = 24 * 60 - (s.h * 60 + s.min) + endMin;
      if (endMin <= CROSS_MAX_END_MIN && durMin < CROSS_MAX_DUR_MIN) {
        end = new Date(end.getTime() + 86400000); // genuine 23:xx–00:xx overnight row
      } else { bad++; continue; }                 // inverted/equal daytime times = typo
    }
    // Snap imported boundaries to the active slot grid so imports share the
    // app's own data model (in-app entries are always slot-aligned). Floor the
    // start, ceil the end: a row finer than one slot (e.g. a hand-crafted 3-min
    // block, or boundaries off the grid) becomes a full, readable slot instead
    // of a sub-slot sliver that hits the calendar's min-height clamp and smears
    // over its neighbour. Already-aligned rows (our own export) are unchanged:
    // floor/ceil of an on-grid boundary is itself.
    start = floorSlot(start, slotMin);
    end = nextBoundary(new Date(end.getTime() - 1), slotMin); // ceil (on-grid end stays put)
    if (end.getTime() <= start.getTime()) { bad++; continue; } // zero-length after snap
    blocks.push({ start: iso(start), end: iso(end), label }); ok++;
  }
  return { ok, bad, blocks };
}
