// App entry module (ES module, loaded via <script type="module"> in
// index.html). This is the former inline <script> from index.html, moved
// under src/ so Vite bundles + hashes it and so it can import the extracted
// pure helpers (src/time.js). Behaviour is unchanged: a type="module" script
// is deferred, so it still runs after the DOM is parsed (same as the old
// end-of-body classic script). XLSX is a UMD global loaded earlier in <head>.
//
// Modules are always strict mode, so the explicit "use strict" is dropped.
import './style.css';
import {
  startOfDay, addDays, iso, hhmm,
  blockDurMin, fmtDur,
  floorSlot as floorSlotMin, nextBoundary as nextBoundaryMin,
} from './time.js';
import {
  state, save,
  INTERVALS, PX_PER_MIN, DOW,
  getSlotMin, setSlotMin, getAnchor, setAnchor,
  colsForViewport, getDayCols, setDayCols,
} from './state.js';
import {
  uid, bumpRecent, clearRange,
  beat, gapSlots,
} from './blocks.js';
import { $ } from './ui/dom.js';
import {
  initCalendar, render, renderHeaderClock,
  updateNowLine, updateCountdown, scrollToNow,
} from './ui/calendar.js';
import {
  initDialogs,
  openScrim, closeScrim, close, openScrims,
  openEdit, openLogNow, openPing, openRangeEntry,
} from './ui/dialogs.js';

// Thin wrappers so the rest of the app keeps calling floorSlot(d) /
// nextBoundary(d) unchanged; they supply the active block size to the pure,
// parameterised implementations in time.js.
const floorSlot = (d) => floorSlotMin(d, getSlotMin());
const nextBoundary = (d) => nextBoundaryMin(d, getSlotMin());

/* ============================================================
   TimeLog — passive time tracker.  MIT License.
   State + config live in state.js; pure time helpers in time.js.
   ============================================================ */

/* ============================================================
   RENDER
   The calendar render cluster (render / renderHeaderClock / renderRange /
   renderLegend / renderCalendar + scrollToNow / updateNowLine / updateCountdown)
   now lives in src/ui/calendar.js. renderCalendar needs two behaviours that
   belong to this module's event/modal layer — openEdit and attachDrag — so we
   inject them once via initCalendar (see the import block + boot()).
   ============================================================ */

/* ============================================================
   PING / CATCH-UP, RANGE-ENTRY and EDIT dialogs + the scrim/modal a11y
   machinery (focus-trap, inert background, focus-restore) now live in
   src/ui/dialogs.js. They are imported above; main.js still owns drag
   (which commits via the imported openRangeEntry) and injects toast into the
   dialog layer once at boot via initDialogs.
   ============================================================ */

/* ---------- drag-to-select (Pointer Events: mouse drag, touch long-press) ----------
   Mouse/pen: press-drag selects immediately, like Google Calendar.
   Touch: a plain tap quick-logs one slot; a long-press (~260ms) then drag
   selects a range — so normal vertical scrolling of the calendar still works. */
function attachDrag(col,day){
  col.addEventListener("pointerdown",e=>{
    if(e.button>0) return;                                    // ignore right/middle
    if(e.target.closest(".block")||e.target.closest(".col-head")) return;
    const rect=col.getBoundingClientRect();
    const slotMin=getSlotMin(), slotPx=slotMin*PX_PER_MIN, maxIdx=Math.floor(1440/slotMin)-1;
    const idxAt=cy=>Math.max(0,Math.min(maxIdx,Math.floor((cy-rect.top)/slotPx)));
    const startIdx=idxAt(e.clientY), startY=e.clientY, startX=e.clientX;
    const touch=e.pointerType==="touch";
    const slotTime=i=>{ const d=new Date(day); d.setMinutes(i*slotMin); return d; };
    let selecting=false, holdTimer=null, box=null, lbl=null, tm=null;

    const draw=cur=>{
      const lo=Math.min(startIdx,cur),hi=Math.max(startIdx,cur);
      box.style.top=(lo*slotPx)+"px"; box.style.height=((hi-lo+1)*slotPx)+"px";
      tm.textContent=hhmm(slotTime(lo))+"–"+hhmm(slotTime(hi+1))+" · "+fmtDur((hi-lo+1)*slotMin);
    };
    const beginSel=()=>{
      selecting=true; holdTimer=null;
      box=document.createElement("div"); box.className="selbox";
      lbl=document.createElement("span"); lbl.className="sl"; lbl.textContent="Eintragen…";
      tm=document.createElement("span"); tm.className="st"; box.appendChild(lbl); box.appendChild(tm);
      col.appendChild(box); document.body.classList.add("dragging");
      col.style.touchAction="none";                          // stop scroll once selecting
      try{ col.setPointerCapture(e.pointerId); }catch(_){}
      if(touch && navigator.vibrate) navigator.vibrate(8);
      draw(startIdx);
    };
    const cleanup=()=>{
      document.removeEventListener("pointermove",move);
      document.removeEventListener("pointerup",up);
      document.removeEventListener("pointercancel",up);
      if(holdTimer){ clearTimeout(holdTimer); holdTimer=null; }
      document.body.classList.remove("dragging");
      col.style.touchAction="";
      if(box){ box.remove(); box=null; }
    };
    const move=ev=>{
      if(selecting){ ev.preventDefault(); draw(idxAt(ev.clientY)); return; }
      if(holdTimer && (Math.abs(ev.clientY-startY)>10||Math.abs(ev.clientX-startX)>10)){
        cleanup();                                            // moved before hold → it's a scroll
      }
    };
    const up=ev=>{
      const wasSelecting=selecting;
      const moved=Math.abs(ev.clientY-startY)>10||Math.abs(ev.clientX-startX)>10;
      cleanup();
      if(wasSelecting){
        const cur=idxAt(ev.clientY), lo=Math.min(startIdx,cur), hi=Math.max(startIdx,cur);
        openRangeEntry(slotTime(lo),slotTime(hi+1));
      } else if(touch && !moved){
        openRangeEntry(slotTime(startIdx),slotTime(startIdx+1));  // tap = log this slot
      }
    };

    document.addEventListener("pointermove",move,{passive:false});
    document.addEventListener("pointerup",up);
    document.addEventListener("pointercancel",up);
    if(touch){ holdTimer=setTimeout(beginSel,260); }
    else { beginSel(); e.preventDefault(); }
  });
}

/* ============================================================
   EXPORT (xlsx via SheetJS)
   ============================================================ */
function exportRows(){
  let from=$("expFrom").value?new Date($("expFrom").value+"T00:00:00"):null;
  let to=$("expTo").value?new Date($("expTo").value+"T23:59:59"):null;
  return [...state.blocks].sort((a,b)=>new Date(a.start)-new Date(b.start))
    .filter(b=>{ const s=new Date(b.start); return (!from||s>=from)&&(!to||s<=to); });
}
// Shared wording for an inverted export range, used by both the inline #expCount
// hint and the Export/DATEV toasts so the user sees ONE consistent message.
const INVERTED_RANGE_MSG="„Von“ liegt nach „Bis“ — bitte Zeitraum prüfen.";
function rangeInverted(){
  const fromV=$("expFrom").value, toV=$("expTo").value;
  return !!(fromV && toV && fromV>toV);
}
function updateExpCount(){
  const el=$("expCount");
  if(rangeInverted()){
    // Inverted range silently yields 0 — point the user at the swapped dates.
    el.textContent=INVERTED_RANGE_MSG;
    el.classList.add("warn");
    return;
  }
  el.classList.remove("warn");
  el.textContent=exportRows().length+" Blöcke im Zeitraum";
}
function doExport(){
  if(typeof XLSX==="undefined"){ toast("Excel-Funktion gerade nicht verfügbar"); return; }
  // An inverted range yields 0 rows for a non-obvious reason; surface the same
  // hint the inline counter shows instead of the generic "Nichts zu exportieren".
  if(rangeInverted()){ updateExpCount(); toast(INVERTED_RANGE_MSG); return; }
  const rows=exportRows();
  if(!rows.length){ toast("Nichts zu exportieren"); return; }
  const data=[["Datum","Wochentag","Start","Ende","Dauer (min)","Tätigkeit"]];
  rows.forEach(b=>{ const s=new Date(b.start),e=new Date(b.end);
    data.push([s.toLocaleDateString("de-DE"),DOW[s.getDay()],hhmm(s),hhmm(e),blockDurMin(b),b.label]); });
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws["!cols"]=[{wch:12},{wch:10},{wch:8},{wch:8},{wch:12},{wch:34}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"TimeLog");
  const tag=(rows[0].start.slice(0,10))+"_bis_"+(rows[rows.length-1].start.slice(0,10));
  XLSX.writeFile(wb,"timelog_"+tag+".xlsx");
  markExported();
  close("exportScrim"); toast("Exportiert: "+rows.length+" Blöcke");
}

/* ============================================================
   DATEV-LOHN-EXPORT (Datei) — Bewegungsdaten als Semikolon-CSV
   für DATEV Lohn und Gehalt. Stunden pro Kalendertag verdichtet.
   Spalten: Personalnummer;Datum;Lohnart;Stunden (CRLF, ASCII-rein).
   Personalnummer + Lohnart sind Pflicht und liegen separat im
   localStorage (DATEV_KEY), getrennt vom Zeit-Datenmodell.
   ============================================================ */
const DATEV_KEY="timelog.datev.v1";
function loadDatevCfg(){ try{ return JSON.parse(localStorage.getItem(DATEV_KEY))||{}; }catch(e){ return {}; } }
function saveDatevCfg(cfg){ try{ localStorage.setItem(DATEV_KEY, JSON.stringify(cfg)); }catch(e){} }
function fmtDateDE(d){ const z=n=>String(n).padStart(2,"0"); return z(d.getDate())+"."+z(d.getMonth()+1)+"."+d.getFullYear(); }
function fmtHours(min){ return (min/60).toFixed(2).replace(".",","); }
// exportRows() ist bereits nach start sortiert → Tagesreihenfolge bleibt erhalten.
function datevLohnRows(){
  const byDay=new Map();
  // Bucket each block under its START day. A midnight-crossing block (e.g. the
  // 23:45→00:00 last slot) counts entirely under the day it began on — by design,
  // consistent with exportRows()'s start-day sorting. Total minutes are unaffected.
  exportRows().forEach(b=>{ const key=b.start.slice(0,10);
    byDay.set(key,(byDay.get(key)||0)+blockDurMin(b)); });
  return [...byDay.entries()].map(([key,min])=>
    ({datum:fmtDateDE(new Date(key+"T00:00:00")), min}));
}
function doExportDatev(){
  const pnr=$("datevPnr").value.trim(), la=$("datevLa").value.trim();
  saveDatevCfg({pnr,la});
  if(!pnr||!la){ $("datevDetails").open=true; toast("Personalnummer und Lohnart angeben (vom Lohnbüro)"); return; }
  // Same inverted-range hint as the Excel export, kept consistent with #expCount.
  if(rangeInverted()){ updateExpCount(); toast(INVERTED_RANGE_MSG); return; }
  const days=datevLohnRows();
  if(!days.length){ toast("Nichts zu exportieren"); return; }
  const lines=["Personalnummer;Datum;Lohnart;Stunden"];
  days.forEach(d=>lines.push(pnr+";"+d.datum+";"+la+";"+fmtHours(d.min)));
  const csv=lines.join("\r\n")+"\r\n";
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob), a=document.createElement("a");
  const rows=exportRows();
  const tag=rows[0].start.slice(0,10)+"_bis_"+rows[rows.length-1].start.slice(0,10);
  a.href=url; a.download="datev_lohn_"+tag+".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
  markExported();
  close("exportScrim"); toast("DATEV-Lohn exportiert: "+days.length+" Tage");
}

/* ============================================================
   IMPORT (xlsx via SheetJS) — round-trips the export format.
   Reads Datum / Start / Ende / Tätigkeit; Wochentag + Dauer ignored.
   Conflict policy: slot-overwrite (imported block wins on equal start).
   ============================================================ */
// Accept BOTH the app's own text export ("02.06.2026" / "09:00") AND files
// that were opened/edited and re-saved in real Excel — where the Datum/Start/
// Ende columns come back as native date/time cells. With {raw:true,cellDates:
// true} SheetJS hands those over as JS Date objects, so parse those directly
// from their local components; fall back to the German text regex otherwise.
function parseDE(v){
  if(v instanceof Date && !isNaN(v)) return {d:v.getDate(),m:v.getMonth()+1,y:v.getFullYear()};
  const m=String(v||"").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? {d:+m[1],m:+m[2],y:+m[3]} : null; }
function parseHM(v){
  if(v instanceof Date && !isNaN(v)) return {h:v.getHours(),min:v.getMinutes()};
  const m=String(v||"").trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? {h:+m[1],min:+m[2]} : null; }

function importXlsx(file){
  if(typeof XLSX==="undefined"){ toast("Excel-Funktion gerade nicht verfügbar"); return; }
  const reader=new FileReader();
  reader.onerror=()=>toast("Datei konnte nicht gelesen werden");
  reader.onload=ev=>{
    let rows;
    try{
      const wb=XLSX.read(ev.target.result,{type:"array",cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      // raw:true keeps native date/time cells as Date objects (parseDE/parseHM
      // handle those); text cells (our own export) stay as strings.
      rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true});
    }catch(err){ toast("Keine gültige Excel-Datei"); return; }
    applyImport(rows);
  };
  reader.readAsArrayBuffer(file);
}
function applyImport(rows){
  if(!rows || rows.length<2){ toast("Datei ist leer"); return; }
  const head=rows[0].map(h=>String(h||"").trim().toLowerCase());
  const ci={ date:head.indexOf("datum"), start:head.indexOf("start"),
    end:head.indexOf("ende"), label:head.findIndex(h=>h.startsWith("tätigkeit")) };
  if(ci.date<0||ci.start<0||ci.end<0||ci.label<0){
    toast("Spalten Datum/Start/Ende/Tätigkeit fehlen"); return; }
  let ok=0, bad=0; const imported=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i]; if(!r||!r.length) continue;
    const d=parseDE(r[ci.date]), s=parseHM(r[ci.start]), e=parseHM(r[ci.end]);
    const label=String(r[ci.label]||"").trim();
    if(!d||!s||!e||!label){ bad++; continue; }
    const start=new Date(d.y,d.m-1,d.d,s.h,s.min,0,0);
    let end=new Date(d.y,d.m-1,d.d,e.h,e.min,0,0);
    if(end.getTime()<=start.getTime()) end=new Date(end.getTime()+86400000); // 23:xx–00:00 = last slot of day
    imported.push({start:iso(start),end:iso(end),label}); ok++;
  }
  if(!ok){ toast("Keine gültigen Zeilen gefunden"); return; }
  for(const b of imported){
    // Replace whatever the imported block covers across its FULL span, the same
    // way in-app drag does (fillRange→clearRange). A plain start-only overwrite
    // left finer pre-existing blocks behind when a coarse row (e.g. 09:00–11:00)
    // landed over them, producing overlapping/stacked blocks and a double-counted
    // day total. clearRange clips straddling blocks at the edges.
    clearRange(new Date(b.start), new Date(b.end));
    state.blocks.push({id:uid(),start:b.start,end:b.end,label:b.label});
    bumpRecent(b.label);
  }
  save(); render();
  toast("Importiert: "+ok+" Blöcke"+(bad?(" ("+bad+" übersprungen)"):""));
}

/* ============================================================
   TIMER
   ============================================================ */
let lastFired=floorSlot(new Date()).getTime();
function scheduleTick(){
  const ms=nextBoundary(new Date()).getTime()-Date.now()+200;
  setTimeout(()=>{ onBoundary(); scheduleTick(); }, Math.max(ms,500));
}
function onBoundary(){
  lastFired=floorSlot(new Date()).getTime();
  const gaps=gapSlots();
  if(gaps.length && !$("intro").classList.contains("show")){
    if(state.settings.soundOn) beep();
    notify(gaps.length);
    openPing(true);
  }
  refreshExportReminder();   // re-check within the existing cadence tick (covers day rollover)
  render();
}
// tickClock glues the per-second header refresh; its three constituents
// (renderHeaderClock / updateCountdown / updateNowLine) live in ui/calendar.js.
function tickClock(){ renderHeaderClock(); updateCountdown(); updateNowLine(); }

/* ---------- sound ---------- */
let actx=null;
function beep(){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==="suspended") actx.resume();
    const t=actx.currentTime;
    [880,1320].forEach((f,i)=>{
      const o=actx.createOscillator(),g=actx.createGain();
      o.type="sine"; o.frequency.value=f;
      o.connect(g); g.connect(actx.destination);
      const s=t+i*0.18; g.gain.setValueAtTime(0,s);
      g.gain.linearRampToValueAtTime(0.18,s+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,s+0.16);
      o.start(s); o.stop(s+0.17);
    });
  }catch(e){}
}

/* ---------- notification ---------- */
function notify(n){
  if(!state.settings.notifyOn || !("Notification" in window) || Notification.permission!=="granted") return;
  try{ new Notification("TimeLog — Ping",{body:n>1?(n+" Einträge nachzutragen"):"Woran arbeitest du gerade?",
    tag:"timelog-ping",renotify:true}); }catch(e){}
}

/* ============================================================
   EXCEL-EXPORT REMINDER
   Nothing is backed up to a server — if the user forgets to export and the
   browser data gets wiped, everything is gone. So we nudge them to export.

   Anchor for "days since last export":
     - last successful export timestamp (timelog.lastExport.v1), if any;
     - else the start of the OLDEST logged block (their oldest unsaved data),
       so a brand-new user with no data is never nagged, and we only nag once
       there is actually data older than the threshold that has never been saved.
   Overdue = more than EXPORT_REMINDER_DAYS days since that anchor.
   ============================================================ */
const LAST_EXPORT_KEY = "timelog.lastExport.v1";
const EXPORT_REMINDER_DAYS = 3;

function markExported(){ try{ localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString()); }catch(e){} refreshExportReminder(); }
function lastExportTime(){
  try{ const v=localStorage.getItem(LAST_EXPORT_KEY); if(v){ const t=new Date(v).getTime(); if(!isNaN(t)) return t; } }catch(e){}
  return null;
}
function oldestBlockTime(){
  let min=null;
  for(const b of state.blocks){ const t=new Date(b.start).getTime();
    if(!isNaN(t) && (min===null || t<min)) min=t; }
  return min;
}
/* central calc: whole days since the export anchor, or null when there is
   simply nothing to protect (no export ever AND no data). */
function daysSinceExport(){
  const anchorT = lastExportTime() ?? oldestBlockTime();
  if(anchorT===null) return null;
  return Math.floor((Date.now()-anchorT)/86400000);
}
function exportOverdue(){
  const d=daysSinceExport();
  return d!==null && d>EXPORT_REMINDER_DAYS;
}
function todayKey(){ return iso(startOfDay(new Date())).slice(0,10); }

/* In-app nudge: at most once per day, dismissible, re-appears next day if still
   overdue. Notification fires once per day too (same day-gate), best-effort. */
function exportNudgeWants(){
  return exportOverdue()
      && state.settings.exportReminderDay !== todayKey()
      && !$("intro").classList.contains("show");
}
function refreshExportReminder(){
  const show = exportNudgeWants();
  $("exportNudge").hidden = !show;
  if(show){
    const d=daysSinceExport();
    $("exportNudgeTxt").innerHTML =
      "Seit <b>"+d+" Tagen</b> kein Excel-Export — lad deine Daten als Excel runter, "
      + "damit nichts verloren geht. Sie liegen nur auf diesem Gerät.";
    notifyExportOverdue(d);
  }
  // Only ONE banner at a time: the data-loss nudge wins, so re-sync the
  // notifications nudge (it hides itself while the export nudge is up).
  refreshNotifyNudge();
}
function notifyExportOverdue(days){
  if(!state.settings.notifyOn || !("Notification" in window) || Notification.permission!=="granted") return;
  // gate to once per day via the same dismiss-day mechanism is too aggressive
  // (dismiss would also kill the banner); use a dedicated per-day notify flag.
  if(state.settings.exportNotifyDay===todayKey()) return;
  try{
    new Notification("TimeLog — Daten sichern",{
      body:"Seit "+days+" Tagen kein Excel-Export. Lad deine Daten runter, damit nichts verloren geht.",
      tag:"timelog-export", renotify:false });
    state.settings.exportNotifyDay=todayKey(); save();
  }catch(e){}
}
$("exportNudgeDismiss").onclick=()=>{ state.settings.exportReminderDay=todayKey(); save(); refreshExportReminder(); };
$("exportNudgeGo").onclick=()=>{ updateExpCount(); openScrim("exportScrim"); };

/* ---------- toast ---------- */
let toastT=null;
function toast(m){ const t=$("toast"); t.textContent=m; t.onclick=null; t.style.cursor=""; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),2400); }

/* ============================================================
   WIRING
   ============================================================ */
$("prevBtn").onclick=()=>{ setAnchor(addDays(getAnchor(),-getDayCols())); render(); };
$("nextBtn").onclick=()=>{ setAnchor(addDays(getAnchor(),getDayCols())); render(); };
$("todayBtn").onclick=()=>{ setAnchor(startOfDay(new Date())); render(); scrollToNow(); };
$("datePick").onchange=e=>{ if(e.target.value){ setAnchor(startOfDay(new Date(e.target.value+"T00:00:00"))); render(); } };
$("logNowBtn").onclick=()=>openLogNow();
$("exportBtn").onclick=()=>{ updateExpCount(); openScrim("exportScrim"); };
$("expCancel").onclick=()=>close("exportScrim");
$("expAll").onclick=()=>{ $("expFrom").value=""; $("expTo").value=""; updateExpCount(); };
$("expGo").onclick=doExport;
$("expDatev").onclick=doExportDatev;
(function initDatevInputs(){ const c=loadDatevCfg(); if(c.pnr) $("datevPnr").value=c.pnr; if(c.la) $("datevLa").value=c.la; })();
$("expFrom").onchange=updateExpCount; $("expTo").onchange=updateExpCount;

/* overflow menu */
const menuEl=$("menu"), menuBtn=$("menuBtn");
function closeMenu(){ menuEl.hidden=true; menuBtn.setAttribute("aria-expanded","false"); }
function openMenu(){ menuEl.hidden=false; menuBtn.setAttribute("aria-expanded","true"); }
menuBtn.onclick=e=>{ e.stopPropagation(); menuEl.hidden?openMenu():closeMenu(); };
menuEl.addEventListener("click",e=>{ if(e.target.closest(".menu-item")) closeMenu(); });
document.addEventListener("mousedown",e=>{
  if(!menuEl.hidden && !menuBtn.parentElement.contains(e.target)) closeMenu(); });

/* import */
$("importBtn").onclick=()=>$("importFile").click();
$("importFile").onchange=e=>{ const f=e.target.files[0]; if(f) importXlsx(f); e.target.value=""; };

/* first-run intro */
function showIntro(){ $("intro").classList.add("show"); $("intro").setAttribute("aria-hidden","false"); $("intro").scrollTop=0;
  // Mirror the modal pattern: pull the app out of the a11y tree + tab order so
  // focus can't leak into the controls hidden behind the intro overlay.
  const app=$("app"); app.setAttribute("aria-hidden","true"); try{ app.inert=true; }catch(e){}
  armIntroDemo(); }
function hideIntro(){ $("intro").classList.remove("show"); $("intro").setAttribute("aria-hidden","true");
  const app=$("app"); app.removeAttribute("aria-hidden"); try{ app.inert=false; }catch(e){} }

/* Ping→Excel preview: loop the CSS animation only while it's actually
   on screen. Scoped to the scrolling .intro container; CSS already
   neutralises everything under prefers-reduced-motion. Set up once. */
let _demoObserver=null;
function armIntroDemo(){
  const demo=$("introDemo"); if(!demo) return;
  if(_demoObserver){ _demoObserver.disconnect(); }
  if(!("IntersectionObserver" in window)){ demo.classList.add("playing"); return; }
  _demoObserver=new IntersectionObserver((entries)=>{
    for(const e of entries) demo.classList.toggle("playing", e.isIntersecting);
  }, {root:$("intro"), threshold:0.4});
  _demoObserver.observe(demo);
}
function dismissIntro(){ state.settings.introSeen=true; save(); hideIntro(); refreshNotifyNudge(); refreshExportReminder(); }
$("introStart").onclick=dismissIntro;
$("introStartBottom").onclick=dismissIntro;              // closing CTA mirrors the hero start button
$("introInstall").onclick=()=>$("installBtn").click();   // reuse existing install flow (prompt / iOS help)
$("aboutBtn").onclick=()=>showIntro();

/* ============================================================
   PWA: install flow, service worker, responsive re-render
   ============================================================ */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
              (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
                     window.navigator.standalone===true;
let deferredPrompt=null;

window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferredPrompt=e;
  if(!isStandalone) $("installBtn").classList.add("show"); });
window.addEventListener("appinstalled",()=>{ deferredPrompt=null;
  $("installBtn").classList.remove("show"); toast("Installiert — viel Spaß 🎉"); });

$("installBtn").onclick=async()=>{
  if(deferredPrompt){
    deferredPrompt.prompt();
    const {outcome}=await deferredPrompt.userChoice;
    deferredPrompt=null;
    if(outcome==="accepted") $("installBtn").classList.remove("show");
    return;
  }
  openInstallHelp();                       // iOS / browsers without the prompt API
};
$("installClose").onclick=()=>close("installScrim");

function openInstallHelp(){
  const ua=navigator.userAgent, isFirefox=/firefox/i.test(ua);
  let steps;
  if(isIOS){
    $("installTitle").textContent="Auf iPhone / iPad installieren";
    steps=['Tippe unten in Safari auf <b>Teilen</b> <span class="shareglyph">⬆</span>',
           'Wähle <b>„Zum Home-Bildschirm"</b>',
           'Oben rechts auf <b>Hinzufügen</b> — fertig.'];
  } else if(isFirefox){
    $("installTitle").textContent="Installieren";
    steps=['Öffne das Browser-<b>Menü</b> (⋮ oben rechts)',
           'Wähle <b>„App installieren"</b> / „Zum Startbildschirm hinzufügen"',
           'Bestätigen — läuft danach im eigenen Fenster.'];
  } else {
    $("installTitle").textContent="Installieren";
    steps=['Klick in der Adressleiste auf das <b>Installieren-Symbol</b> (↗ bzw. Monitor mit Pfeil)',
           'Alternativ Browser-<b>Menü</b> (⋮) → <b>„App installieren"</b>',
           'Bestätigen — TimeLog läuft danach offline im eigenen Fenster.'];
  }
  $("installBody").innerHTML='<ul class="ioslist">'+steps.map(s=>"<li>"+s+"</li>").join("")+'</ul>';
  openScrim("installScrim");
}

// re-render when crossing the mobile/desktop breakpoint
let resizeT=null;
window.addEventListener("resize",()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>{
  const c=colsForViewport(); if(c!==getDayCols()){ setDayCols(c); render(); }
},150); });

/* Service worker: offline app shell + auto-update.
   The Workbox SW is generated and registered by vite-plugin-pwa
   (registerType:'autoUpdate', injectRegister:'auto'). On a new deploy the
   fresh SW installs, skipWaiting + clientsClaim take control immediately and
   the page reloads to the new version — no manual hard-refresh. The old
   hand-written sw.js + manual registration were removed in favor of this. */

function applyTheme(){
  const dark=state.settings.theme==="dark";
  document.documentElement.setAttribute("data-theme", dark?"dark":"light");
  // Label by the action the button performs, so SR users hear what activating it does.
  const btn=$("themeBtn");
  btn.textContent=dark?"☀️ Helles Design":"🌙 Dunkles Design";
  btn.setAttribute("aria-label", dark?"Zu hellem Design wechseln":"Zu dunklem Design wechseln");
  btn.removeAttribute("aria-pressed");
  // tint the OS status bar / window chrome to match the app
  const meta=$("metaTheme"); if(meta) meta.setAttribute("content", dark?"#0f2137":"#faf9f7");
}
$("themeBtn").onclick=()=>{ state.settings.theme=(state.settings.theme==="light")?"dark":"light"; save(); applyTheme(); };

function initInterval(){
  const sel=$("intervalSel");
  sel.innerHTML=INTERVALS.map(m=>`<option value="${m}">${m} min</option>`).join("");
  sel.value=String(getSlotMin());
  sel.onchange=()=>{
    setSlotMin(parseInt(sel.value,10));
    state.settings.intervalMin=getSlotMin(); save();
    lastFired=floorSlot(new Date()).getTime();
    render(); updateCountdown();
    toast("Blockgröße: "+getSlotMin()+" min");
  };
}

function refreshSoundBtn(){
  $("soundBtn").textContent=state.settings.soundOn?"🔇 Ton ausschalten":"🔊 Ton anschalten";
  $("soundBtn").classList.toggle("ghost",!state.settings.soundOn);
  $("soundBtn").setAttribute("aria-pressed", state.settings.soundOn?"true":"false");
}
$("soundBtn").onclick=()=>{ state.settings.soundOn=!state.settings.soundOn; save();
  refreshSoundBtn();
  if(state.settings.soundOn) beep(); refreshNotifyNudge(); toast("Ton "+(state.settings.soundOn?"eingeschaltet":"ausgeschaltet")); };

$("notifyBtn").onclick=async()=>{
  if(!("Notification" in window)){ toast("Dieser Browser kann keine Erinnerungen anzeigen"); return; }
  // Real on/off toggle: if currently on, turn off; otherwise ask + turn on.
  if(notifyGranted()){
    state.settings.notifyOn=false; save(); refreshNotifyBtn();
    toast("Erinnerungen ausgeschaltet"); return;
  }
  let p=Notification.permission;
  if(p!=="granted") p=await Notification.requestPermission();
  state.settings.notifyOn=(p==="granted"); save(); refreshNotifyBtn();
  toast(p==="denied" ? "Im Browser blockiert — bitte dort erlauben"
                     : (state.settings.notifyOn?"Erinnerungen eingeschaltet":"Erinnerungen ausgeschaltet"));
};
function refreshNotifyBtn(){
  const on=state.settings.notifyOn && ("Notification" in window) && Notification.permission==="granted";
  $("notifyBtn").textContent=on?"🔕 Erinnerungen ausschalten":"🔔 Erinnerungen anschalten";
  $("notifyBtn").classList.toggle("ghost",!on);
  $("notifyBtn").setAttribute("aria-pressed", on?"true":"false");
  refreshNotifyNudge();
}

/* ---------- notifications-off nudge ----------
   Reminds the user TimeLog can only ping them when OS notifications are on.
   Shown once until dismissed; vanishes on its own once notifications are granted. */
function notifyGranted(){
  return state.settings.notifyOn && ("Notification" in window) && Notification.permission==="granted";
}
function refreshNotifyNudge(){
  const supported = "Notification" in window;
  // Only ONE banner at a time — the export/data-loss nudge takes priority, so
  // hold this one back whenever that one is (or would be) showing.
  const show = supported && !notifyGranted() && !state.settings.notifyNudgeDismissed
            && !$("intro").classList.contains("show")
            && !exportNudgeWants();
  $("notifyNudge").hidden = !show;
  if(show){
    // sound is the fallback ping channel — mention it if that's off too
    $("nudgeHint").textContent = state.settings.soundOn
      ? "Jetzt aktivieren — den Ping-Takt stellst du im Menü unter Blockgröße ein."
      : "Auch der Ton ist aus. Jetzt aktivieren — den Takt stellst du im Menü unter Blockgröße ein.";
  }
}
$("nudgeDismiss").onclick=()=>{ state.settings.notifyNudgeDismissed=true; save(); refreshNotifyNudge(); };
$("nudgeEnable").onclick=async()=>{
  if("Notification" in window){
    let p=Notification.permission;
    if(p!=="granted") p=await Notification.requestPermission();
    state.settings.notifyOn=(p==="granted");
  }
  if(!state.settings.soundOn){ state.settings.soundOn=true; refreshSoundBtn(); beep(); }
  save(); refreshNotifyBtn();
  if(notifyGranted()) toast("Erinnerungen eingeschaltet — du wirst jetzt erinnert");
  else { openMenu(); toast("Den Ping-Takt stellst du hier unter Blockgröße ein"); }
};

// close scrim on backdrop click / Esc
document.querySelectorAll(".scrim").forEach(s=>s.addEventListener("mousedown",e=>{ if(e.target===s) closeScrim(s.id); }));
document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ openScrims().forEach(s=>closeScrim(s.id)); closeMenu(); if($("intro").classList.contains("show")) dismissIntro(); } });

// returning to tab → catch up
document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ recordBeat(); refreshExportReminder(); render(); if(!$("intro").classList.contains("show") && gapSlots().length) openPing(true); } });
window.addEventListener("focus",recordBeat);

/* heartbeat: stamp the current slot while the tab is visible.
   If a brand-new slot lit up, repaint so the rail stays current. */
function recordBeat(){ if(document.hidden) return; if(beat()) render(); }

/* ---------- boot ---------- */
function boot(){
  // Inject main.js's toast primitive into the dialog layer (it lives here until
  // notify.js is extracted) so dialogs can surface their confirmations.
  initDialogs({ toast });
  // Hand the calendar renderer the two event/modal behaviours it needs: opening
  // the edit dialog (now in dialogs.js) and attaching drag-to-select (still here).
  initCalendar({ openEdit, attachDrag });
  applyTheme();
  if(!state.settings.introSeen) showIntro();
  initInterval();
  refreshSoundBtn();
  refreshNotifyBtn();
  refreshExportReminder();            // remind to export if overdue (once/day)
  recordBeat();                       // mark this slot alive on load
  render();
  scrollToNow();
  tickClock();
  setInterval(tickClock,1000);
  setInterval(recordBeat,60000);      // heartbeat every ~60s while visible
  scheduleTick();

  // iOS has no beforeinstallprompt — surface the install help button manually
  if(isIOS && !isStandalone) $("installBtn").classList.add("show");

  // manifest shortcuts: ?action=log | export
  const action=new URLSearchParams(location.search).get("action");
  if(action==="log"){ setTimeout(openLogNow,350); }
  else if(action==="export"){ setTimeout(()=>{ updateExpCount(); openScrim("exportScrim"); },350); }
  else { setTimeout(()=>{ if(!$("intro").classList.contains("show") && gapSlots().length) openPing(true); }, 900); }  // initial catch-up
}
boot();
