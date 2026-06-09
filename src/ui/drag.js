// Drag-to-select layer — the calendar's pointer gesture extracted from main.js.
//
// WHAT LIVES HERE: attachDrag(col, day) — the Pointer Events handler that turns
// a press-drag (mouse/pen: immediate, like Google Calendar) or a touch
// long-press-then-drag into a time-range selection, then commits it through the
// range-entry dialog. It owns only the transient per-gesture DOM (the .selbox
// overlay) and listeners; it holds no app state of its own.
//
// SHARING CONTRACT (how this stays decoupled and cycle-free):
//   * It imports pure date helpers (hhmm/fmtDur) from time.js, the active block
//     size + pixel scale (getSlotMin/PX_PER_MIN) from state.js, and the
//     range-entry dialog (openRangeEntry) from ui/dialogs.js. dialogs.js does
//     NOT import drag.js, so importing openRangeEntry here introduces no cycle —
//     this is the same one-directional layering the rest of src/ui uses.
//   * The calendar paints the gesture onto each day column via initCalendar's
//     injected attachDrag ref; main.js imports attachDrag from here and passes
//     it through at boot. (calendar.js can't import it directly because
//     calendar -> drag -> dialogs -> calendar would be a cycle; the DI hand-off
//     keeps that edge out.)
//
// Behaviour is identical to the inline original — this is a pure move.

import { hhmm, fmtDur } from '../time.js';
import { getSlotMin, PX_PER_MIN } from '../state.js';
import { openRangeEntry } from './dialogs.js';

/* ---------- drag-to-select (Pointer Events: mouse drag, touch long-press) ----------
   Mouse/pen: press-drag selects immediately, like Google Calendar.
   Touch: a plain tap quick-logs one slot; a long-press (~260ms) then drag
   selects a range — so normal vertical scrolling of the calendar still works. */
export function attachDrag(col, day) {
  col.addEventListener("pointerdown", e => {
    if (e.button > 0) return;                                    // ignore right/middle
    if (e.target.closest(".block") || e.target.closest(".col-head")) return;
    const rect = col.getBoundingClientRect();
    const slotMin = getSlotMin(), slotPx = slotMin * PX_PER_MIN, maxIdx = Math.floor(1440 / slotMin) - 1;
    const idxAt = cy => Math.max(0, Math.min(maxIdx, Math.floor((cy - rect.top) / slotPx)));
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
      col.appendChild(box); document.body.classList.add("dragging");
      col.style.touchAction = "none";                          // stop scroll once selecting
      try { col.setPointerCapture(e.pointerId); } catch (_) {}
      if (touch && navigator.vibrate) navigator.vibrate(8);
      draw(startIdx);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      document.body.classList.remove("dragging");
      col.style.touchAction = "";
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
        openRangeEntry(slotTime(lo), slotTime(hi + 1));
      } else if (touch && !moved) {
        openRangeEntry(slotTime(startIdx), slotTime(startIdx + 1));  // tap = log this slot
      }
    };

    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    if (touch) { holdTimer = setTimeout(beginSel, 260); }
    else { beginSel(); e.preventDefault(); }
  });
}
