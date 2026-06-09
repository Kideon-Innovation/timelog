// Notification layer — the user-feedback primitives extracted from main.js.
//
// WHAT LIVES HERE: the three "tell the user something happened" channels that
// the rest of the app fires and forgets:
//   * toast(msg)   — the transient in-app aria-live snackbar (#toast).
//   * notify(n)    — a best-effort OS Notification for the ping/catch-up nudge.
//   * beep()       — the WebAudio two-tone ping sound.
// Each owns its small module-local state (the toast dismiss timer, the lazily
// created AudioContext) which used to sit at module scope in main.js.
//
// SHARING CONTRACT (how this stays decoupled and cycle-free):
//   * It imports ONLY `state` (to read settings.notifyOn) from state.js and the
//     `$` shorthand from ui/dom.js — the two lowest layers. It imports nothing
//     UI-higher (no dialogs.js / calendar.js), so it can be safely imported by
//     those modules without forming a cycle. dialogs.js imports `toast` from
//     here directly (no DI shim needed); main.js imports all three.
//
// Behaviour is identical to the inline originals — this is a pure move.

import { state } from '../state.js';
import { $ } from './dom.js';

/* ---------- toast ---------- */
let toastT = null;
export function toast(m) {
  const t = $('toast'); t.textContent = m; t.onclick = null; t.style.cursor = '';
  t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- notification ---------- */
export function notify(n) {
  if (!state.settings.notifyOn || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification('KIDEON time — Ping', {
      body: n > 1 ? (n + ' Einträge nachzutragen') : 'Woran arbeitest du gerade?',
      tag: 'timelog-ping', renotify: true,
    });
  } catch (e) { /* notifications are best-effort */ }
}

/* ---------- sound ---------- */
let actx = null;
export function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(g); g.connect(actx.destination);
      const s = t + i * 0.18; g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.18, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.start(s); o.stop(s + 0.17);
    });
  } catch (e) { /* WebAudio unavailable → silent */ }
}
