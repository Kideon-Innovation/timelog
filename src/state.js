// Central app state + config — the single source of truth that every other
// module imports. Extracted from main.js so the app is no longer one giant
// module scope; main.js (and future modules like blocks.js / ui.js) read and
// mutate state exclusively through this module.
//
// SHARING CONTRACT (read before adding to this file):
//
//   * `state` is an OBJECT, exported by reference. Mutating its fields
//     (`state.blocks = ...`, `state.settings.theme = ...`) is visible
//     everywhere that imported it. Never REASSIGN the `state` binding itself
//     (`state = ...`) from another module — that would not propagate. Mutate
//     its fields instead. `load()` replaces the contents via a one-time init
//     in this module only.
//
//   * Plain CONSTANTS (INTERVALS, PALETTE, HOUR_PX, …) are exported `const`.
//     They are never reassigned, so live-binding imports are safe.
//
//   * The three values that get REASSIGNED at runtime — the active block size,
//     the visible anchor day, and the column count — are NOT exported as bare
//     `let`. A `let` reassigned from another module does not propagate back to
//     importers (ES module live bindings are read-only for the importer). So
//     they live behind accessor pairs: getSlotMin/setSlotMin, getAnchor/
//     setAnchor, getDayCols/setDayCols. This is the only contract that stays
//     correct once reads/writes are spread across multiple modules, and it is
//     hard to misuse (you cannot accidentally shadow them with a local copy).

import { startOfDay } from './time.js';

/* ---------- localStorage key + config constants ---------- */
export const KEY = 'timelog.v1';
export const INTERVALS = [60, 30, 20, 15, 10, 6];   // = 60 / n  (n = 1,2,3,4,6,10)
export const CATCHUP_CAP_MS = 2 * 60 * 60 * 1000;   // only ask back ~2h
/* Morgen-Modus boundary: gaps that reach back across today 06:00 local are a
   night's sleep, not forgotten work — see morningMode() in blocks.js. */
export const MORNING_BOUNDARY_HOUR = 6;
/* Calm, Kideon-harmonious block hues — mid-tone, readable on off-white and navy. */
export const PALETTE = ['#c49a6c', '#5f8f8c', '#c0766a', '#6b86b0', '#a07fa6',
  '#8aa173', '#c2935a', '#5b9aa0', '#d0a85c', '#9488c0', '#c98bab', '#79a3c4'];
export const HOUR_PX = 116;
export const PX_PER_MIN = HOUR_PX / 60;
export const DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/* ---------- persisted state (mutate fields, never reassign the binding) ---------- */
// First-run theme default: honor the OS preference so dark-mode users don't get
// flash-banged by a light UI on their very first visit. Only affects a FRESH
// state with no stored settings — any persisted `theme` still wins on merge, so
// returning users (incl. those who picked light) are never overridden.
function defaultTheme() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches) return 'dark';
  } catch (e) { /* no matchMedia → fall through to light */ }
  return 'light';
}

function defaultSettings(slotMin) {
  return {
    intervalMin: slotMin, soundOn: true, notifyOn: false, introSeen: false,
    notifyNudgeDismissed: false, exportReminderDay: '', exportNotifyDay: '', theme: defaultTheme(),
  };
}

function loadState(slotMin) {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.blocks) {
      return Object.assign({ blocks: [], recentLabels: [], settings: {} }, s,
        { settings: Object.assign(defaultSettings(slotMin), s.settings || {}) });
    }
  } catch (e) { /* corrupt storage → fall through to a fresh default state */ }
  return { blocks: [], recentLabels: [], settings: defaultSettings(slotMin) };
}

// Initial load. SLOT_MIN starts at 15 (the default block size) and is then
// reconciled with the persisted setting below — identical to the old inline
// sequence in main.js.
export const state = loadState(15);

/** Persist the current state object to localStorage. */
export function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

/* ---------- reassigned runtime values (accessor-gated) ---------- */

// Active block size in minutes, from settings. Reconciled with the persisted
// value, falling back to 15 when the stored interval isn't a known option.
let _slotMin = INTERVALS.includes(state.settings.intervalMin) ? state.settings.intervalMin : 15;
export function getSlotMin() { return _slotMin; }
export function setSlotMin(v) { _slotMin = v; }

// Left-most visible day in the calendar.
let _anchor = startOfDay(new Date());
export function getAnchor() { return _anchor; }
export function setAnchor(d) { _anchor = d; }

/** Columns for the current viewport: 3 on desktop, 1 on phones. */
export function colsForViewport() {
  return window.matchMedia('(max-width:760px)').matches ? 1 : 3;
}
let _dayCols = colsForViewport();
export function getDayCols() { return _dayCols; }
export function setDayCols(v) { _dayCols = v; }
