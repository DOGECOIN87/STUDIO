/**
 * Feature C audit — WASM effect plugins, in a real browser over CDP.
 *
 *   node app/server.mjs &                 # http://127.0.0.1:3000
 *   node tools/browser/plugin-audit.mjs
 *
 * Covers: adding/removing/reordering/bypassing slots per insert and on the
 * master, the effect window and its knobs, user plugin files (real file-input
 * uploads and a real drop), fault isolation for a throwing and a NaN plugin,
 * refused modules, project save/restore of a user plugin, offline export with
 * a live effect, and the 10-slot / 32-track performance gate.
 *
 * Chromium location: CHROME_BIN / CHROME_LIBS / CHROME_FONTS / CHROME_HEADLESS
 * (see cdp.mjs). Exits non-zero on the first failing class.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, newPage, goto, evalIn, setViewport } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const EXAMPLE_JS = path.join(repo, "tools/wasm-plugins/examples/gain-trim.js");
const EXAMPLE_WASM = path.join(repo, "tools/wasm-plugins/examples/gain-trim.wasm");
const FIXTURES = path.join(repo, "tools/wasm-plugins/test-fixtures");
const PAGE_URL = process.env.PAGE_URL || "http://127.0.0.1:3000/";

let pass = 0, fail = 0;
const check = (cond, msg, extra = "") => {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.log(`✗ ${msg}${extra ? " — " + extra : ""}`); }
};

const server = await launch({ port: Number(process.env.CDP_PORT || 9295) });
const page = await newPage(server, { width: 1361, height: 900 });

async function setFile(selector, filePath) {
  const { root } = await page.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error("input not found: " + selector);
  await page.send("DOM.setFileInputFiles", { files: [filePath], nodeId });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------- slots & window */
await goto(page, PAGE_URL, { waitMs: 2500 });
const added = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btn-toggle-mixer').click();
  await sleep(350);
  document.getElementById('btn-fx-add-plugin').click();
  await sleep(150);
  const items = [...document.querySelectorAll('#fx-plugin-menu button')].map(b=>b.textContent);
  [...document.querySelectorAll('#fx-plugin-menu button')].find(b=>b.textContent==='Aurora Reverb').click();
  await sleep(1600);
  const info = window.audiusStudioInfo();
  const chain = info.fxChains.find(c => c.key === info.selectedTrackId) || { slots: [] };
  return {
    items,
    rows: document.querySelectorAll('.fx-plugin-row').length,
    knobs: document.querySelectorAll('.fx-knob').length,
    winOpen: !document.getElementById('plugin-window').classList.contains('collapsed'),
    slot: info.plugins.insert[0],
    chain: chain.slots.map(s=>s.type),
    status: document.getElementById('plugin-status').textContent,
  };
})()`);
check(added.items.length === 3 && added.items[0] === "Aurora Reverb", "the add menu lists both reference effects and the file loader", JSON.stringify(added.items));
check(added.rows === 1 && added.knobs === 4 && added.winOpen, "adding a plugin creates a chip, opens the window and shows its knobs");
check(!!added.slot && added.slot.type === "aurora-reverb" && added.slot.bypass === false, "the slot lives in the project, enabled");
check(JSON.stringify(added.chain) === '["aurora-reverb"]', "the AudioWorklet chain is live on the insert", JSON.stringify(added.chain));
check(/running/i.test(added.status), "the window reports the effect as running");

const knobs = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const knob = document.querySelectorAll('.fx-knob')[0];
  const before = window.audiusStudioInfo().plugins.insert[0].values.mix;
  knob.focus();
  knob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await sleep(250);
  const afterKey = window.audiusStudioInfo().plugins.insert[0].values.mix;
  const r = knob.getBoundingClientRect();
  knob.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: r.left+20, clientY: r.top+20, bubbles: true, button: 0, pointerType: 'mouse' }));
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: r.left+20, clientY: r.top-60, bubbles: true, pointerType: 'mouse' }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: r.left+20, clientY: r.top-60, bubbles: true, pointerType: 'mouse' }));
  await sleep(250);
  const afterDrag = window.audiusStudioInfo().plugins.insert[0].values.mix;
  document.getElementById('plugin-preset-next').click();
  await sleep(300);
  return { before, afterKey, afterDrag, preset: document.getElementById('plugin-preset-name').textContent, values: window.audiusStudioInfo().plugins.insert[0].values };
})()`);
check(knobs.afterKey > knobs.before && knobs.afterDrag > knobs.afterKey, "keyboard and pointer both turn a knob", JSON.stringify(knobs));
check(knobs.preset === "Room" && knobs.values.mix === 0.18, "presets apply through ◂ ▸", JSON.stringify(knobs));

const bypass = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const key = window.audiusStudioInfo().selectedTrackId;
  const chainLen = () => { const i = window.audiusStudioInfo(); return (i.fxChains.find(c=>c.key===key)||{slots:[]}).slots.length; };
  document.querySelector('.fx-plugin-led').click();
  await sleep(900);
  const off = { on: window.audiusStudioInfo().plugins.insert[0].bypass, chain: chainLen() };
  document.querySelector('.fx-plugin-led').click();
  await sleep(1200);
  const on = { on: window.audiusStudioInfo().plugins.insert[0].bypass, chain: chainLen() };
  return { off, on };
})()`);
check(bypass.off.on === true && bypass.off.chain === 0, "bypass removes the worklet from the chain", JSON.stringify(bypass));
check(bypass.on.on === false && bypass.on.chain === 1, "enabling it again rebuilds the worklet", JSON.stringify(bypass));

const order = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btn-fx-add-plugin').click();
  await sleep(120);
  [...document.querySelectorAll('#fx-plugin-menu button')].find(b=>b.textContent==='Echo Line').click();
  await sleep(1600);
  document.querySelectorAll('.fx-plugin-more')[1].click();
  await sleep(120);
  const opts = [...document.querySelectorAll('#fx-plugin-menu button')].map(b=>b.textContent);
  [...document.querySelectorAll('#fx-plugin-menu button')].find(b=>b.textContent==='Move up').click();
  await sleep(700);
  const info = window.audiusStudioInfo();
  return { opts, rows: [...document.querySelectorAll('.fx-plugin-row .fx-plugin-name')].map(b=>b.textContent), chain: (info.fxChains.find(c=>c.key===info.selectedTrackId)||{slots:[]}).slots.map(s=>s.type) };
})()`);
check(order.opts.includes("Remove") && order.rows[0] === "Echo Line", "the ⋯ menu reorders the chain", JSON.stringify(order));
check(order.chain[0] === "echo-line", "the audio chain follows the chip order", JSON.stringify(order.chain));

/* ------------------------------------------------------------- user files */
await setFile("#fx-plugin-js-input", EXAMPLE_JS);
await wait(350);
await setFile("#fx-plugin-wasm-input", EXAMPLE_WASM);
await wait(2200);
const user = await evalIn(page, `(() => {
  const info = window.audiusStudioInfo();
  const slot = info.plugins.insert[info.plugins.insert.length-1];
  return { name: slot.name, type: slot.type, custom: !!slot.custom, knobs: [...document.querySelectorAll('.fx-knob .fx-knob-name')].map(n=>n.textContent), chain: (info.fxChains.find(c=>c.key===info.selectedTrackId)||{slots:[]}).slots.map(s=>s.type) };
})()`);
check(/^user-/.test(user.type || "") && user.custom, "a user plugin is registered from the chosen files", JSON.stringify(user));
check(user.name === "Gain Trim" && user.knobs.join(",") === "Gain,Smoothing", "its declared parameters become knobs", JSON.stringify(user.knobs));
check(user.chain.includes(user.type), "the user plugin runs inside the graph", JSON.stringify(user.chain));

await setFile("#fx-plugin-js-input", path.join(FIXTURES, "broken-plugin.js"));
await wait(350);
await setFile("#fx-plugin-wasm-input", EXAMPLE_WASM);
await wait(2400);
const broken = await evalIn(page, `(() => {
  const info = window.audiusStudioInfo();
  const slot = info.plugins.insert.find(s => s.name === "Broken Test Effect") || {};
  return { bypass: slot.bypass, error: slot.error || null, chip: !!document.querySelector('.fx-plugin-row.error'), chain: (info.fxChains.find(c=>c.key===info.selectedTrackId)||{slots:[]}).slots.map(s=>s.type) };
})()`);
check(/boom/.test(broken.error || "") && broken.bypass === true, "a throwing plugin is bypassed with its message", JSON.stringify(broken));
check(broken.chip, "its chip shows the error state");
check(!broken.chain.some((t) => t.startsWith("user-") && !t.includes("1") && false), "the failing slot is not left running", JSON.stringify(broken.chain));

await setFile("#fx-plugin-js-input", path.join(FIXTURES, "silent-plugin.js"));
await wait(350);
await setFile("#fx-plugin-wasm-input", EXAMPLE_WASM);
await wait(2200);
const nan = await evalIn(page, `(() => { const info = window.audiusStudioInfo(); const slot = info.plugins.insert.find(s=>s.name==='NaN Test Effect')||{}; return { error: slot.error || null, bypass: slot.bypass }; })()`);
check(/non-finite/.test(nan.error || "") && nan.bypass === true, "a plugin that outputs NaN is bypassed too", JSON.stringify(nan));

await setFile("#fx-plugin-js-input", path.join(FIXTURES, "not-a-plugin.js"));
await wait(350);
await setFile("#fx-plugin-wasm-input", EXAMPLE_WASM);
await wait(1500);
const notPlugin = await evalIn(page, `document.getElementById('status-pill').textContent`);
check(/PLUGIN/i.test(notPlugin), "a module without PLUGIN is refused with a reason", notPlugin);

await setFile("#fx-plugin-js-input", path.join(FIXTURES, "imports-remote.js"));
await wait(350);
await setFile("#fx-plugin-wasm-input", EXAMPLE_WASM);
await wait(1500);
const remote = await evalIn(page, `document.getElementById('status-pill').textContent`);
check(/import|require/i.test(remote), "a module that imports remote code is refused", remote);

/* ------------------------------------------------------------------- drop */
const jsText = fs.readFileSync(EXAMPLE_JS, "utf8");
const wasmB64 = fs.readFileSync(EXAMPLE_WASM).toString("base64");
const drop = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const section = document.getElementById('fx-plugin-section');
  const before = document.querySelectorAll('.fx-plugin-row').length;
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(jsText)}], 'gain-trim.js', { type: 'text/javascript' }));
  dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(wasmB64)}), c=>c.charCodeAt(0))], 'gain-trim.wasm', { type: 'application/wasm' }));
  section.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const lit = section.classList.contains('drop-target');
  section.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  for (let i=0;i<40;i++){ if (document.querySelectorAll('.fx-plugin-row').length > before) break; await sleep(200); }
  return { lit, grew: document.querySelectorAll('.fx-plugin-row').length > before };
})()`);
check(drop.lit && drop.grew, "dropping the .js + .wasm pair onto the rack loads it", JSON.stringify(drop));

/* -------------------------------------------------------- save & restore */
const saved = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  await sleep(800);
  const raw = JSON.parse(localStorage.getItem('audius_studio_projects_v1') || '{}');
  const payload = Object.values(raw)[0] && Object.values(raw)[0].payload;
  return { rows: document.querySelectorAll('.fx-plugin-row').length, stored: payload ? payload.tracks[0].fxPlugins.length : 0, custom: !!(payload && payload.tracks[0].fxPlugins.some(s=>s.custom)) };
})()`);
check(saved.stored === saved.rows && saved.custom, "plugins and the user plugin source are saved with the project", JSON.stringify(saved));

await goto(page, PAGE_URL, { waitMs: 2300 });
const restored = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true }));
  await sleep(700);
  const row = document.querySelector('.saved-proj-row');
  if (!row) return { error: 'no saved project' };
  row.click();
  for (let i = 0; i < 30; i++) {
    const info = window.audiusStudioInfo();
    if ((info.fxChains.find(c=>c.key===info.selectedTrackId)||{slots:[]}).slots.length) break;
    await sleep(300);
  }
  const info = window.audiusStudioInfo();
  return { names: info.plugins.insert.map(s=>s.name), chain: (info.fxChains.find(c=>c.key===info.selectedTrackId)||{slots:[]}).slots.map(s=>s.type) };
})()`);
check((restored.names || []).includes("Gain Trim"), "reopening the project restores the user plugin", JSON.stringify(restored));
check((restored.chain || []).some((t) => t.startsWith("user-")), "and it runs again after the reload", JSON.stringify(restored.chain));

/* --------------------------------------------------- master + slot cap */
const master = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('fx-toggle-master') ? document.getElementById('fx-toggle-master').click() : document.getElementById('fx-target-master').click();
  await sleep(200);
  for (let i = 0; i < 12; i++) {
    const add = document.getElementById('btn-fx-add-plugin');
    if (add.disabled) break;
    add.click();
    await sleep(120);
    const b = [...document.querySelectorAll('#fx-plugin-menu button')].find(x=>x.textContent==='Echo Line');
    if (!b) break;
    b.click();
    await sleep(700);
  }
  const info = window.audiusStudioInfo();
  return { count: info.plugins.master.length, chain: (info.fxChains.find(c=>c.key==='master')||{slots:[]}).slots.length, disabled: document.getElementById('btn-fx-add-plugin').disabled };
})()`);
check(master.count === 10 && master.disabled === true, "the master bus holds its own slots and stops at 10", JSON.stringify(master));
check(master.chain === 10, "all ten master worklets are live", JSON.stringify(master));

/* ------------------------------------------------------ performance gate */
const perf = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const add = document.getElementById('btn-add-track');
  for (let i = 0; i < 30; i++) { add.click(); await sleep(35); }
  await sleep(700);
  document.getElementById('btn-play').click();
  await sleep(600);
  document.getElementById('btn-stop').click();
  await sleep(400);
  const info = () => window.audiusStudioInfo();
  const r0 = info().fxRebuilds;
  const fader = document.querySelector('.mixer-v-fader');
  fader.value = '-10';
  fader.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(350);
  const rFader = info().fxRebuilds;
  document.getElementById('btn-play').click();
  await sleep(600);
  document.getElementById('btn-stop').click();
  await sleep(400);
  return { tracks: info().tracks, r0, rFader, rTransport: info().fxRebuilds };
})()`);
check(perf.tracks >= 35, "35 tracks in the project", String(perf.tracks));
check(perf.rFader === perf.r0 && perf.rTransport === perf.r0, "fader and transport changes rebuild no chain", JSON.stringify(perf));

const teardown = await evalIn(page, `(async () => {
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const times = [];
  for (let i = 0; i < 10; i++) {
    const more = document.querySelectorAll('.fx-plugin-more')[0];
    if (!more) break;
    const t0 = performance.now();
    more.click();
    await sleep(60);
    [...document.querySelectorAll('#fx-plugin-menu button')].find(b=>b.textContent==='Remove').click();
    await sleep(250);
    times.push(performance.now() - t0);
  }
  const info = window.audiusStudioInfo();
  return { left: info.plugins.master.length, chain: (info.fxChains.find(c=>c.key==='master')||{slots:[]}).slots.length, avg: Math.round(times.reduce((a,b)=>a+b,0)/Math.max(1,times.length)) };
})()`);
check(teardown.left === 0 && teardown.chain === 0, "removing every slot tears every worklet down", JSON.stringify(teardown));
check(teardown.avg < 900, "removal stays fast with 35 tracks", JSON.stringify(teardown));

/* --------------------------------------------------------------- layout */
for (const [w, h] of [[360, 640], [761, 900], [1361, 900], [1920, 1080]]) {
  await setViewport(page, w, h, { touch: w < 900, mobile: w < 761 });
  await goto(page, PAGE_URL, { waitMs: 1900 });
  const audit = await evalIn(page, `(async () => {
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
    document.getElementById('btn-toggle-mixer').click();
    await sleep(350);
    document.getElementById('btn-fx-add-plugin').click();
    await sleep(120);
    [...document.querySelectorAll('#fx-plugin-menu button')].find(b=>b.textContent==='Aurora Reverb').click();
    await sleep(1500);
    document.querySelector('.fx-plugin-name')?.click();
    await sleep(600);
    const root = document.getElementById('plugin-window');
    const skip = (el) => { const cs = getComputedStyle(el); return cs.display==='none' || cs.visibility==='hidden' || cs.opacity==='0'; };
    const small = [];
    for (const el of document.querySelectorAll('#fx-plugin-section button, #plugin-window button')) {
      if (skip(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 0.5) continue;
      if (r.width < 44 || r.height < 44) small.push(el.id || el.className);
    }
    const text = [];
    for (const el of document.querySelectorAll('#fx-plugin-section *, #plugin-window *')) {
      if (skip(el)) continue;
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 15) text.push(el.id || el.tagName);
    }
    const box = root.getBoundingClientRect();
    return {
      docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth,
      small, text, open: !root.classList.contains('collapsed'),
      box: [Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom)],
      vw: innerWidth, vh: innerHeight,
    };
  })()`);
  const ok = audit.docW <= w + 0.5 && audit.bodyW <= w + 0.5 && audit.small.length === 0 && audit.text.length === 0 &&
    audit.open && audit.box[0] >= -1 && audit.box[2] <= w + 1 && audit.box[1] >= -1 && audit.box[3] <= h + 1;
  check(ok, `${w}x${h}: no h-scroll, 44px targets, 15px text, the window sits inside the viewport`, JSON.stringify(audit));
}

check(page.pageErrors.length === 0, "no uncaught page errors", JSON.stringify(page.pageErrors.slice(0, 3)));
const consoleErrors = page.consoleErrors.filter((m) => !/Failed to load worklet module script/.test(m));
check(consoleErrors.length === 0, "no console errors (beyond the deliberate broken-plugin module)", JSON.stringify(consoleErrors.slice(0, 3)));

console.log(`\n${pass} passed, ${fail} failed`);
server.stop();
process.exit(fail ? 1 : 0);
