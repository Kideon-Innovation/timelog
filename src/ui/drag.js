// Calendar pointer-gesture layer — the ONE state machine behind every direct
// pointer interaction on a day column. Extracted from main.js, then extended
// (this file) from "drag-to-select only" into the full Google-Calendar-style
// set: create / move / resize / tap, all sharing one pointerdown surface.
//
// WHICH GESTURE FIRES (disambiguation — pointerdown on the .daygrid):
//   * EMPTY grid           → range-select that commits a NEW entry (.selbox),
//                            exactly the original behaviour. KEEP WORKING.
//   * a block EDGE handle  → RESIZE that edge's start/end (snap 15 min, min 1 slot).
//   * a block BODY         → MOVE the whole block to a new time (snap 15 min).
//   * a tap / tiny drag on a block → still opens the edit modal (the block's own
//                            onclick in calendar.js). A real drag is detected by a
//                            movement threshold and the trailing click is
//                            suppressed so a move never also opens the editor.
//
// TOUCH: a plain tap on empty grid quick-logs a slot; a long-press (~260ms) then
// drag selects a range OR moves a block (so normal vertical scrolling still
// works). Resize uses the always-on edge handles (touch-action:none), so it
// starts immediately on a deliberate edge grab without the long-press.
//
// It is attached to the .daygrid (the relative hour-grid wrapper below the
// sticky .col-head), so the grid's top edge is slot 0 (00:00) and the pointer
// math needs no header offset.
//
// SHARING CONTRACT (cycle-free, one-directional layering — unchanged):
//   * Pure date helpers (hhmm/fmtDur/minOfDay/iso) from time.js; the active slot
//     size + pixel scale (getSlotMin/PX_PER_MIN) + state from state.js; the data
//     ops (overlapVictims/applySegmentRange) from blocks.js; and the dialogs
//     (openRangeEntry / confirmDialog) + toast from the ui layer. None of those
//     import drag.js, so these imports introduce no cycle. The calendar paints
//     the gesture onto each column via initCalendar's injected attachDrag ref.

import { hhmm, fmtDur, minOfDay, iso, dayMinuteToDate } from '../time.js';
import { getSlotMin, PX_PER_MIN } from '../state.js';
import { overlapVictims, applySegmentRange } from '../blocks.js';
import { openRangeEntry, confirmDialog } from './dialogs.js';
import { toast } from './notify.js';
import { render } from './calendar.js';

const MOVE_THRESHOLD = 6;   // px the pointer must travel before a press is a drag
const EDGE_PX = 8;          // pointer-mode top/bottom resize hit-zone (touch uses the handle)
const LONG_PRESS_MS = 260;  // touch hold before a body move / range-select begins

// DST spring-forward guard (QA N5). On the changeover day the 02:00–03:00
// wall-clock hour does not exist; naive Date normalisation maps those slots
// onto 03:00–04:00 — identical to the REAL 03:00 slots — so committing such a
// gesture would land an hour later than what the user saw and silently
// clearRange-overwrite their 03:00 data. dayMinuteToDate() returns null for
// those minutes; commits are refused with this toast instead.
const DST_GAP_MSG = 'Diese Uhrzeit gibt es am Tag der Zeitumstellung nicht — bitte ab 03:00 eintragen.';

export function attachDrag(grid, day) {
  grid.addEventListener("pointerdown", e => {
    if (e.button > 0) return;                                    // ignore right/middle
    const blockEl = e.target.closest(".block");
    if (blockEl) { startBlockGesture(e, grid, blockEl); return; }
    startRangeSelect(e, grid, day);
  });
}

/* ---------- shared slot math for a grid ---------- */
function gridGeom(grid) {
  const rect = grid.getBoundingClientRect();
  const slotMin = getSlotMin(), slotPx = slotMin * PX_PER_MIN;
  const maxIdx = Math.floor(1440 / slotMin) - 1;
  const idxAt = cy => Math.max(0, Math.min(maxIdx, Math.floor((cy - rect.top) / slotPx)));
  return { rect, slotMin, slotPx, maxIdx, idxAt };
}

/* ============================================================
   CREATE — drag-to-select on empty grid (original behaviour, refactored out).
   ============================================================ */
function startRangeSelect(e, grid, day) {
  const { rect, slotMin, slotPx, maxIdx, idxAt } = gridGeom(grid);
  const startIdx = idxAt(e.clientY), startY = e.clientY, startX = e.clientX;
  const touch = e.pointerType === "touch";
  const slotTime = i => { const d = new Date(day); d.setMinutes(i * slotMin); return d; };
  let selecting = false, holdTimer = null, box = null, lbl = null, tm = null;

  const draw = cur => {
    const lo = Math.min(startIdx, cur), hi = Math.max(startIdx, cur);
    box.style.top = (lo * slotPx) + "px"; box.style.height = ((hi - lo + 1) * slotPx) + "px";
    tm.textContent = hhmm(slotTime(lo)) + "–" + hhmm(slotTime(hi + 1)) + " · " + fmtDur((hi - lo + 1) * slotMin);
  };
  const beginSel = () => {
    selecting = true; holdTimer = null;
    box = document.createElement("div"); box.className = "selbox";
    lbl = document.createElement("span"); lbl.className = "sl"; lbl.textContent = "Eintragen…";
    tm = document.createElement("span"); tm.className = "st"; box.appendChild(lbl); box.appendChild(tm);
    grid.appendChild(box); document.body.classList.add("dragging");
    grid.style.touchAction = "none";                         // stop scroll once selecting
    try { grid.setPointerCapture(e.pointerId); } catch (_) {}
    if (touch && navigator.vibrate) navigator.vibrate(8);
    draw(startIdx);
  };
  const cleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    document.body.classList.remove("dragging");
    grid.style.touchAction = "";
    if (box) { box.remove(); box = null; }
  };
  const move = ev => {
    if (selecting) { ev.preventDefault(); draw(idxAt(ev.clientY)); return; }
    if (holdTimer && (Math.abs(ev.clientY - startY) > 10 || Math.abs(ev.clientX - startX) > 10)) {
      cleanup();                                            // moved before hold → it's a scroll
    }
  };
  const up = ev => {
    const wasSelecting = selecting;
    const moved = Math.abs(ev.clientY - startY) > 10 || Math.abs(ev.clientX - startX) > 10;
    cleanup();
    if (wasSelecting) {
      const cur = idxAt(ev.clientY), lo = Math.min(startIdx, cur), hi = Math.max(startIdx, cur);
      openEntryIfValid(day, lo, hi + 1, slotMin);
    } else if (touch && !moved) {
      openEntryIfValid(day, startIdx, startIdx + 1, slotMin);      // tap = log this slot
    }
  };

  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
  if (touch) { holdTimer = setTimeout(beginSel, LONG_PRESS_MS); }
  else { beginSel(); e.preventDefault(); }
}

/* Open the range-entry dialog for slots [loIdx, hiIdx) — unless a boundary
   falls into the DST spring-forward gap (see DST_GAP_MSG). */
function openEntryIfValid(day, loIdx, hiIdx, slotMin) {
  const s = dayMinuteToDate(day, loIdx * slotMin), en = dayMinuteToDate(day, hiIdx * slotMin);
  if (!s || !en) { toast(DST_GAP_MSG); return; }
  openRangeEntry(s, en);
}

/* ============================================================
   MOVE / RESIZE — direct manipulation of an existing rendered segment.
   ============================================================ */
function startBlockGesture(e, grid, blockEl) {
  const seg = blockEl.__seg, day = blockEl.__day;
  if (!seg) return;                                            // not a real rendered block
  const { slotMin, slotPx, maxIdx } = gridGeom(grid);
  const segStartIdx = Math.round(minOfDay(new Date(seg.start)) / slotMin);
  const lenSlots = Math.max(1, Math.round((new Date(seg.end) - new Date(seg.start)) / 60000 / slotMin));
  const touch = e.pointerType === "touch";

  // Which gesture? Edge handle (or, on pointer, the EDGE_PX strip) → resize.
  // Cap the strip to a third of the block so a short 1-slot block still has a
  // grabbable body in the middle (handles never swallow the whole block).
  const bRect = blockEl.getBoundingClientRect();
  const edge = Math.min(EDGE_PX, bRect.height / 3);
  const onTopHandle = !touch ? (e.clientY - bRect.top <= edge) : !!e.target.closest(".rz-top");
  const onBotHandle = !touch ? (bRect.bottom - e.clientY <= edge) : !!e.target.closest(".rz-bot");
  const mode = onTopHandle ? "resize-top" : onBotHandle ? "resize-bot" : "move";

  const startY = e.clientY, startX = e.clientX;
  let active = false, holdTimer = null, victimEls = [];

  const idxToTime = idx => { const d = new Date(day); d.setHours(0, 0, 0, 0); d.setMinutes(idx * slotMin); return d; };

  // Compute the candidate [startIdx, endIdx) for a pointer at clientY given the
  // grab mode + how far the pointer moved from the press point (in slots).
  const computeRange = clientY => {
    const deltaSlots = Math.round((clientY - startY) / slotPx);
    let startIdx, endIdx;
    if (mode === "move") {
      startIdx = Math.max(0, Math.min(maxIdx + 1 - lenSlots, segStartIdx + deltaSlots));
      endIdx = startIdx + lenSlots;
    } else if (mode === "resize-top") {
      const fixedEnd = segStartIdx + lenSlots;
      startIdx = Math.max(0, Math.min(fixedEnd - 1, segStartIdx + deltaSlots)); // min 1 slot
      endIdx = fixedEnd;
    } else { // resize-bot
      startIdx = segStartIdx;
      endIdx = Math.max(startIdx + 1, Math.min(maxIdx + 1, segStartIdx + lenSlots + deltaSlots)); // min 1 slot
    }
    return { startIdx, endIdx };
  };

  const clearVictims = () => { victimEls.forEach(el => el.classList.remove("dm-victim")); victimEls = []; };

  // Paint the block at the candidate range and highlight victims live.
  const paint = clientY => {
    const { startIdx, endIdx } = computeRange(clientY);
    blockEl.style.top = (startIdx * slotPx) + "px";
    blockEl.style.height = Math.max(11, (endIdx - startIdx) * slotPx - 3) + "px";
    const tm = blockEl.querySelector(".tm");
    if (tm) tm.textContent = hhmm(idxToTime(startIdx)) + "–" + hhmm(idxToTime(endIdx)) + " · " + fmtDur((endIdx - startIdx) * slotMin);
    clearVictims();
    const { full, partial } = overlapVictims(seg, idxToTime(startIdx), idxToTime(endIdx));
    [...full, ...partial].forEach(b => {
      // map a victim block back to its rendered .block (segments merge, so match by time containment)
      grid.querySelectorAll(".block").forEach(el => {
        if (el === blockEl || !el.__seg) return;
        const s = new Date(el.__seg.start).getTime(), en = new Date(el.__seg.end).getTime();
        if (new Date(b.start).getTime() >= s && new Date(b.end).getTime() <= en) {
          if (!victimEls.includes(el)) { el.classList.add("dm-victim"); victimEls.push(el); }
        }
      });
    });
  };

  const begin = () => {
    active = true; holdTimer = null;
    blockEl.classList.add("dm-active");
    document.body.classList.add("dragging");
    grid.style.touchAction = "none";
    if (touch && navigator.vibrate) navigator.vibrate(8);
    paint(startY);
  };

  // Non-passive native touchmove guard: once the drag is active, calling
  // preventDefault() here is what actually stops the touch from scrolling the
  // calendar (a passive pointer listener cannot). Without it the compositor can
  // latch a scroll and fire pointercancel mid-drag, aborting the gesture.
  const touchGuard = ev => { if (active) ev.preventDefault(); };

  const cleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", cancel);
    document.removeEventListener("touchmove", touchGuard);
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    try { blockEl.releasePointerCapture(e.pointerId); } catch (_) {}
    blockEl.style.touchAction = "";
    document.body.classList.remove("dragging");
    grid.style.touchAction = "";
    blockEl.classList.remove("dm-active");
    clearVictims();
  };

  const move = ev => {
    if (active) { ev.preventDefault(); paint(ev.clientY); return; }
    const moved = Math.abs(ev.clientY - startY) > MOVE_THRESHOLD || Math.abs(ev.clientX - startX) > MOVE_THRESHOLD;
    if (!moved) return;
    // Touch body-move is armed on a long-press timer; movement before it fires =
    // the user is scrolling, so bail and let the page scroll.
    if (touch && mode === "move" && holdTimer) { cleanup(); return; }
    // Pointer/pen (any mode) + touch resize: a static press must stay a tap (→
    // opens edit), so we only ACTIVATE the drag once movement crosses the
    // threshold — never on the bare pointerdown.
    if (!active && !holdTimer) begin();
  };

  const commit = ev => {
    const { startIdx, endIdx } = computeRange(ev.clientY);
    // no-op? same range → just repaint to be safe and bail (tap handled elsewhere)
    if (startIdx === segStartIdx && endIdx === segStartIdx + lenSlots) { render(); return; }
    const s = dayMinuteToDate(day, startIdx * slotMin), en = dayMinuteToDate(day, endIdx * slotMin);
    if (!s || !en) { toast(DST_GAP_MSG); render(); return; }   // DST gap → refuse, repaint at the old place
    const { full } = overlapVictims(seg, s, en);
    const finish = () => {
      const restore = applySegmentRange(seg, s, en, seg.label);
      render();
      const msg = mode === "move" ? "Verschoben" : "Größe geändert";
      toast(msg, { action: "Rückgängig", onAction: () => { restore(); render(); toast("Rückgängig gemacht"); } });
    };
    if (full.length) {
      const names = [...new Set(full.map(b => b.label))].join("«, »");
      confirmDialog({
        title: "Block überschreiben?",
        sub: "Achtung — du überschreibst »" + names + "« komplett.",
        ok: "Bestätigen", cancel: "Abbrechen", danger: true,
      }).then(ok => { if (ok) finish(); else render(); });
    } else {
      finish();
    }
  };

  const up = ev => {
    const wasActive = active;
    cleanup();
    if (wasActive) {
      // a real drag happened → suppress the trailing click so edit doesn't open
      suppressNextClick(blockEl);
      commit(ev);
    }
    // if !wasActive: it was a tap → let the block's own onclick open the editor.
  };
  const cancel = () => { const was = active; cleanup(); if (was) render(); };

  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", cancel);
  if (touch) document.addEventListener("touchmove", touchGuard, { passive: false });

  // Capture the pointer to the block immediately so the browser routes the whole
  // gesture to us and does NOT reclaim an in-progress touch as a page-scroll
  // (which would fire pointercancel and abort a legitimate drag mid-flight).
  // Pinning touch-action on the block reinforces this for the active touch. A
  // plain tap is unaffected (capture + touch-action:none still allow the click);
  // empty-grid scrolling is untouched because this only runs over a block.
  try { blockEl.setPointerCapture(e.pointerId); } catch (_) {}
  if (touch) blockEl.style.touchAction = "none";

  // Activation timing:
  //   * touch body-move → long-press, THEN it's grabbed and draggable (the hold
  //     also lets a plain tap fall through to the block's onclick = edit).
  //   * pointer/pen (move or resize) + touch resize → wait for the move
  //     threshold (begin() is called from move()). A static press never
  //     activates, so a plain click stays a tap and opens the editor.
  if (touch && mode === "move") {
    holdTimer = setTimeout(begin, LONG_PRESS_MS);
  }
}

/* Swallow the one synthetic click that follows a real drag on a block, so a
   move/resize never also fires the block's onclick (edit modal). */
function suppressNextClick(el) {
  const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); el.removeEventListener("click", swallow, true); };
  el.addEventListener("click", swallow, true);
  // safety: if no click fires (some touch paths), drop the guard shortly after
  setTimeout(() => el.removeEventListener("click", swallow, true), 400);
}
