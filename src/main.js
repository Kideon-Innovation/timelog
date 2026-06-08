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
  startOfDay, addDays, iso, hhmm, sameDay,
  minOfDay, minLabel, blockDurMin, fmtDur, esc,
  floorSlot as floorSlotMin, nextBoundary as nextBoundaryMin,
} from './time.js';

// Thin wrappers so the rest of the app keeps calling floorSlot(d) /
// nextBoundary(d) unchanged; they supply the active SLOT_MIN to the pure,
// parameterised implementations in time.js.
const floorSlot = (d) => floorSlotMin(d, SLOT_MIN);
const nextBoundary = (d) => nextBoundaryMin(d, SLOT_MIN);

/* ============================================================
   TimeLog — single-file passive time tracker.  MIT License.
   ============================================================ */

const KEY = "timelog.v1";
const INTERVALS = [60,30,20,15,10,6];   // = 60 / n  (n = 1,2,3,4,6,10)
let SLOT_MIN = 15;                       // active block size, from settings
function colsForViewport(){ return window.matchMedia("(max-width:760px)").matches ? 1 : 3; }
let DAY_COLS = colsForViewport();        // 3 on desktop, 1 on phones
const CATCHUP_CAP_MS = 2 * 60 * 60 * 1000;   // only ask back ~2h
/* Calm, Kideon-harmonious block hues — mid-tone, readable on off-white and navy. */
const PALETTE = ["#c49a6c","#5f8f8c","#c0766a","#6b86b0","#a07fa6",
                 "#8aa173","#c2935a","#5b9aa0","#d0a85c","#9488c0","#c98bab","#79a3c4"];
const HOUR_PX = 116, PX_PER_MIN = HOUR_PX/60;

/* ---------- state ---------- */
let state = load();
SLOT_MIN = INTERVALS.includes(state.settings.intervalMin) ? state.settings.intervalMin : 15;
let anchor = startOfDay(new Date());   // left-most visible day

function load(){
  try{
    const s = JSON.parse(localStorage.getItem(KEY));
    if(s && s.blocks) return Object.assign({blocks:[],recentLabels:[],settings:{}}, s,
      {settings:Object.assign({intervalMin:SLOT_MIN,soundOn:true,notifyOn:false,introSeen:false,notifyNudgeDismissed:false,exportReminderDay:"",exportNotifyDay:"",theme:"light"}, s.settings||{})});
  }catch(e){}
  return {blocks:[], recentLabels:[], settings:{intervalMin:SLOT_MIN,soundOn:true,notifyOn:false,introSeen:false,notifyNudgeDismissed:false,exportReminderDay:"",exportNotifyDay:"",theme:"light"}};
}
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }

/* ---------- time helpers ---------- */
const DOW=["So","Mo","Di","Mi","Do","Fr","Sa"], MON=["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

/* ---------- colors ---------- */
function colorFor(label){
  let h=0; for(let i=0;i<label.length;i++) h=(h*31+label.charCodeAt(i))>>>0;
  return PALETTE[h%PALETTE.length];
}
function tint(hex){ return hex+"3a"; }   // fill alpha

/* ---------- block ops ---------- */
function uid(){ return "b"+Math.floor(performance.now()*1000).toString(36)+Object.keys(state.blocks).length; }
function blockAt(slotStart){
  const t=slotStart.getTime();
  return state.blocks.find(b=>new Date(b.start).getTime()===t);
}
function setBlock(slotStart,label){
  label=label.trim();
  const s=new Date(slotStart), e=new Date(s.getTime()+SLOT_MIN*60000);
  const ex=blockAt(s);
  if(!label){ if(ex) state.blocks=state.blocks.filter(b=>b!==ex); }
  else if(ex){ ex.label=label; }
  else state.blocks.push({id:uid(),start:iso(s),end:iso(e),label});
  if(label) bumpRecent(label);
  save();
}
function bumpRecent(label){
  state.recentLabels = [label, ...state.recentLabels.filter(l=>l!==label)].slice(0,12);
}
function blocksInRange(s,e){
  const S=s.getTime(),E=e.getTime();
  return state.blocks.filter(b=>new Date(b.start).getTime()<E && new Date(b.end).getTime()>S);
}
/* remove everything inside [s,e), clipping blocks that straddle the edges */
function clearRange(s,e){
  const S=s.getTime(),E=e.getTime(), keep=[];
  for(const b of state.blocks){
    const bs=new Date(b.start).getTime(), be=new Date(b.end).getTime();
    if(be<=S||bs>=E){ keep.push(b); continue; }              // no overlap
    if(bs<S) keep.push({...b,id:uid(),end:iso(new Date(S))}); // left remainder
    if(be>E) keep.push({...b,id:uid(),start:iso(new Date(E))}); // right remainder
  }
  state.blocks=keep;
}
/* paint a label across [s,e) as SLOT_MIN blocks, overwriting whatever is there */
function fillRange(s,e,label){
  clearRange(s,e);
  label=label.trim();
  if(label){
    for(let t=new Date(s); t.getTime()<e.getTime(); t=new Date(t.getTime()+SLOT_MIN*60000)){
      const end=new Date(Math.min(t.getTime()+SLOT_MIN*60000, e.getTime()));
      state.blocks.push({id:uid(),start:iso(t),end:iso(end),label});
    }
    bumpRecent(label);
  }
  save();
}
function lastLabel(){
  if(!state.blocks.length) return state.recentLabels[0]||"";
  return [...state.blocks].sort((a,b)=>new Date(b.start)-new Date(a.start))[0].label;
}

/* ============================================================
   HEARTBEAT — passive "machine was alive" log.
   While the tab is visible we stamp the current slot every ~60s.
   Stored as a flat array of slot-ISO strings under its own key
   (kept out of timelog.v1 so it never lands in the Excel export).
   Pruned to the last HEARTBEAT_DAYS days to stay tiny.
   ============================================================ */
const HEARTBEAT_KEY = "timelog.heartbeat.v1";
const HEARTBEAT_DAYS = 7;
let heartbeats = loadHeartbeats();
function loadHeartbeats(){
  try{ const a=JSON.parse(localStorage.getItem(HEARTBEAT_KEY)); if(Array.isArray(a)) return new Set(a); }catch(e){}
  return new Set();
}
function saveHeartbeats(){ localStorage.setItem(HEARTBEAT_KEY, JSON.stringify([...heartbeats])); }
function pruneHeartbeats(){
  const cutoff=Date.now()-HEARTBEAT_DAYS*86400000; let changed=false;
  for(const s of heartbeats){ if(new Date(s).getTime()<cutoff){ heartbeats.delete(s); changed=true; } }
  return changed;
}
/* stamp the current slot as alive; returns true if a new slot was added */
function beat(){
  const key=iso(floorSlot(new Date()));
  const had=heartbeats.has(key);
  heartbeats.add(key);
  const pruned=pruneHeartbeats();
  if(!had||pruned) saveHeartbeats();
  return !had;
}

/* gaps: unfilled past slots within CATCHUP_CAP_MS, oldest-first */
function gapSlots(){
  // Erstnutzer ohne jegliche Tracking-Historie haben keine echte Lücke zum
  // Nachtragen — der Backfill-Dialog soll erst erscheinen, sobald schon mind.
  // ein Eintrag existiert. Ohne diesen Guard würde der gesamte 2h-Zeitraum als
  // Lücke gewertet und ein Neunutzer mit dem Catchup-Dialog konfrontiert.
  if(!state.blocks.length) return [];
  const now=new Date(), out=[];
  let s=floorSlot(new Date(now.getTime()-CATCHUP_CAP_MS));
  const liveEnd=floorSlot(now);   // current (ongoing) slot start = not yet ended
  let lastEnd=null;
  for(const b of state.blocks){
    const e=new Date(b.end);
    if(e.getTime()<=liveEnd.getTime() && (lastEnd===null || e.getTime()>lastEnd)) lastEnd=e.getTime();
  }
  if(lastEnd!==null){
    const fe=floorSlot(new Date(lastEnd));
    if(fe.getTime()>s.getTime()) s=fe;
  }
  for(let t=s; t.getTime()<liveEnd.getTime(); t=new Date(t.getTime()+SLOT_MIN*60000)){
    if(!blockAt(t)) out.push(new Date(t));
  }
  return out;
}

/* ============================================================
   RENDER
   ============================================================ */
const $=id=>document.getElementById(id);

function render(){
  renderHeaderClock();
  renderRange();
  renderLegend();
  renderCalendar();
  renderDatalist();
}

function renderHeaderClock(){
  const n=new Date();
  $("clock").textContent=hhmm(n);
  $("clockDate").textContent=DOW[n.getDay()]+", "+n.getDate()+". "+MON[n.getMonth()];
}

function renderRange(){
  const a=anchor, b=addDays(anchor,DAY_COLS-1);
  if(DAY_COLS===1){
    // Single-day view (mobile): show one dated label with weekday — a dash range
    // ("8. – 8. Jun") reads as a bug.
    $("rangeLabel").innerHTML = DOW[a.getDay()]+", "+a.getDate()+". "+MON[a.getMonth()]+" "+a.getFullYear();
  } else {
    $("rangeLabel").innerHTML = a.getDate()+". "+(a.getMonth()!=b.getMonth()?MON[a.getMonth()]+" ":"")+
      "<em>–</em> "+b.getDate()+". "+MON[b.getMonth()]+" "+b.getFullYear();
  }
  $("datePick").value = iso(a).slice(0,10);
}

function renderLegend(){
  const days=[...Array(DAY_COLS)].map((_,i)=>addDays(anchor,i));
  const labels=new Set();
  state.blocks.forEach(b=>{ const d=new Date(b.start); if(days.some(x=>sameDay(x,d))) labels.add(b.label); });
  const el=$("legend"); el.innerHTML="";
  [...labels].slice(0,8).forEach(l=>{
    const c=document.createElement("span"); c.className="chip";
    c.innerHTML=`<span class="sw" style="background:${colorFor(l)}"></span>${l}`;
    el.appendChild(c);
  });
}

function renderCalendar(){
  const cal=$("cal"); cal.innerHTML="";
  const totalH=24*HOUR_PX;
  const now=new Date();
  const gutPx = DAY_COLS===1 ? 44 : 60;
  cal.style.gridTemplateColumns = gutPx+"px repeat("+DAY_COLS+",1fr)";

  // gutter
  const gut=document.createElement("div"); gut.className="gutter"; gut.style.height=totalH+"px";
  const gh=document.createElement("div"); gh.className="col-head"; gh.style.visibility="hidden"; gh.textContent=".";
  gut.appendChild(gh);
  for(let h=1;h<24;h++){
    const lb=document.createElement("div"); lb.className="hr-label";
    lb.style.top=(h*HOUR_PX)+"px"; lb.textContent=String(h).padStart(2,"0")+":00";
    gut.appendChild(lb);
  }
  cal.appendChild(gut);

  for(let i=0;i<DAY_COLS;i++){
    const day=addDays(anchor,i), isToday=sameDay(day,now);
    const col=document.createElement("div"); col.className="daycol"+(isToday?" today":"");
    col.style.height=totalH+"px";

    const head=document.createElement("div");
    head.className="col-head"+(isToday?" today":"");
    const dayBlocks=state.blocks.filter(b=>sameDay(new Date(b.start),day));
    const mins=dayBlocks.reduce((a,b)=>a+blockDurMin(b),0);
    head.innerHTML=`<div class="dow">${DOW[day.getDay()]}</div><div class="dnum">${day.getDate()}</div>`+
      `<div class="tot">${mins?fmtDur(mins):"–"}</div>`;
    col.appendChild(head);

    // hour lines
    for(let h=0;h<24;h++){
      const ln=document.createElement("div"); ln.className="hr-line"+(h%6===0?" major":"");
      ln.style.top=(h*HOUR_PX)+"px"; col.appendChild(ln);
    }

    // heartbeat rail: faint marks where the machine was alive that day
    beatRuns(day).forEach(run=>{
      const range=minLabel(run.startMin)+"–"+minLabel(run.endMin);
      const b=document.createElement("div"); b.className="beat";
      b.style.top=(run.startMin*PX_PER_MIN)+"px";
      b.style.height=Math.max(2,(run.endMin-run.startMin)*PX_PER_MIN-1)+"px";
      b.setAttribute("role","img");
      b.tabIndex=0; // keyboard-focusable so the custom tooltip shows on focus
      b.setAttribute("aria-label","Aktivitätsspur "+range
        +": in dieser Zeit war TimeLog geöffnet. So siehst du, welche Lücken echte Pausen sind und was du noch nachtragen kannst.");
      // custom instant tooltip — NO native title (which has a ~1s browser delay)
      const tip=document.createElement("div"); tip.className="beat-tip";
      tip.setAttribute("aria-hidden","true");
      const th=document.createElement("span"); th.className="beat-tip-h";
      th.textContent="Aktivitätsspur · "+range;
      tip.appendChild(th);
      tip.appendChild(document.createTextNode(
        "In dieser Zeit war TimeLog geöffnet — hilft dir zu sehen, welche Lücken echte Pausen sind und was du noch nachtragen kannst. Bleibt nur auf diesem Gerät."));
      b.appendChild(tip);
      col.appendChild(b);
    });

    // current-slot highlight + now line
    if(isToday){
      const ss=floorSlot(now);
      const ns=document.createElement("div"); ns.className="nowslot";
      ns.style.top=(minOfDay(ss)*PX_PER_MIN)+"px"; ns.style.height=(SLOT_MIN*PX_PER_MIN)+"px";
      col.appendChild(ns);
      const nl=document.createElement("div"); nl.className="nowline";
      nl.style.top=(minOfDay(now)*PX_PER_MIN)+"px"; col.appendChild(nl);
    }

    // blocks — contiguous same-label slots merge into one long block
    mergeRuns(dayBlocks).forEach(seg=>{
      const s=new Date(seg.start), e=new Date(seg.end);
      const mins=(e-s)/60000;
      const el=document.createElement("div"); el.className="block";
      const c=colorFor(seg.label);
      el.style.setProperty("--bc",c); el.style.setProperty("--bg2",tint(c));
      el.style.top=(minOfDay(s)*PX_PER_MIN)+"px"; el.style.height=Math.max(11,mins*PX_PER_MIN-3)+"px";
      const range = seg.blocks.length>1 ? hhmm(s)+"–"+hhmm(e)+" · "+fmtDur(mins) : hhmm(s);
      el.innerHTML=`<div class="lbl">${esc(seg.label)}</div><div class="tm">${range}</div>`;
      el.title=seg.label+"  ("+hhmm(s)+"–"+hhmm(e)+", "+fmtDur(mins)+")";
      el.onclick=()=>openEdit(seg);
      col.appendChild(el);
    });

    if(!dayBlocks.length){
      // Empty day → onboarding hint. Today gets a slightly warmer welcome so a
      // new user landing on a blank "today" isn't left without guidance.
      const eh=document.createElement("div"); eh.className="empty-hint";
      eh.innerHTML = isToday
        ? `<div class="em">Noch nichts erfasst</div><div class="empty-sub">ziehen zum Eintragen · oder „+ Jetzt eintragen"</div>`
        : `<div class="em">ziehen zum Eintragen</div>`;
      col.appendChild(eh);
    }
    attachDrag(col,day);
    cal.appendChild(col);
  }
}
function mergeRuns(blocks){
  const sorted=[...blocks].sort((a,b)=>new Date(a.start)-new Date(b.start));
  const segs=[];
  for(const b of sorted){
    const last=segs[segs.length-1];
    if(last && last.label===b.label && new Date(last.end).getTime()===new Date(b.start).getTime()){
      last.end=b.end; last.blocks.push(b);
    } else segs.push({start:b.start,end:b.end,label:b.label,blocks:[b]});
  }
  return segs;
}
/* heartbeat slots for one day → merged [startMin,endMin) runs.
   Each beat covers SLOT_MIN minutes; touching/overlapping beats merge. */
function beatRuns(day){
  const mins=[];
  for(const s of heartbeats){ const d=new Date(s); if(sameDay(d,day)) mins.push(minOfDay(d)); }
  if(!mins.length) return [];
  mins.sort((a,b)=>a-b);
  const runs=[];
  for(const m of mins){
    const last=runs[runs.length-1];
    if(last && m<=last.endMin) last.endMin=Math.max(last.endMin,m+SLOT_MIN);
    else runs.push({startMin:m,endMin:m+SLOT_MIN});
  }
  return runs;
}

function renderDatalist(){
  $("labelList").innerHTML=state.recentLabels.map(l=>`<option value="${esc(l)}">`).join("");
}

/* ============================================================
   PING / CATCH-UP
   ============================================================ */
function recentChips(onPick, current){
  const wrap=document.createElement("div"); wrap.className="chips";
  const last=lastLabel();
  if(last){
    const b=document.createElement("button"); b.className="chip-b same";
    b.textContent="↻ Weiter wie eben — "+last;
    b.onclick=()=>onPick(last); wrap.appendChild(b);
  }
  state.recentLabels.filter(l=>l!==last).slice(0,8).forEach(l=>{
    const b=document.createElement("button"); b.className="chip-b";
    b.style.setProperty("--bc",colorFor(l)); b.textContent=l;
    b.onclick=()=>onPick(l); wrap.appendChild(b);
  });
  return wrap;
}

function openPing(triggeredByTimer){
  const gaps=gapSlots();
  if(!gaps.length){ if(!triggeredByTimer) openLogNow(); return; }
  if(gaps.length===1) openSinglePing(gaps[0]);
  else openCatchup(gaps);
  openScrim("pingScrim");
}

function openSinglePing(slot){
  const end=new Date(slot.getTime()+SLOT_MIN*60000);
  $("pingKick").textContent="15-MINUTEN-PING";
  $("pingTitle").textContent="Woran hast du gearbeitet?";
  $("pingSub").textContent=hhmm(slot)+" – "+hhmm(end)+" · "+DOW[slot.getDay()]+" "+slot.getDate()+". "+MON[slot.getMonth()];
  const body=$("pingBody"); body.innerHTML="";
  const inp=document.createElement("input");
  inp.className="txt"; inp.setAttribute("list","labelList"); inp.setAttribute("autocomplete","off");
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
    const end=new Date(slot.getTime()+SLOT_MIN*60000);
    const row=document.createElement("div"); row.className="gaprow";
    const tg=document.createElement("span"); tg.className="tg"; tg.textContent=hhmm(slot)+"–"+hhmm(end);
    const inp=document.createElement("input"); inp.setAttribute("list","labelList"); inp.setAttribute("autocomplete","off");
    inp.placeholder="Stichwort …";
    const skip=document.createElement("button"); skip.type="button"; skip.className="skip"; skip.textContent="✕";
    skip.title="leer lassen"; skip.setAttribute("aria-label","Diesen Eintrag leer lassen ("+hhmm(slot)+"–"+hhmm(end)+")");
    skip.onclick=()=>{ inp.value=""; row.classList.add("done"); };
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

/* ---------- drag-to-select (Pointer Events: mouse drag, touch long-press) ----------
   Mouse/pen: press-drag selects immediately, like Google Calendar.
   Touch: a plain tap quick-logs one slot; a long-press (~260ms) then drag
   selects a range — so normal vertical scrolling of the calendar still works. */
function attachDrag(col,day){
  col.addEventListener("pointerdown",e=>{
    if(e.button>0) return;                                    // ignore right/middle
    if(e.target.closest(".block")||e.target.closest(".col-head")) return;
    const rect=col.getBoundingClientRect();
    const slotPx=SLOT_MIN*PX_PER_MIN, maxIdx=Math.floor(1440/SLOT_MIN)-1;
    const idxAt=cy=>Math.max(0,Math.min(maxIdx,Math.floor((cy-rect.top)/slotPx)));
    const startIdx=idxAt(e.clientY), startY=e.clientY, startX=e.clientX;
    const touch=e.pointerType==="touch";
    const slotTime=i=>{ const d=new Date(day); d.setMinutes(i*SLOT_MIN); return d; };
    let selecting=false, holdTimer=null, box=null, lbl=null, tm=null;

    const draw=cur=>{
      const lo=Math.min(startIdx,cur),hi=Math.max(startIdx,cur);
      box.style.top=(lo*slotPx)+"px"; box.style.height=((hi-lo+1)*slotPx)+"px";
      tm.textContent=hhmm(slotTime(lo))+"–"+hhmm(slotTime(hi+1))+" · "+fmtDur((hi-lo+1)*SLOT_MIN);
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

function openRangeEntry(s,e){
  const mins=(e-s)/60000;
  const existing=blocksInRange(s,e);
  const existLabels=[...new Set(existing.map(b=>b.label))];
  $("pingKick").textContent="ZEITRAUM EINTRAGEN";
  $("pingTitle").textContent="Was läuft in diesem Block?";
  $("pingSub").textContent=hhmm(s)+" – "+hhmm(e)+" · "+fmtDur(mins)+" · "+DOW[s.getDay()]+" "+s.getDate()+". "+MON[s.getMonth()];
  const body=$("pingBody"); body.innerHTML="";
  const inp=document.createElement("input"); inp.className="txt"; inp.setAttribute("list","labelList"); inp.setAttribute("autocomplete","off");
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

function openLogNow(){
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
function openEdit(seg){
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
    c.textContent=l; c.onclick=()=>{ inp.value=l; }; chips.appendChild(c);
  });

  // per-slot rows (only when the block spans more than one slot)
  const slots=$("editSlots"); slots.innerHTML=""; editRows=[];
  if(blocks.length>1){
    $("editAll").style.display=""; $("editBulkHint").textContent="– setzt alle "+blocks.length+" Blöcke";
    const lab=document.createElement("label"); lab.className="fl"; lab.textContent="Einzelne Blöcke"; slots.appendChild(lab);
    blocks.forEach(b=>{
      const bs=new Date(b.start),be=new Date(b.end);
      const row=document.createElement("div"); row.className="gaprow";
      const tg=document.createElement("span"); tg.className="tg"; tg.textContent=hhmm(bs)+"–"+hhmm(be);
      const ri=document.createElement("input"); ri.setAttribute("list","labelList"); ri.setAttribute("autocomplete","off"); ri.value=b.label;
      const x=document.createElement("button"); x.type="button"; x.className="skip"; x.textContent="✕";
      x.title="diesen Block löschen"; x.setAttribute("aria-label","Diesen Block löschen ("+hhmm(bs)+"–"+hhmm(be)+")");
      x.onclick=()=>{ ri.value=""; row.classList.add("done"); };
      ri.addEventListener("input",()=>row.classList.remove("done"));
      row.append(tg,ri,x); slots.appendChild(row);
      editRows.push({start:b.start,input:ri});
    });
  } else { $("editAll").style.display="none"; $("editBulkHint").textContent=""; }

  openScrim("editScrim"); setTimeout(()=>inp.focus(),60);
}
$("editAll").onclick=()=>{ editRows.forEach(r=>{ r.input.value=$("editInput").value; r.input.parentElement.classList.remove("done"); }); };
$("editSave").onclick=()=>{
  if(editRows.length) editRows.forEach(r=>setBlock(new Date(r.start),r.input.value));
  else setBlock(new Date(editing.blocks[0].start),$("editInput").value);
  close("editScrim"); render();
};
$("editDel").onclick=()=>{ editing.blocks.forEach(b=>setBlock(new Date(b.start),""));
  close("editScrim"); render(); toast(editing.blocks.length>1?"Block gelöscht ("+editing.blocks.length+" Einträge)":"Block gelöscht"); };
$("editCancel").onclick=()=>close("editScrim");
$("editInput").addEventListener("keydown",e=>{ if(e.key==="Enter") $("editSave").click(); });

/* ============================================================
   MODAL / DIALOG a11y: focus trap + inert background + focus restore.
   All scrims open/close through openScrim/closeScrim so the behaviour is
   identical everywhere. Visual/a11y only — does not change WHAT a dialog does.
   ============================================================ */
let _modalOpener=null;
function openScrims(){ return [...document.querySelectorAll(".scrim.show")]; }
function focusables(container){
  return [...container.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el=>el.offsetParent!==null || el===document.activeElement);
}
function openScrim(id){
  const scrim=$(id); if(scrim.classList.contains("show")) return;
  // remember who opened it so we can restore focus on close
  if(!openScrims().length) _modalOpener=document.activeElement;
  scrim.classList.add("show");
  // background out of the a11y tree + tab order while a modal is up
  const app=$("app"); app.setAttribute("aria-hidden","true");
  try{ app.inert=true; }catch(e){}
}
function closeScrim(id){
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
function close(id){ closeScrim(id); }
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

/* ============================================================
   EXPORT (xlsx via SheetJS)
   ============================================================ */
function exportRows(){
  let from=$("expFrom").value?new Date($("expFrom").value+"T00:00:00"):null;
  let to=$("expTo").value?new Date($("expTo").value+"T23:59:59"):null;
  return [...state.blocks].sort((a,b)=>new Date(a.start)-new Date(b.start))
    .filter(b=>{ const s=new Date(b.start); return (!from||s>=from)&&(!to||s<=to); });
}
function updateExpCount(){ $("expCount").textContent=exportRows().length+" Blöcke im Zeitraum"; }
function doExport(){
  if(typeof XLSX==="undefined"){ toast("Excel-Funktion gerade nicht verfügbar"); return; }
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
   IMPORT (xlsx via SheetJS) — round-trips the export format.
   Reads Datum / Start / Ende / Tätigkeit; Wochentag + Dauer ignored.
   Conflict policy: slot-overwrite (imported block wins on equal start).
   ============================================================ */
function parseDE(v){ const m=String(v||"").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? {d:+m[1],m:+m[2],y:+m[3]} : null; }
function parseHM(v){ const m=String(v||"").trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? {h:+m[1],min:+m[2]} : null; }

function importXlsx(file){
  if(typeof XLSX==="undefined"){ toast("Excel-Funktion gerade nicht verfügbar"); return; }
  const reader=new FileReader();
  reader.onerror=()=>toast("Datei konnte nicht gelesen werden");
  reader.onload=ev=>{
    let rows;
    try{
      const wb=XLSX.read(ev.target.result,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false});
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
    const t=new Date(b.start).getTime();
    state.blocks=state.blocks.filter(x=>new Date(x.start).getTime()!==t); // slot-overwrite
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
function tickClock(){ renderHeaderClock(); updateCountdown(); updateNowLine(); }
function updateNowLine(){
  // cheap: only reposition existing now elements
  const now=new Date();
  document.querySelectorAll(".nowline").forEach(n=>n.style.top=(minOfDay(now)*PX_PER_MIN)+"px");
}
function updateCountdown(){
  const now=Date.now(), nb=nextBoundary(new Date()).getTime();
  const remain=Math.max(0,nb-now), total=SLOT_MIN*60000;
  const mm=Math.floor(remain/60000), ss=Math.floor(remain%60000/1000);
  $("cdTime").textContent=String(mm).padStart(2,"0")+":"+String(ss).padStart(2,"0");
  $("ringTxt").textContent=mm;
  const frac=remain/total, circ=2*Math.PI*16;
  const prog=$("ringProg"); prog.setAttribute("stroke-dasharray",circ.toFixed(1));
  prog.setAttribute("stroke-dashoffset",(circ*(1-frac)).toFixed(1));
}

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
function refreshExportReminder(){
  const show = exportOverdue()
            && state.settings.exportReminderDay !== todayKey()
            && !$("intro").classList.contains("show");
  $("exportNudge").hidden = !show;
  if(show){
    const d=daysSinceExport();
    $("exportNudgeTxt").innerHTML =
      "Seit <b>"+d+" Tagen</b> kein Excel-Export — lad deine Daten als Excel runter, "
      + "damit nichts verloren geht. Sie liegen nur auf diesem Gerät.";
    notifyExportOverdue(d);
  }
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
$("prevBtn").onclick=()=>{ anchor=addDays(anchor,-DAY_COLS); render(); };
$("nextBtn").onclick=()=>{ anchor=addDays(anchor,DAY_COLS); render(); };
$("todayBtn").onclick=()=>{ anchor=startOfDay(new Date()); render(); scrollToNow(); };
$("datePick").onchange=e=>{ if(e.target.value){ anchor=startOfDay(new Date(e.target.value+"T00:00:00")); render(); } };
$("logNowBtn").onclick=()=>openLogNow();
$("exportBtn").onclick=()=>{ updateExpCount(); openScrim("exportScrim"); };
$("expCancel").onclick=()=>close("exportScrim");
$("expAll").onclick=()=>{ $("expFrom").value=""; $("expTo").value=""; updateExpCount(); };
$("expGo").onclick=doExport;
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
function showIntro(){ $("intro").classList.add("show"); $("intro").setAttribute("aria-hidden","false"); $("intro").scrollTop=0; armIntroDemo(); }
function hideIntro(){ $("intro").classList.remove("show"); $("intro").setAttribute("aria-hidden","true"); }

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
  const c=colsForViewport(); if(c!==DAY_COLS){ DAY_COLS=c; render(); }
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
  $("themeBtn").textContent=dark?"🌙 Theme":"☀️ Theme";
  $("themeBtn").setAttribute("aria-pressed", dark?"true":"false");
  // tint the OS status bar / window chrome to match the app
  const meta=$("metaTheme"); if(meta) meta.setAttribute("content", dark?"#0f2137":"#faf9f7");
}
$("themeBtn").onclick=()=>{ state.settings.theme=(state.settings.theme==="light")?"dark":"light"; save(); applyTheme(); };

function initInterval(){
  const sel=$("intervalSel");
  sel.innerHTML=INTERVALS.map(m=>`<option value="${m}">${m} min</option>`).join("");
  sel.value=String(SLOT_MIN);
  sel.onchange=()=>{
    SLOT_MIN=parseInt(sel.value,10);
    state.settings.intervalMin=SLOT_MIN; save();
    lastFired=floorSlot(new Date()).getTime();
    render(); updateCountdown();
    toast("Blockgröße: "+SLOT_MIN+" min");
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
  const show = supported && !notifyGranted() && !state.settings.notifyNudgeDismissed
            && !$("intro").classList.contains("show");
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

function scrollToNow(){
  const y=minOfDay(new Date())*PX_PER_MIN - 200;
  $("calWrap").scrollTo({top:Math.max(0,y),behavior:"smooth"});
}

/* ---------- boot ---------- */
function boot(){
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
