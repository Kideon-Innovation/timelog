// Block / domain data layer — the pure, DOM-free logic that reads and mutates
// the persisted block list (and the separate heartbeat store). Extracted from
// main.js so the data model is testable in isolation (Node's test runner, no
// browser) and main.js shrinks toward a thin DOM/render/event layer.
//
// DEPENDENCY CONTRACT (keep this true):
//   * This module imports ONLY from ./state.js (state, save, config consts,
//     the active block-size accessor) and ./time.js (pure date helpers). It
//     must never touch the DOM — anything that reads `document`/elements stays
//     in main.js. That is the whole point of the split: this layer is provably
//     side-effect-free except for `state` mutation + localStorage persistence.
//
//   * `state` is mutated by reference (state.blocks.push(...), state.blocks =
//     keep, ...) — never reassign the imported `state` binding. This matches
//     the sharing contract documented in state.js.
//
//   * floorSlot/nextBoundary in time.js are parameterised on the active block
//     size; the thin wrappers below supply it via getSlotMin() so callers keep
//     the same 1-arg signature the inline originals had.

import {
  state, save, PALETTE, CATCHUP_CAP_MS, getSlotMin,
} from './state.js';
import {
  iso, sameDay, minOfDay,
  floorSlot as floorSlotMin,
} from './time.js';

const floorSlot = (d) => floorSlotMin(d, getSlotMin());

/* ---------- colors ---------- */
export function colorFor(label){
  let h=0; for(let i=0;i<label.length;i++) h=(h*31+label.charCodeAt(i))>>>0;
  return PALETTE[h%PALETTE.length];
}
export function tint(hex){ return hex+"3a"; }   // fill alpha

/* ---------- block ops ---------- */
export function uid(){ return "b"+Math.floor(performance.now()*1000).toString(36)+Object.keys(state.blocks).length; }
export function blockAt(slotStart){
  const t=slotStart.getTime();
  return state.blocks.find(b=>new Date(b.start).getTime()===t);
}
export function setBlock(slotStart,label){
  label=label.trim();
  const s=new Date(slotStart), e=new Date(s.getTime()+getSlotMin()*60000);
  const ex=blockAt(s);
  if(!label){ if(ex) state.blocks=state.blocks.filter(b=>b!==ex); }
  else if(ex){ ex.label=label; }
  else state.blocks.push({id:uid(),start:iso(s),end:iso(e),label});
  if(label) bumpRecent(label);
  save();
}
export function bumpRecent(label){
  state.recentLabels = [label, ...state.recentLabels.filter(l=>l!==label)].slice(0,12);
}
export function blocksInRange(s,e){
  const S=s.getTime(),E=e.getTime();
  return state.blocks.filter(b=>new Date(b.start).getTime()<E && new Date(b.end).getTime()>S);
}
/* remove everything inside [s,e), clipping blocks that straddle the edges */
export function clearRange(s,e){
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
export function fillRange(s,e,label){
  clearRange(s,e);
  label=label.trim();
  if(label){
    for(let t=new Date(s); t.getTime()<e.getTime(); t=new Date(t.getTime()+getSlotMin()*60000)){
      const end=new Date(Math.min(t.getTime()+getSlotMin()*60000, e.getTime()));
      state.blocks.push({id:uid(),start:iso(t),end:iso(end),label});
    }
    bumpRecent(label);
  }
  save();
}
export function lastLabel(){
  if(!state.blocks.length) return state.recentLabels[0]||"";
  return [...state.blocks].sort((a,b)=>new Date(b.start)-new Date(a.start))[0].label;
}

/* ---------- direct-manipulation move / resize (Google-Calendar style) ----------
   A rendered segment (from mergeRuns) maps to a contiguous run of slot-blocks
   sharing one label. Moving or resizing it re-targets that run onto a NEW
   [start,end) range. These helpers are pure data ops on state.blocks so the
   gesture layer (drag.js) stays DOM-only and the math is unit-testable. */

/** The slot-blocks that make up one rendered segment, keyed by start timestamp.
    Start time is always present and unique per slot, so this stays correct even
    for id-less blocks (e.g. imported/seeded data) where matching on `id` —
    possibly undefined for several blocks at once — would collide. */
function segKeys(seg){ return new Set(seg.blocks.map(b=>new Date(b.start).getTime())); }
function isOwn(own,b){ return own.has(new Date(b.start).getTime()); }

/** Neighbour ENTRIES (merged same-label runs, excluding the segment itself) that
    overlap [s,e), split into the ones a move/resize would FULLY consume (every
    slot of that entry is inside the range → the whole entry gets deleted) vs
    those only PARTIALLY trimmed (some slots survive). Classifying at the entry
    level — not per 15-min slot — is what makes "covers part of a 2h block" a
    silent trim while "covers a whole entry" is the one case that asks to
    confirm. `full`/`partial` each carry the entry's representative blocks for
    the live highlight + the confirm label. */
export function overlapVictims(seg, s, e){
  const S=s.getTime(), E=e.getTime(), own=segKeys(seg);
  // everything that isn't the dragged segment, merged into entries
  const others = state.blocks.filter(b=>!isOwn(own,b));
  const full=[], partial=[];
  for(const run of mergeRuns(others)){
    const rs=new Date(run.start).getTime(), re=new Date(run.end).getTime();
    if(re<=S || rs>=E) continue;                    // no overlap with the new range
    if(rs>=S && re<=E) full.push(run);              // whole entry inside → deleted
    else partial.push(run);                         // some slots survive → trimmed
  }
  return {full,partial};
}

/** Move/resize a segment onto [s,e): trim/delete overlapped neighbours (same
    clip semantics as clearRange), drop the segment's old slot-blocks, then
    repaint the label across the new range as slot-blocks. Returns a restore()
    thunk that reverts state.blocks to its exact prior contents (undo). */
export function applySegmentRange(seg, s, e, label){
  const before=state.blocks.map(b=>({...b}));       // snapshot for undo
  const own=segKeys(seg);
  // 1. drop the segment's own original slot-blocks FIRST, so clearRange's
  //    straddle-clipping can't accidentally split one of them (and so a move
  //    that overlaps the segment's OLD footprint can't leave a stale remnant).
  state.blocks=state.blocks.filter(b=>!isOwn(own,b));
  // 2. trim/remove the OTHER neighbours under the new range (clips straddlers)
  clearRange(s,e);
  // 3. repaint the label across the new range as slot-blocks
  for(let t=new Date(s); t.getTime()<e.getTime(); t=new Date(t.getTime()+getSlotMin()*60000)){
    const end=new Date(Math.min(t.getTime()+getSlotMin()*60000, e.getTime()));
    state.blocks.push({id:uid(),start:iso(t),end:iso(end),label});
  }
  bumpRecent(label);
  save();
  return ()=>{ state.blocks=before.map(b=>({...b})); save(); };
}

export function mergeRuns(blocks){
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

/* ============================================================
   HEARTBEAT — passive "machine was alive" log.
   A flat Set of slot-ISO strings under its own localStorage key (kept out of
   timelog.v1 so it never lands in the Excel export). Pruned to the last
   HEARTBEAT_DAYS days to stay tiny. Pure data — the render/visibility wiring
   that *calls* beat()/beatRuns() stays in main.js.
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
export function beat(){
  const key=iso(floorSlot(new Date()));
  const had=heartbeats.has(key);
  heartbeats.add(key);
  const pruned=pruneHeartbeats();
  if(!had||pruned) saveHeartbeats();
  return !had;
}

/* gaps: unfilled past slots within CATCHUP_CAP_MS, oldest-first */
export function gapSlots(){
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
  for(let t=s; t.getTime()<liveEnd.getTime(); t=new Date(t.getTime()+getSlotMin()*60000)){
    if(!blockAt(t)) out.push(new Date(t));
  }
  return out;
}

/* heartbeat slots for one day → merged [startMin,endMin) runs.
   Each beat covers SLOT_MIN minutes; touching/overlapping beats merge. */
export function beatRuns(day){
  const mins=[];
  for(const s of heartbeats){ const d=new Date(s); if(sameDay(d,day)) mins.push(minOfDay(d)); }
  if(!mins.length) return [];
  mins.sort((a,b)=>a-b);
  const runs=[];
  for(const m of mins){
    const last=runs[runs.length-1];
    if(last && m<=last.endMin) last.endMin=Math.max(last.endMin,m+getSlotMin());
    else runs.push({startMin:m,endMin:m+getSlotMin()});
  }
  return runs;
}
