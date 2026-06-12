// Pure time / formatting helpers extracted from the app's god-script.
//
// Every function here is referentially transparent: no DOM access, no module
// globals, no I/O. Behaviour is identical to the inline originals — these were
// lifted verbatim. floorSlot/nextBoundary depend on the active slot size, so
// they take `slotMin` as an explicit parameter instead of closing over the
// mutable SLOT_MIN global (the app keeps a thin wrapper that supplies it).

/** Midnight (local) of the given date. */
export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Date shifted by n whole days (local). */
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Floor a date down to the start of its slotMin-minute slot (local). */
export function floorSlot(d, slotMin) {
  const x = new Date(d);
  x.setSeconds(0, 0);
  x.setMinutes(Math.floor(x.getMinutes() / slotMin) * slotMin);
  return x;
}

/** Start of the next slotMin-minute slot after d. */
export function nextBoundary(d, slotMin) {
  return new Date(floorSlot(d, slotMin).getTime() + slotMin * 60000);
}

/** Local "YYYY-MM-DDTHH:MM:00" (no timezone) — the on-disk block timestamp. */
export function iso(d) {
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) +
    'T' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':00';
}

/** "HH:MM" of a date (local). */
export function hhmm(d) {
  const z = (n) => String(n).padStart(2, '0');
  return z(d.getHours()) + ':' + z(d.getMinutes());
}

/** True if a and b fall on the same local calendar day. */
export function sameDay(a, b) {
  return a.getFullYear() == b.getFullYear() &&
    a.getMonth() == b.getMonth() &&
    a.getDate() == b.getDate();
}

/** Minute-of-day (0..1439) for a date (local). */
export function minOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Date at minute-of-day m (0..1440, where 1440 = next midnight) on day's
 * calendar day — or null when that local wall-clock time does not exist.
 * On the DST spring-forward day Date normalisation silently maps the phantom
 * 02:00–03:00 hour onto 03:00–04:00, colliding with the real 03:00 slots; the
 * round-trip check exposes that so callers can refuse instead of mis-committing.
 */
export function dayMinuteToDate(day, m) {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(m);
  return minOfDay(d) === m % 1440 ? d : null;
}

/** "HH:MM" label for a minute-of-day count (wraps at 24h). */
export function minLabel(m) {
  const z = (n) => String(n).padStart(2, '0');
  return z(Math.floor(m / 60) % 24) + ':' + z(m % 60);
}

/** Duration of a block (object with ISO start/end strings) in minutes. */
export function blockDurMin(b) {
  return (new Date(b.end) - new Date(b.start)) / 60000;
}

/** Human duration: "1h 30m", "2h", "45m". */
export function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (h + 'h' + (m ? ' ' + m + 'm' : '')) : (m + 'm');
}

/** Escape the 4 HTML-significant chars for safe innerHTML interpolation. */
export function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
