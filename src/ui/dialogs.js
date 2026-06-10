// Dialog / modal layer — the scrim + modal builders extracted from main.js.
//
// WHAT LIVES HERE:
//   * The a11y modal infrastructure: openScrim / closeScrim (+ close alias) /
//     focusables / openScrims and the Tab focus-trap keydown handler. Every
//     scrim in the app opens and closes through these so focus-trap, background
//     `inert`/`aria-hidden`, and focus-restore behave identically everywhere.
//   * The modal builders that read app state and paint a dialog body, then open
//     a scrim: recentChips, openPing / openSinglePing / openCatchup,
//     openRangeEntry, openLogNow / closePing, and openEdit (+ its button wiring).
//   * The module-local modal state those builders own: `editing`, `editRows`,
//     and `_modalOpener` (the element to restore focus to on close).
//
// SHARING CONTRACT (how this stays decoupled and cycle-free):
//   * It imports state/config from state.js, block helpers from blocks.js, pure
//     date helpers from time.js, the `$` shorthand from ui/dom.js, `toast` from
//     ui/notify.js, and the calendar's `render` from ui/calendar.js — the same
//     one-directional layering the rest of src/ already uses. calendar.js and
//     notify.js never import dialogs.js, so these imports introduce NO cycle.
//   * `toast` (the in-app snackbar a few dialogs fire on commit) now lives in
//     ui/notify.js and is imported directly — the earlier initDialogs({ toast })
//     DI shim is retired now that the primitive has its own low-level module.
//   * main.js imports openScrim/closeScrim/close (export, install help, intro and
//     nudge flows still drive scrims), openLogNow/openPing (timer + manual log),
//     openRangeEntry (drag-to-select commit), and openEdit (injected into the
//     calendar via initCalendar) from here.
//
// Behaviour is identical to the inline originals — this is a pure move.

import { hhmm, fmtDur, floorSlot as floorSlotMin } from '../time.js';
import { state, getSlotMin, DOW, MON } from '../state.js';
import {
  colorFor, setBlock, blocksInRange, fillRange, lastLabel, gapSlots,
} from '../blocks.js';
import { $ } from './dom.js';
import { toast } from './notify.js';
import { render } from './calendar.js';

// Same thin wrapper main.js / calendar.js use: supply the active block size to
// the pure, parameterised time.js implementation so callers keep the 1-arg form.
const floorSlot = (d) => floorSlotMin(d, getSlotMin());

/* ============================================================
   PING / CATCH-UP
   ============================================================ */
export function recentChips(onPick, current){
  const wrap=document.createElement("div"); wrap.className="chips";
  const last=lastLabel();
  if(last){
    const b=document.createElement("button"); b.className="chip-b same";
    b.textContent="↻ Weiter wie eben — "+last; b.title=last;
    b.onclick=()=>onPick(last); wrap.appendChild(b);
  }
  state.recentLabels.filter(l=>l!==last).slice(0,8).forEach(l=>{
    const b=document.createElement("button"); b.className="chip-b";
    b.style.setProperty("--bc",colorFor(l)); b.textContent=l; b.title=l;
    b.onclick=()=>onPick(l); wrap.appendChild(b);
  });
  return wrap;
}

export function openPing(triggeredByTimer){
  const gaps=gapSlots();
  if(!gaps.length){ if(!triggeredByTimer) openLogNow(); return; }
  if(gaps.length===1) openSinglePing(gaps[0]);
  else openCatchup(gaps);
  openScrim("pingScrim");
}

function openSinglePing(slot){
  const end=new Date(slot.getTime()+getSlotMin()*60000);
  $("pingKick").textContent="15-MINUTEN-PING";
  $("pingTitle").textContent="Woran hast du gearbeitet?";
  $("pingSub").textContent=hhmm(slot)+" – "+hhmm(end)+" · "+DOW[slot.getDay()]+" "+slot.getDate()+". "+MON[slot.getMonth()];
  const body=$("pingBody"); body.innerHTML="";
  const inp=document.createElement("input");
  inp.className="txt"; inp.setAttribute("autocomplete","off");
  inp.placeholder="Stichwort … z. B. Meeting, Doku, Telefonat";
  body.appendChild(inp);
  const commit=v=>{ setBlock(slot,v); closePing(); render(); toast(v?("Eingetragen: "+v):"Leer gelassen"); };
  body.appendChild(recentChips(v=>commit(v),null));
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") commit(inp.value); });

  const foot=$("pingFoot"); foot.innerHTML="";
  const skip=document.createElement("button"); skip.className="btn ghost";
  skip.innerHTML="Nicht am PC / leer lassen"; skip.onclick=()=>commit("");
  const sp=document.createElement("div"); sp.className="spacer";
  const ok=document.createElement("button"); ok.className="btn amber"; ok.textContent="Eintragen";
  ok.onclick=()=>commit(inp.value);
  foot.append(skip,sp,ok);
  setTimeout(()=>inp.focus(),60);
}

function openCatchup(gaps){
  $("pingKick").textContent="NACHZUTRAGEN · "+gaps.length+(gaps.length===1?" EINTRAG":" EINTRÄGE");
  $("pingTitle").textContent="Was war seit eben los?";
  $("pingSub").textContent="Lücken der letzten 2 Stunden. Leer lassen ist ok — du warst evtl. nicht am PC.";
  const body=$("pingBody"); body.innerHTML="";
  const rows=gaps.map(slot=>{
    const end=new Date(slot.getTime()+getSlotMin()*60000);
    const row=document.createElement("div"); row.className="gaprow";
    const tg=document.createElement("span"); tg.className="tg"; tg.textContent=hhmm(slot)+"–"+hhmm(end);
    const inp=document.createElement("input"); inp.setAttribute("autocomplete","off");
    inp.placeholder="Stichwort …";
    const range="("+hhmm(slot)+"–"+hhmm(end)+")";
    const skip=document.createElement("button"); skip.type="button"; skip.className="skip";
    // Reversible skip: clicking toggles the row between active and "leer gelassen".
    // Skipping remembers any text so it can be restored on undo. stash starts
    // null so the initial setSkipped(false) never clobbers a value — same safe
    // pattern as openEdit's per-slot rows (see setCleared there).
    let stash=null;
    const setSkipped=on=>{
      if(on){ stash=inp.value; inp.value=""; inp.placeholder="leer gelassen"; }
      else { if(stash!==null) inp.value=stash; stash=null; inp.placeholder="Stichwort …"; }
      row.classList.toggle("done",on);
      inp.disabled=on;
      skip.textContent=on?"↩":"✕";
      skip.title=on?"wieder eintragen "+range:"leer lassen "+range;
      skip.setAttribute("aria-label",(on?"Diesen Eintrag wieder aktivieren ":"Diesen Eintrag leer lassen ")+range);
      skip.setAttribute("aria-pressed",on?"true":"false");
    };
    setSkipped(false);
    skip.onclick=()=>{ const willSkip=!row.classList.contains("done"); setSkipped(willSkip); if(!willSkip) inp.focus(); };
    row.append(tg,inp,skip);
    body.appendChild(row);
    return {slot,inp,row};
  });
  rows[0].inp.focus();
  // quick "all = X"
  const quick=recentChips(v=>{ rows.forEach(r=>{ if(!r.row.classList.contains("done")) r.inp.value=v; }); },null);
  quick.style.marginTop="14px"; body.appendChild(quick);

  const foot=$("pingFoot"); foot.innerHTML="";
  const skipAll=document.createElement("button"); skipAll.className="btn ghost";
  skipAll.textContent="Alle leer lassen"; skipAll.onclick=()=>{ closePing(); };
  const sp=document.createElement("div"); sp.className="spacer";
  const ok=document.createElement("button"); ok.className="btn amber"; ok.textContent="Speichern";
  ok.onclick=()=>{ rows.forEach(r=>setBlock(r.slot,r.inp.value)); closePing(); render();
    toast("Nachtrag gespeichert"); };
  foot.append(skipAll,sp,ok);
}

export function openRangeEntry(s,e){
  const mins=(e-s)/60000;
  const existing=blocksInRange(s,e);
  const existLabels=[...new Set(existing.map(b=>b.label))];
  $("pingKick").textContent="ZEITRAUM EINTRAGEN";
  $("pingTitle").textContent="Was läuft in diesem Block?";
  $("pingSub").textContent=hhmm(s)+" – "+hhmm(e)+" · "+fmtDur(mins)+" · "+DOW[s.getDay()]+" "+s.getDate()+". "+MON[s.getMonth()];
  const body=$("pingBody"); body.innerHTML="";
  const inp=document.createElement("input"); inp.className="txt"; inp.setAttribute("autocomplete","off");
  inp.placeholder="z. B. Meeting, Fokuszeit, Mittag …";
  if(existLabels.length){ inp.value=existLabels.length===1?existLabels[0]:""; }
  body.appendChild(inp);
  if(existing.length){
    const note=document.createElement("p"); note.className="muted"; note.style.marginTop="10px";
    note.textContent="⚠ Überschreibt vorhandene Blöcke: "+existLabels.join(", ");
    body.appendChild(note);
  }
  const commit=v=>{ fillRange(s,e,v); closePing(); render();
    toast(v.trim()?("Eingetragen: "+v):"Bereich geleert"); };
  body.appendChild(recentChips(v=>commit(v)));
  inp.addEventListener("keydown",ev=>{ if(ev.key==="Enter") commit(inp.value); });
  const foot=$("pingFoot"); foot.innerHTML="";
  // delete: double-confirm when the range actually contains blocks
  const del=document.createElement("button"); del.className="btn ghost";
  if(existing.length){
    del.classList.add("del"); del.textContent="Bereich löschen";
    let armed=false;
    del.onclick=()=>{ if(!armed){ armed=true; del.textContent="Wirklich löschen? ("+existing.length+")";
      setTimeout(()=>{ armed=false; del.textContent="Bereich löschen"; },2500); }
      else commit(""); };
  } else { del.textContent="Bereich leeren"; del.onclick=()=>commit(""); }
  const sp=document.createElement("div"); sp.className="spacer";
  const ok=document.createElement("button"); ok.className="btn amber"; ok.textContent="Eintragen"; ok.onclick=()=>commit(inp.value);
  foot.append(del,sp,ok);
  openScrim("pingScrim"); setTimeout(()=>inp.focus(),60);
}

export function openLogNow(){
  // manual: log the current (ongoing) slot
  openSinglePing(floorSlot(new Date()));
  openScrim("pingScrim");
  $("pingKick").textContent="MANUELL EINTRAGEN";
  $("pingTitle").textContent="Woran arbeitest du gerade?";
}
function closePing(){ closeScrim("pingScrim"); }

/* ============================================================
   EDIT BLOCK
   ============================================================ */
let editing=null, editRows=[];
export function openEdit(seg){
  editing=seg;
  const blocks=[...seg.blocks].sort((a,b)=>new Date(a.start)-new Date(b.start));
  editing.blocks=blocks;
  const s=new Date(seg.start),e=new Date(seg.end), mins=(e-s)/60000;
  $("editTime").textContent=hhmm(s)+" – "+hhmm(e)+"  ·  "+DOW[s.getDay()]+" "+s.getDate()+". "+MON[s.getMonth()]+
    (blocks.length>1?"  ·  "+fmtDur(mins):"");
  const inp=$("editInput");
  const allSame=blocks.every(b=>b.label===blocks[0].label);
  inp.value=allSame?blocks[0].label:"";
  const chips=$("editChips"); chips.innerHTML="";
  state.recentLabels.slice(0,8).forEach(l=>{
    const c=document.createElement("button"); c.className="chip-b"; c.style.setProperty("--bc",colorFor(l));
    c.textContent=l; c.title=l; c.onclick=()=>{ inp.value=l; }; chips.appendChild(c);
  });

  // Per-slot rows, tucked behind a default-closed disclosure. The top Tätigkeit
  // field is the whole event; splitting it into differently-labelled sub-blocks
  // is the rare case, so we hide the plumbing until the user opts in.
  const slots=$("editSlots"); slots.innerHTML=""; editRows=[];
  const split=$("editSplit");
  if(blocks.length>1){
    split.style.display=""; split.open=false;
    $("editBulkHint").textContent="– gilt für alle "+blocks.length+" Blöcke";
    blocks.forEach(b=>{
      const bs=new Date(b.start),be=new Date(b.end);
      const row=document.createElement("div"); row.className="gaprow";
      const tg=document.createElement("span"); tg.className="tg"; tg.textContent=hhmm(bs)+"–"+hhmm(be);
      const ri=document.createElement("input"); ri.setAttribute("autocomplete","off"); ri.value=b.label;
      const range="("+hhmm(bs)+"–"+hhmm(be)+")";
      const x=document.createElement("button"); x.type="button"; x.className="skip";
      // Reversible clear: toggle the block between active and "wird gelöscht".
      // stash is null until something is actually cleared, so the initial
      // setCleared(false) only sets up the UI and leaves ri.value (the existing
      // label) untouched — clobbering it with "" was the prefill/data-loss bug.
      let stash=null;
      const setCleared=on=>{
        if(on){ stash=ri.value; ri.value=""; ri.placeholder="wird gelöscht"; }
        else { if(stash!==null) ri.value=stash; stash=null; ri.placeholder=""; }
        row.classList.toggle("done",on);
        ri.disabled=on;
        x.textContent=on?"↩":"✕";
        x.title=on?"doch behalten "+range:"diesen Block löschen "+range;
        x.setAttribute("aria-label",(on?"Diesen Block doch behalten ":"Diesen Block löschen ")+range);
        x.setAttribute("aria-pressed",on?"true":"false");
      };
      setCleared(false);
      x.onclick=()=>{ const willClear=!row.classList.contains("done"); setCleared(willClear); if(!willClear) ri.focus(); };
      row.append(tg,ri,x); slots.appendChild(row);
      // `orig` = the label this row started with. A row counts as a deliberate
      // split only if its current value differs from where it started — that
      // keeps "user edited the top field but never touched the rows" out of the
      // per-slot path (the rows still show the old label, but the user didn't
      // touch them, so the top field wins).
      editRows.push({start:b.start,input:ri,orig:b.label});
    });
  } else { split.style.display="none"; split.open=false; $("editBulkHint").textContent=""; }

  openScrim("editScrim"); setTimeout(()=>inp.focus(),60);
}
// Save semantics: the top Tätigkeit field is the whole event, so by default we
// apply its label to every sub-block (the old "für alle" is now the default).
// We only honour the per-slot rows when the user actually changed one away from
// its original label inside the disclosure — that's a deliberate split. If they
// only touched the top field (the rows still show their old labels untouched),
// the top field wins for the whole segment.
$("editSave").onclick=()=>{
  const v=$("editInput").value;
  const splitEdited=editRows.some(r=>r.input.value!==r.orig);
  if(editRows.length && splitEdited){
    editRows.forEach(r=>setBlock(new Date(r.start),r.input.value));
  } else if(editRows.length){
    editRows.forEach(r=>setBlock(new Date(r.start),v));
  } else {
    setBlock(new Date(editing.blocks[0].start),v);
  }
  close("editScrim"); render();
};
$("editDel").onclick=()=>{ editing.blocks.forEach(b=>setBlock(new Date(b.start),""));
  close("editScrim"); render(); toast(editing.blocks.length>1?"Block gelöscht ("+editing.blocks.length+" Einträge)":"Block gelöscht"); };
$("editCancel").onclick=()=>close("editScrim");
$("editInput").addEventListener("keydown",e=>{ if(e.key==="Enter") $("editSave").click(); });

/* ============================================================
   CONFIRM — generic yes/no modal.
   Used for the one destructive case in direct manipulation: a move/resize that
   would FULLY cover (delete) an existing block. Resolves true on confirm, false
   on cancel/backdrop/Esc. Reuses the shared scrim a11y machinery.
   ============================================================ */
export function confirmDialog({ title, sub = '', ok = 'Bestätigen', cancel = 'Abbrechen', danger = true }){
  return new Promise(resolve=>{
    $("confirmTitle").textContent = title;
    $("confirmSub").textContent = sub;
    $("confirmSub").style.display = sub ? '' : 'none';
    const okBtn=$("confirmOk"), cancelBtn=$("confirmCancel");
    okBtn.textContent = ok; cancelBtn.textContent = cancel;
    okBtn.classList.toggle("del", danger); okBtn.classList.toggle("amber", !danger);
    let done=false;
    const finish=(val)=>{
      if(done) return; done=true;
      okBtn.onclick=null; cancelBtn.onclick=null;
      document.removeEventListener("keydown", onKey, true);
      closeScrim("confirmScrim");
      resolve(val);
    };
    const onKey=(e)=>{ if(e.key==="Escape"){ e.stopPropagation(); finish(false); } };
    okBtn.onclick=()=>finish(true);
    cancelBtn.onclick=()=>finish(false);
    // Backdrop click → cancel (the scrim's own pointerdown/click closes the
    // visual scrim; mirror that into a false resolution).
    $("confirmScrim").addEventListener("click", function bg(e){
      if(e.target===$("confirmScrim")){ $("confirmScrim").removeEventListener("click", bg); finish(false); }
    });
    document.addEventListener("keydown", onKey, true);
    openScrim("confirmScrim"); setTimeout(()=>cancelBtn.focus(),60);
  });
}

/* ============================================================
   MODAL / DIALOG a11y: focus trap + inert background + focus restore.
   All scrims open/close through openScrim/closeScrim so the behaviour is
   identical everywhere. Visual/a11y only — does not change WHAT a dialog does.
   ============================================================ */
let _modalOpener=null;
export function openScrims(){ return [...document.querySelectorAll(".scrim.show")]; }
export function focusables(container){
  return [...container.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el=>el.offsetParent!==null || el===document.activeElement);
}
export function openScrim(id){
  const scrim=$(id); if(scrim.classList.contains("show")) return;
  // remember who opened it so we can restore focus on close
  if(!openScrims().length) _modalOpener=document.activeElement;
  scrim.classList.add("show");
  // background out of the a11y tree + tab order while a modal is up
  const app=$("app"); app.setAttribute("aria-hidden","true");
  try{ app.inert=true; }catch(e){}
}
export function closeScrim(id){
  const scrim=$(id); if(!scrim) return;
  scrim.classList.remove("show");
  if(!openScrims().length){
    const app=$("app"); app.removeAttribute("aria-hidden");
    try{ app.inert=false; }catch(e){}
    // Restore focus to the opener. If it's gone/hidden (e.g. a menu item that
    // closed with the menu), fall back to the menu button so focus stays
    // somewhere visible and sensible instead of landing on <body>.
    let target=_modalOpener;
    if(!target || target.offsetParent===null || typeof target.focus!=="function") target=$("menuBtn");
    if(target){ try{ target.focus(); }catch(e){} }
    _modalOpener=null;
  }
}
export function close(id){ closeScrim(id); }
// Trap Tab inside the top-most open dialog.
document.addEventListener("keydown",e=>{
  if(e.key!=="Tab") return;
  const open=openScrims(); if(!open.length) return;
  const modal=open[open.length-1].querySelector(".modal")||open[open.length-1];
  const f=focusables(modal); if(!f.length){ e.preventDefault(); return; }
  const first=f[0], last=f[f.length-1], a=document.activeElement;
  if(!modal.contains(a)){ e.preventDefault(); first.focus(); return; }
  if(e.shiftKey && a===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && a===last){ e.preventDefault(); first.focus(); }
});
