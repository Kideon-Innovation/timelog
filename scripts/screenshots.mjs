// Smoke-test the PWA and capture screenshots for README + manifest.
// Run:  PORT=NNNNN PLAYWRIGHT_MODULE="$(npm root -g)/@playwright/test/index.js" node scripts/screenshots.mjs
const pwModule = process.env.PLAYWRIGHT_MODULE || '@playwright/test';
const pw = await import(pwModule).catch(() => { console.error('Set PLAYWRIGHT_MODULE to global @playwright/test'); process.exit(1); });
const { chromium } = pw.default || pw;
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '30000';
const BASE = `http://127.0.0.1:${PORT}/`;

// Seed realistic local data BEFORE the app boots, contiguously up to "now"
// so there are no open gaps (no catch-up popup) and the calendar looks lived-in.
const seed = `(() => {
  const z = n => String(n).padStart(2,'0');
  const iso = d => d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes())+':00';
  const SLOT = 15;
  const now = new Date();
  const floor = d => { const x=new Date(d); x.setSeconds(0,0); x.setMinutes(Math.floor(x.getMinutes()/SLOT)*SLOT); return x; };
  const start = new Date(now); start.setHours(8,0,0,0);
  const liveEnd = floor(now);
  // run plan: [label, slots] ; '' = leave empty (a real gap)
  const runs = [
    ['Projekt Atlas — Sprint-Planung', 4],
    ['E-Mails', 2],
    ['Projekt Atlas — Feature: Export', 8],
    ['Kaffee', 1],
    ['Code Review', 3],
    ['', 3],                          // lunch gap
    ['Kundencall Kideon', 4],
    ['Projekt Atlas — Bugfix Sync', 6],
    ['Doku schreiben', 3],
    ['Slack & Orga', 2],
    ['Fokuszeit', 8],
  ];
  const blocks = [];
  let t = new Date(start), ri = 0, left = runs.length ? runs[0][1] : 0;
  while (t.getTime() < liveEnd.getTime()) {
    // advance to next run with remaining slots
    while (ri < runs.length && left <= 0) { ri++; left = ri < runs.length ? runs[ri][1] : 0; }
    const label = ri < runs.length ? runs[ri][0] : 'Fokuszeit';
    const end = new Date(Math.min(t.getTime()+SLOT*60000, liveEnd.getTime()));
    if (label) blocks.push({ id:'seed'+blocks.length, start:iso(t), end:iso(end), label });
    t = end; left--;
    if (ri >= runs.length) { /* keep filling tail so last 2h have no gaps */ left = 1; runs.push(['Fokuszeit',1]); ri = runs.length-1; }
  }
  // a few blocks yesterday so the 3-day desktop view isn't empty on the left
  const y = new Date(start); y.setDate(y.getDate()-1);
  [['Workshop',9,6],['Projekt Atlas — Release',11,8],['Mittag',13,2],['Retro',15,3],['E-Mails',16,2]].forEach(([lbl,h,n])=>{
    for(let i=0;i<n;i++){ const s=new Date(y); s.setHours(h,0,0,0); s.setMinutes(i*SLOT);
      const e=new Date(s.getTime()+SLOT*60000); blocks.push({id:'sy'+lbl+i,start:iso(s),end:iso(e),label:lbl}); }
  });
  // a couple of planned items tomorrow so the 3-day view is fully alive
  const tm = new Date(start); tm.setDate(tm.getDate()+1);
  [['Standup',9,1],['Projekt Atlas — Planung Q3',10,6],['1:1 Team',14,2]].forEach(([lbl,h,n])=>{
    for(let i=0;i<n;i++){ const s=new Date(tm); s.setHours(h,0,0,0); s.setMinutes(i*SLOT);
      const e=new Date(s.getTime()+SLOT*60000); blocks.push({id:'st'+lbl+i,start:iso(s),end:iso(e),label:lbl}); }
  });
  const recentLabels = ['Fokuszeit','Projekt Atlas — Bugfix Sync','E-Mails','Code Review','Kundencall Kideon','Doku schreiben'];
  localStorage.setItem('timelog.v1', JSON.stringify({ blocks, recentLabels, settings:{ intervalMin:15, soundOn:false, notifyOn:false, introSeen:true } }));
})();`;

const errors = [];
const browser = await chromium.launch();

async function newCtx(opts){
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') errors.push('['+(opts.label||'')+'] '+m.text()); });
  page.on('pageerror', e => errors.push('['+(opts.label||'')+'] '+e.message));
  return { ctx, page };
}

const shot = (page,name) => page.screenshot({ path: resolve(root,'screenshots',name) });
const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* ---------- desktop ---------- */
{
  const { ctx, page } = await newCtx({ viewport:{width:1440,height:900}, deviceScaleFactor:1, label:'desktop' });
  await page.goto(BASE, { waitUntil:'networkidle' });
  await sleep(700);
  // centre on today by anchoring the 3-day view on yesterday → all columns alive
  await page.evaluate(()=>{ const dp=document.getElementById('datePick');
    const d=new Date(); d.setDate(d.getDate()-1); const z=n=>String(n).padStart(2,'0');
    dp.value=d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());
    dp.dispatchEvent(new Event('change')); });
  await sleep(300);
  // scroll to the morning so blocks are visible. Light is the default theme.
  await page.evaluate(()=>document.getElementById('calWrap').scrollTo({top:9*116-70}));
  await sleep(300);
  await shot(page,'desktop-light.png');

  // ping modal (light)
  await page.evaluate(()=>document.getElementById('logNowBtn').click());
  await sleep(400);
  await shot(page,'desktop-ping.png');
  await page.keyboard.press('Escape');

  // dark theme (themeBtn lives in the overflow menu → toggle programmatically)
  await page.evaluate(()=>document.getElementById('themeBtn').click()); await sleep(300);
  await page.evaluate(()=>document.getElementById('calWrap').scrollTo({top:9*116-70}));
  await sleep(200);
  await shot(page,'desktop-dark.png');

  // PWA assertions
  const checks = await page.evaluate(async ()=>{
    const reg = await navigator.serviceWorker.getRegistration();
    const man = await fetch('manifest.webmanifest').then(r=>r.json());
    return { sw: !!reg, manName: man.name, icons: man.icons.length, display: man.display };
  });
  console.log('PWA checks:', JSON.stringify(checks));
  await ctx.close();
}

/* ---------- mobile ---------- */
{
  const { ctx, page } = await newCtx({ viewport:{width:414,height:896}, deviceScaleFactor:2, isMobile:true, hasTouch:true, label:'mobile' });
  await page.goto(BASE, { waitUntil:'networkidle' });
  await sleep(700);
  await page.evaluate(()=>document.getElementById('calWrap').scrollTo({top:8*116-60}));
  await sleep(300);
  await shot(page,'mobile-light.png');   // light is the default theme

  await page.evaluate(()=>document.getElementById('logNowBtn').click());
  await sleep(400);
  await shot(page,'mobile-ping.png');

  // install help sheet (iOS-style) for showcase
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(()=>document.getElementById('installBtn').click());
  await sleep(300);
  await shot(page,'mobile-install.png');
  await page.keyboard.press('Escape'); await sleep(200);

  // dark theme variant
  await page.evaluate(()=>document.getElementById('themeBtn').click()); await sleep(300);
  await page.evaluate(()=>document.getElementById('calWrap').scrollTo({top:8*116-60}));
  await sleep(200);
  await shot(page,'mobile-dark.png');
  await ctx.close();
}

await browser.close();
if (errors.length){ console.error('CONSOLE ERRORS:\n'+errors.join('\n')); process.exit(2); }
console.log('OK — screenshots written, no console errors.');
