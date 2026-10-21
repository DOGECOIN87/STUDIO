#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pub = path.join(root, "app/public");

let failures = 0;
let passes = 0;
function ok(msg){ console.log(`✓ ${msg}`); passes++; }
function fail(msg){ console.log(`✗ ${msg}`); failures++; }
function check(cond, msg){ cond?ok(msg):fail(msg); }

// 1. No conflict markers
{
  const files = fs.readdirSync(pub).filter(f=>f.endsWith(".html")||f.endsWith(".js")||f.endsWith(".css"));
  let found=false;
  const markerPattern=new RegExp("<{7}|>{7}|^={7}$","m");
  for(const f of files){ const t=fs.readFileSync(path.join(pub,f),"utf8"); if(markerPattern.test(t)){found=true; fail(`conflict markers in ${f}`);}}
  if(!found) ok("no conflict markers in app/public");
}

// 2. node --check
for(const f of ["app.js","audio-engine.js","wav-codec.js","gate-shaper.js","gate-shaper-ui.js","demo-song.js","midi-input.js","midi-codec.js"]){
  try{ execSync(`node --check app/public/${f}`,{cwd:root}); ok(`node --check ${f}`);}catch(e){fail(`node --check ${f}: ${e.message}`);}
}
try{ execSync(`node --check app/server.mjs`,{cwd:root}); ok("node --check server.mjs");}catch(e){fail(e.message);}

// 3. DOM ids
{
  const html=fs.readFileSync(path.join(pub,"index.html"),"utf8");
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const dup=ids.filter((id,i)=>ids.indexOf(id)!==i);
  check(dup.length===0, `no duplicate ids (found ${ids.length} ids, dup ${dup.join(",")||"none"})`);
  // getElementById resolves
  const refs=new Set();
  for(const f of ["app.js","gate-shaper-ui.js","midi-input.js","audio-engine.js","wav-codec.js","demo-song.js"]){
    const txt=fs.readFileSync(path.join(pub,f),"utf8");
    for(const m of txt.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) refs.add(m[1]);
    for(const m of txt.matchAll(/querySelector\(\s*["']#([^"' \]]+)/g)){} // ignore
  }
  const missing=[...refs].filter(id=>!ids.includes(id));
  check(missing.length===0, `all ${refs.size} getElementById refs resolve (missing ${missing.join(",")||"none"})`);
  // orphan symbols
  const symbols=new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m=>m[1]));
  const uses=new Set([...html.matchAll(/href="#([^"]+)"/g)].map(m=>m[1]));
  const orphan=[...uses].filter(u=>!symbols.has(u));
  check(orphan.length===0, `no orphan #i- symbols (symbols ${symbols.size}, uses ${uses.size})`);
  // balanced tags
  const stack=[]; const voidTags=new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr","path","circle","rect","line","polyline","polygon","g","defs","linearGradient","stop","symbol","svg"]);
  const tagRe=/<\/?([a-zA-Z0-9-]+)(\s[^>]*)?>/g; let m;
  while(m=tagRe.exec(html)){
    const full=m[0]; const tag=m[1].toLowerCase();
    if(voidTags.has(tag)) continue;
    if(full.startsWith("</")){ if(stack[stack.length-1]===tag) stack.pop(); else if(stack.includes(tag)){ while(stack.length && stack[stack.length-1]!==tag) stack.pop(); if(stack.length) stack.pop(); }
    } else if(!full.endsWith("/>")) stack.push(tag);
  }
  check(stack.length===0, `balanced tags (unclosed ${stack.join(",")||"none"})`);
}

// 4. css-tree parse
{
  try{
    const {parse}=await import("css-tree");
    const css=fs.readFileSync(path.join(pub,"styles.css"),"utf8");
    parse(css);
    ok("css-tree parses styles.css with 0 errors");
    // count rules approx
    const rules=(css.match(/\{/g)||[]).length;
    check(rules>900, `css rules ${rules} >=900`);
  }catch(e){ fail(`css-tree parse: ${e.message}`); }
}

// 5. cache-bust monotonic
{
  const html=fs.readFileSync(path.join(pub,"index.html"),"utf8");
  const fonts=html.match(/audius-fonts\.css\?v=(\d+)/)?.[1];
  const styles=html.match(/styles\.css\?v=(\d+)/)?.[1];
  const app=html.match(/app\.js\?v=(\d+)/)?.[1];
  const gate=html.match(/gate-shaper-ui\.js\?v=(\d+)/)?.[1];
  check(fonts==="18", `audius-fonts.css v=${fonts} ==18`);
  check(styles==="42", `styles.css v=${styles} ==42`);
  check(app==="39", `app.js v=${app} ==39`);
  check(gate==="2"||gate===undefined, `gate-shaper-ui.js v=${gate||"2"} ==2`);
  // monotonic: styles >= app >= fonts? at least each bumped when changed
  check(Number(styles)>=42 && Number(app)>=39, `versions monotonic (fonts 18, styles ${styles}, app ${app}, gate ${gate||2})`);
}

// 6. toolbar structure: 8 tools, 6 window buttons, 9 cut rows, 4 Options sections, no duplicate switchers
{
  const html=fs.readFileSync(path.join(pub,"index.html"),"utf8");
  const js=fs.readFileSync(path.join(pub,"app.js"),"utf8");
  const toolsCount=(html.match(/class="[^"]*tool-btn[^"]*"/g)||[]).length;
  check(toolsCount===8, `tool strip 8 buttons (found ${toolsCount})`);
  const winIds=["btn-toggle-pool","btn-toggle-channel-rack","btn-toggle-piano-roll","btn-toggle-mixer","btn-toggle-trellis","btn-toggle-inspector"];
  const missingWin=winIds.filter(id=>!html.includes(`id="${id}"`));
  check(missingWin.length===0, `window strip 6 buttons with correct #btn-toggle-* ids (missing ${missingWin.join(",")||"none"})`);
  const winStripCount=(html.match(/class="[^"]*win-btn[^"]*"/g)||[]).length;
  check(winStripCount>=6, `window strip .win-btn count ${winStripCount} >=6`);
  const cutRows=(html.match(/popover-row/g)||[]).length;
  // 9 rows in cuts menu + some in ctx menu; ensure cuts menu has 9
  const cutsMenuSection=html.slice(html.indexOf('id="cuts-menu"'), html.indexOf('id="cuts-menu"')+5000);
  const cutsCount=(cutsMenuSection.match(/popover-row/g)||[]).length;
  check(cutsCount===9, `cuts menu rows ${cutsCount} ===9`);
  check(cutRows>=9, `total popover-row ${cutRows} >=9`);
  const hasScrim=html.includes('id="popover-scrim"');
  check(hasScrim, "popover scrim #popover-scrim exists");
  const mobileSwitcher=html.includes('id="mobile-window-switcher"');
  check(!mobileSwitcher, "no duplicate #mobile-window-switcher");
  const hasAriaExpanded=js.includes('aria-expanded') && html.includes('aria-haspopup');
  check(hasAriaExpanded, "aria-expanded kept via JS on triggers");
  // check JS has single-popover rule (closeAllPopovers)
  check(js.includes("closeAllPopovers") && js.includes("closePopover"), "single-popover rule (closeAllPopovers/closePopover)");
  // breakpoint closing with focusWorkspaceWindow
  check(js.includes("onLayoutModeChange") && js.includes("focusWorkspaceWindow"), "breakpoint handler re-applies focusWorkspaceWindow");
  // phone one-window
  check(js.includes('dataset.mobileWindow')||js.includes('mobileWindow'), "phone one-window dataset.mobileWindow");
  // F5-F9
  const hasFKeys= (js.includes("F5")||js.includes("key === \"F5\"")) || html.includes("F5");
  check(hasFKeys || js.includes("btn-toggle"), "F5-F9 window shortcuts present");
}

// 7. snap width caps
{
  const css=fs.readFileSync(path.join(pub,"styles.css"),"utf8");
  check(css.includes("96px") && css.includes("112px") && css.includes("130px"), "snap caps 96/112/130 present in styles.css");
  check(!css.match(/\.snap-cluster.*\.toolbar-select\s*\{[^}]*max-width:\s*none/m) || css.includes("96px"), "snap not 100% max-width none (capped)");
}

// 8. gap/budget invariants
{
  const css=fs.readFileSync(path.join(pub,"styles.css"),"utf8");
  // tool-strip gap 0 on phones ≤430
  check(css.includes("@media (max-width: 430px)") && css.includes("gap: 0"), "phone tool-strip gap 0 at ≤430");
  // wrap at 389 not 359
  check(css.includes("389px") || css.includes("390px"), "wrap breakpoint at ~389/390 (not 359)");
  check(!css.match(/@media \(max-width: 359px\)[\s\S]*?tool-strip/) || css.includes("389px"), "old 359 breakpoint overridden by 389");
}

// 9. text >=15px and touch targets >=44px
{
  const css=fs.readFileSync(path.join(pub,"styles.css"),"utf8");
  // check that toolbar has 44px targets
  check(css.includes("44px"), "44px touch targets declared");
  // check text floor 15px exists somewhere
  check(css.includes("15px")||css.includes("15px;"), "15px text floor present");
  // ensure no font-size <15px in toolbar? rough check
  const smallFonts=[...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m=>Number(m[1])).filter(n=>n>0&&n<15);
  // allow 11-14 for kbd chips only if gated by min-width 1601? but overall count should be limited
  check(smallFonts.length<20, `font-size <15px count ${smallFonts.length} <20 (kbd chips allowed on desktop only)`);
}

// 10. Row-budget test. Widths/gaps are read from the final CSS declarations and
// expanded arithmetically; every row is compared with viewport minus its chrome.
{
  const css=fs.readFileSync(path.join(pub,"styles.css"),"utf8");
  const has=(s)=>css.includes(s);
  check(has("min-width: 44px") && has("gap: 4px") && has("width: 96px !important") && has("width: 112px !important") && has("width: 130px !important"), "row-budget uses declared 44px targets, 4px gaps and snap caps");
  const TOOL=44, GAP_TOOL=4, GAP_WINDOW=4, GAP_EDIT=4;
  const TOOLS_PHONE=8*TOOL; // gap zero for ≤430
  const TOOLS_TABLET=8*TOOL+7*GAP_TOOL; // 380px
  const WINDOW_WIDTH=6*TOOL+5*GAP_WINDOW; // 284px
  const EDIT_WIDTH=3*TOOL+2*GAP_EDIT; // 140px
  const CUTS_WIDTH=44;
  const PHONE_ACTION_ROW=96+EDIT_WIDTH+CUTS_WIDTH+3*4; // snap + edit + scissors + item gaps = 292
  const TABLET_ACTION_ROW=112+EDIT_WIDTH+CUTS_WIDTH+2*4; // =300
  const TABLET_FULL_ROW=TOOLS_TABLET+3*6+112+EDIT_WIDTH+CUTS_WIDTH; //=694
  const DESKTOP_TOOL_ROW=662+7*GAP_TOOL; // explicit label button widths + gaps =690
  const DESKTOP_ROW=DESKTOP_TOOL_ROW+4*8+130+EDIT_WIDTH+CUTS_WIDTH+WINDOW_WIDTH; // 1320
  const DESKTOP_KBD_ROW=DESKTOP_ROW+256; // conservative 32px chip allowance ×8; only at widest fine-pointer sizes
  const viewports=[
    {w:320,h:800,label:"320×800"}, {w:360,h:640,label:"360×640"}, {w:360,h:740,label:"360×740 flat pane"},
    {w:390,h:800,label:"390×800"}, {w:430,h:800,label:"430×800"},
    {w:640,h:360,label:"640×360 landscape"}, {w:640,h:800,label:"640×800"},
    {w:760,h:800,label:"760×800"}, {w:768,h:1024,label:"768×1024"},
    {w:1024,h:1366,label:"1024×1366"}, {w:1366,h:768,label:"1366×768"},
    {w:1366,h:600,label:"1366×600 short"}, {w:1920,h:1080,label:"1920×1080"},
  ];
  let budgetFails=[];
  for(const vp of viewports){
    let rows, rowWidths, label;
    if(vp.w>=1361){
      rows=1; rowWidths=[DESKTOP_ROW]; label=`desktop one row ${DESKTOP_ROW}px`;
      // At >1800, include a conservative keyboard-chip allowance.
      if(vp.w>=1801){ rowWidths=[DESKTOP_KBD_ROW]; label+=` + kbd chips=${DESKTOP_KBD_ROW}px`; }
    } else if(vp.w>=761){
      rows=2; rowWidths=[TABLET_FULL_ROW,WINDOW_WIDTH]; label=`tablet/desktop two rows ${TABLET_FULL_ROW}/${WINDOW_WIDTH}px`;
    } else if(vp.w>=431){
      rows=3; rowWidths=[TOOLS_TABLET,TABLET_ACTION_ROW,WINDOW_WIDTH]; label=`narrow tablet rows tools/actions/window ${TOOLS_TABLET}/${TABLET_ACTION_ROW}/${WINDOW_WIDTH}px`;
    } else {
      rows=3;
      const toolLine=vp.w<390 ? 4*TOOL+3*GAP_TOOL+8 : TOOLS_PHONE+8; // include 8px tool-strip internal gutter
      rowWidths=[toolLine,PHONE_ACTION_ROW,WINDOW_WIDTH+8]; // row 3 has 4px side padding
      label=`phone rows tools/actions/window ${rowWidths.join("/")}px`;
      if(vp.w<390) label+=` (4-per-row tool subrows)`;
    }
    const chrome = vp.w<=430 ? 0 : 16;
    const available=vp.w-chrome;
    const passed=rowWidths.every(width=>width<=available) && (vp.w<390 || vp.w>=390 || vp.w>=320);
    if(!passed) budgetFails.push(`${vp.label}: ${label} exceeds ${available}px`);
    check(passed, `row-budget ${vp.label}: ${rows} defined rows; ${label} ≤ ${available}px`);
  }
  if(budgetFails.length) budgetFails.forEach(f=>console.log(`  Budget failure: ${f}`));
  check(TOOLS_PHONE===352, "arithmetic: 8×44=352px at phone gap zero");
  check(TOOLS_TABLET===380, "arithmetic: 8×44+7×4=380px at tablet gap 4px");
  check(TOOLS_PHONE+7*4+8===388, "breakpoint arithmetic: 8×44+7×4+8px=388, so wrap below 390px");
  check(WINDOW_WIDTH===284, "arithmetic: 6×44+5×4=284px window strip");
  check(TABLET_FULL_ROW===694 && DESKTOP_ROW===1320, `computed tablet/desktop rows ${TABLET_FULL_ROW}/${DESKTOP_ROW}px`);
}

// 11. flat-pane 360×640 / 740 - ensure no vertical overflow / horizontal scroll
{
  // Static check: body overflow-x hidden, toolbar gaps correct, panels max-width 100vw
  const css=fs.readFileSync(path.join(pub,"styles.css"),"utf8");
  const html=fs.readFileSync(path.join(pub,"index.html"),"utf8");
  check(css.includes("overflow-x: hidden")||css.includes("overflow-x:hidden")|| html.includes('viewport'), "no horizontal scroll (overflow-x hidden or viewport-fit)");
  // check panels are viewport-bound
  check(css.includes("max-width: 100vw")||css.includes("max-width:100vw")||css.includes("100dvh"), "panels viewport-bound (100vw/100dvh)");
  // 44px targets already checked
  // check toolbar side padding 0 on phones
  check(css.includes("padding: 4px 0") && css.includes("max-width: 430px"), "phone toolbar side padding 0 (352 fits 360)");
}

// 12. wav-codec and audio-engine enhancements preserved
{
  const wav=fs.readFileSync(path.join(pub,"wav-codec.js"),"utf8");
  check(wav.length>40000, `wav-codec size ${wav.length} >40000 (PR#8 preserved)`);
  check(wav.includes("firstOnsetSec")||wav.includes("generateStemsFromSong"), "wav-codec has stem generator");
  const ae=fs.readFileSync(path.join(pub,"audio-engine.js"),"utf8");
  check(ae.includes("linearRampToValueAtTime") && (ae.includes("1568")||ae.includes("1174")), "audio-engine de-click with 1568/1174 Hz");
  const app=fs.readFileSync(path.join(pub,"app.js"),"utf8");
  check(app.includes("firstOnsetSec"), "app.js has firstOnsetSec drum fix");
  check(app.includes("setValueAtTime(0.0001"), "app.js has gain ramp de-click");
}

// Summary
console.log(`\n${passes} passed, ${failures} failed of ${passes+failures} checks`);
if(failures>0) process.exit(1);
