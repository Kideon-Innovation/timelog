// Calendar render cluster — the DOM-painting layer extracted from main.js.
//
// WHAT LIVES HERE: the functions that read app state/blocks/time and paint the
// header clock, the date range label, the legend chips, and the day-grid
// calendar itself, plus the cheap repositioners (now-line, countdown ring) and
// scrollToNow. These are pure "state -> DOM" renderers: they read from
// state.js/blocks.js/time.js and write to the DOM, but they own no event
// handlers and no modal/edit state.
//
// SHARING CONTRACT (how this stays decoupled from main.js):
//   * It imports state/config from state.js, block + heartbeat data from
//     blocks.js, and pure date helpers from time.js — exactly like blocks.js
//     does. It never imports from main.js (no cycle).
//   * The two behaviours a rendered calendar needs that genuinely belong to the
//     event/modal layer in main.js — opening the edit dialog for a block, and
//     attaching drag-to-select to a day column — are INJECTED once at boot via
//     initCalendar({ openEdit, attachDrag }). renderCalendar calls them through
//     the captured refs. This keeps the modal/drag wiring (and its module-local
//     `editing`/scrim state) in main.js while the painting lives here. Misuse is
//     hard: forgetting to call initCalendar throws a clear error the first time
//     the calendar paints, instead of silently doing nothing.
//   * `$` is the shared getElementById shorthand from ui/dom.js.
//
// Behaviour is identical to the inline originals — this is a pure move.

import {
  addDays, iso, hhmm, sameDay,
  minOfDay, minLabel, blockDurMin, fmtDur, esc,
  floorSlot as floorSlotMin, nextBoundary as nextBoundaryMin,
} from '../time.js';
import {
  state,
  HOUR_PX, PX_PER_MIN, DOW, MON,
  getSlotMin, getAnchor, getDayCols,
} from '../state.js';
import {
  colorFor, tint, mergeRuns, beatRuns,
} from '../blocks.js';
import { $ } from './dom.js';

// Same thin wrappers main.js uses: supply the active block size to the pure,
// parameterised time.js implementations so callers keep the 1-arg signature.
const floorSlot = (d) => floorSlotMin(d, getSlotMin());
const nextBoundary = (d) => nextBoundaryMin(d, getSlotMin());

// Injected event/modal hooks (see SHARING CONTRACT above). Set by initCalendar.
let _openEdit = () => { throw new Error('calendar.js: initCalendar({openEdit,attachDrag}) was not called'); };
let _attachDrag = _openEdit;

/** Wire the main.js-owned handlers the calendar needs. Call once at boot. */
export function initCalendar({ openEdit, attachDrag }) {
  _openEdit = openEdit;
  _attachDrag = attachDrag;
}

export function render() {
  renderHeaderClock();
  renderRange();
  renderLegend();
  renderCalendar();
}

export function renderHeaderClock() {
  const n = new Date();
  $('clock').textContent = hhmm(n);
  $('clockDate').textContent = DOW[n.getDay()] + ', ' + n.getDate() + '. ' + MON[n.getMonth()];
}

export function renderRange() {
  const a = getAnchor(), b = addDays(a, getDayCols() - 1);
  if (getDayCols() === 1) {
    // Single-day view (mobile): show one dated label with weekday — a dash range
    // ("8. – 8. Jun") reads as a bug.
    $('rangeLabel').innerHTML = DOW[a.getDay()] + ', ' + a.getDate() + '. ' + MON[a.getMonth()] + ' ' + a.getFullYear();
  } else {
    $('rangeLabel').innerHTML = a.getDate() + '. ' + (a.getMonth() != b.getMonth() ? MON[a.getMonth()] + ' ' : '') +
      '<em>–</em> ' + b.getDate() + '. ' + MON[b.getMonth()] + ' ' + b.getFullYear();
  }
  $('datePick').value = iso(a).slice(0, 10);
}

export function renderLegend() {
  const days = [...Array(getDayCols())].map((_, i) => addDays(getAnchor(), i));
  const labels = new Set();
  state.blocks.forEach(b => { const d = new Date(b.start); if (days.some(x => sameDay(x, d))) labels.add(b.label); });
  const el = $('legend'); el.innerHTML = '';
  [...labels].slice(0, 8).forEach(l => {
    const c = document.createElement('span'); c.className = 'chip'; c.title = l;
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = colorFor(l);
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = l;
    c.append(sw, lbl);
    el.appendChild(c);
  });
}

export function renderCalendar() {
  const cal = $('cal'); cal.innerHTML = '';
  const totalH = 24 * HOUR_PX;
  const now = new Date();
  const dayCols = getDayCols(), anchor = getAnchor();
  const gutPx = dayCols === 1 ? 44 : 60;
  cal.style.gridTemplateColumns = gutPx + 'px repeat(' + dayCols + ',1fr)';

  // gutter
  const gut = document.createElement('div'); gut.className = 'gutter'; gut.style.height = totalH + 'px';
  const gh = document.createElement('div'); gh.className = 'col-head'; gh.style.visibility = 'hidden'; gh.textContent = '.';
  gut.appendChild(gh);
  for (let h = 1; h < 24; h++) {
    const lb = document.createElement('div'); lb.className = 'hr-label';
    lb.style.top = (h * HOUR_PX) + 'px'; lb.textContent = String(h).padStart(2, '0') + ':00';
    gut.appendChild(lb);
  }
  cal.appendChild(gut);

  for (let i = 0; i < dayCols; i++) {
    const day = addDays(anchor, i), isToday = sameDay(day, now);
    const col = document.createElement('div'); col.className = 'daycol' + (isToday ? ' today' : '');
    col.style.height = totalH + 'px';

    const head = document.createElement('div');
    head.className = 'col-head' + (isToday ? ' today' : '');
    const dayBlocks = state.blocks.filter(b => sameDay(new Date(b.start), day));
    const mins = dayBlocks.reduce((a, b) => a + blockDurMin(b), 0);
    head.innerHTML = `<div class="dow">${DOW[day.getDay()]}</div><div class="dnum">${day.getDate()}</div>` +
      `<div class="tot">${mins ? fmtDur(mins) : '–'}</div>`;
    col.appendChild(head);

    // hour lines
    for (let h = 0; h < 24; h++) {
      const ln = document.createElement('div'); ln.className = 'hr-line' + (h % 6 === 0 ? ' major' : '');
      ln.style.top = (h * HOUR_PX) + 'px'; col.appendChild(ln);
    }

    // heartbeat rail: faint marks where the machine was alive that day
    beatRuns(day).forEach(run => {
      const range = minLabel(run.startMin) + '–' + minLabel(run.endMin);
      const b = document.createElement('div'); b.className = 'beat';
      b.style.top = (run.startMin * PX_PER_MIN) + 'px';
      b.style.height = Math.max(2, (run.endMin - run.startMin) * PX_PER_MIN - 1) + 'px';
      b.setAttribute('role', 'img');
      // Not in the tab order — dozens of beat-runs would flood keyboard traversal.
      // Still SR-discoverable via role=img + aria-label; the tooltip is hover-only.
      b.tabIndex = -1;
      b.setAttribute('aria-label', 'Aktivitätsspur ' + range
        + ': in dieser Zeit war TimeLog geöffnet. So siehst du, welche Lücken echte Pausen sind und was du noch nachtragen kannst.');
      // custom instant tooltip — NO native title (which has a ~1s browser delay)
      const tip = document.createElement('div'); tip.className = 'beat-tip';
      tip.setAttribute('aria-hidden', 'true');
      const th = document.createElement('span'); th.className = 'beat-tip-h';
      th.textContent = 'Aktivitätsspur · ' + range;
      tip.appendChild(th);
      tip.appendChild(document.createTextNode(
        'In dieser Zeit war TimeLog geöffnet — hilft dir zu sehen, welche Lücken echte Pausen sind und was du noch nachtragen kannst. Bleibt nur auf diesem Gerät.'));
      b.appendChild(tip);
      col.appendChild(b);
    });

    // current-slot highlight + now line
    if (isToday) {
      const ss = floorSlot(now);
      const ns = document.createElement('div'); ns.className = 'nowslot';
      ns.style.top = (minOfDay(ss) * PX_PER_MIN) + 'px'; ns.style.height = (getSlotMin() * PX_PER_MIN) + 'px';
      col.appendChild(ns);
      const nl = document.createElement('div'); nl.className = 'nowline';
      nl.style.top = (minOfDay(now) * PX_PER_MIN) + 'px'; col.appendChild(nl);
    }

    // blocks — contiguous same-label slots merge into one long block
    mergeRuns(dayBlocks).forEach(seg => {
      const s = new Date(seg.start), e = new Date(seg.end);
      const mins = (e - s) / 60000;
      const el = document.createElement('div'); el.className = 'block';
      const c = colorFor(seg.label);
      el.style.setProperty('--bc', c); el.style.setProperty('--bg2', tint(c));
      el.style.top = (minOfDay(s) * PX_PER_MIN) + 'px'; el.style.height = Math.max(11, mins * PX_PER_MIN - 3) + 'px';
      const range = seg.blocks.length > 1 ? hhmm(s) + '–' + hhmm(e) + ' · ' + fmtDur(mins) : hhmm(s);
      el.innerHTML = `<div class="lbl">${esc(seg.label)}</div><div class="tm">${range}</div>`;
      const a11y = seg.label + ', ' + hhmm(s) + ' bis ' + hhmm(e) + ', ' + fmtDur(mins);
      el.title = seg.label + '  (' + hhmm(s) + '–' + hhmm(e) + ', ' + fmtDur(mins) + ')';
      // Keyboard/SR users must reach the same edit action mouse users get.
      el.tabIndex = 0; el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Eintrag bearbeiten: ' + a11y);
      el.onclick = () => _openEdit(seg);
      el.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); _openEdit(seg); } };
      col.appendChild(el);
    });

    if (!dayBlocks.length) {
      // Empty day → onboarding hint. Today gets a slightly warmer welcome so a
      // new user landing on a blank "today" isn't left without guidance.
      const eh = document.createElement('div'); eh.className = 'empty-hint';
      eh.innerHTML = isToday
        ? `<div class="em">Noch nichts erfasst</div><div class="empty-sub">ziehen zum Eintragen · oder „+ Jetzt eintragen"</div>`
        : `<div class="em">ziehen zum Eintragen</div>`;
      col.appendChild(eh);
    }
    _attachDrag(col, day);
    cal.appendChild(col);
  }
}

export function updateNowLine() {
  // cheap: only reposition existing now elements
  const now = new Date();
  document.querySelectorAll('.nowline').forEach(n => n.style.top = (minOfDay(now) * PX_PER_MIN) + 'px');
}

export function updateCountdown() {
  const now = Date.now(), nb = nextBoundary(new Date()).getTime();
  const remain = Math.max(0, nb - now), total = getSlotMin() * 60000;
  const mm = Math.floor(remain / 60000), ss = Math.floor(remain % 60000 / 1000);
  $('cdTime').textContent = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  $('ringTxt').textContent = mm;
  const frac = remain / total, circ = 2 * Math.PI * 16;
  const prog = $('ringProg'); prog.setAttribute('stroke-dasharray', circ.toFixed(1));
  prog.setAttribute('stroke-dashoffset', (circ * (1 - frac)).toFixed(1));
}

export function scrollToNow() {
  const wrap = $('calWrap');
  // On an empty day the onboarding hint sits mid-column; scrolling to "now"
  // would push it out of view. If a hint is showing, center it instead so a
  // first-run / blank-day user actually sees the guidance.
  const hint = wrap.querySelector('.empty-hint');
  if (hint) { hint.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const y = minOfDay(new Date()) * PX_PER_MIN - 200;
  wrap.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}
