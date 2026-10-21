/**
 * Mammoth synth audit — the stock instrument in a real browser over CDP.
 *
 *   node app/server.mjs &                 # http://127.0.0.1:3000
 *   node tools/browser/synth-audit.mjs
 *
 * Covers: adding a synth channel, the editor window (knob drag, keyboard,
 * modulation by tap-to-assign and by drag-and-drop, presets, browser, undo),
 * live playback through the AudioWorklet, Step Rack "Paint Pat" and Piano Roll
 * "Render Clip" rendering synth clips, the typing keyboard, project save and
 * reload (channels and re-rendered clips come back), the main-thread render
 * fallback, and layout at desktop / tablet / phone sizes (sheet, 15px text,
 * 44px touch targets, no horizontal scroll). Screenshots go to SHOT_DIR.
 *
 * Chromium location: CHROME_BIN / CHROME_LIBS / CHROME_FONTS / CHROME_HEADLESS
 * (see cdp.mjs).
 */
import fs from "node:fs";
import { launch, newPage, goto, evalIn, setViewport, shot, sleep } from "./cdp.mjs";

const PAGE_URL = process.env.PAGE_URL || "http://127.0.0.1:3000/";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/synth-audit";
fs.mkdirSync(SHOT_DIR, { recursive: true });

let pass = 0;
let fail = 0;
const check = (cond, msg, extra = "") => {
  if (cond) {
    pass++;
    console.log(`✓ ${msg}`);
  } else {
    fail++;
    console.log(`✗ ${msg}${extra ? ` — ${extra}` : ""}`);
  }
};

const server = await launch({ port: Number(process.env.CDP_PORT || 9297) });
const page = await newPage(server, { width: 1361, height: 900 });

async function mouse(type, x, y, buttons = 1) {
  await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : buttons, clickCount: 1 });
}
async function click(x, y) {
  await mouse("mouseMoved", x, y, 0);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
}
async function centerOf(selector) {
  const r = await evalIn(page, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block: "center", inline: "nearest"}); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
  if (!r) throw new Error(`not found: ${selector}`);
  return r;
}
async function clickSel(selector) {
  const c = await centerOf(selector);
  await click(c.x, c.y);
  return c;
}
async function key(keyName, { ctrl = false, code, text } = {}) {
  const modifiers = ctrl ? 2 : 0;
  const k = { key: keyName, code: code || (keyName.length === 1 ? `Key${keyName.toUpperCase()}` : keyName), modifiers, windowsVirtualKeyCode: keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 0 };
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...k, text: ctrl ? undefined : text });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}
const synths = () => evalIn(page, "window.audiusStudioSynths()");
async function waitFor(expr, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evalIn(page, expr)) return true;
    await sleep(120);
  }
  return false;
}

/* ------------------------------------------------------------ 1. add */
await goto(page, PAGE_URL, { waitMs: 2500 });
check(page.pageErrors.length === 0, "page loads without errors", page.pageErrors.join(" | "));
await clickSel("#btn-add-synth");
const opened = await waitFor("(() => { const w = document.querySelector('.mmth-window'); return !!w && !w.hidden && w.querySelectorAll('.mmth-knob').length >= 60; })()");
check(opened, "+ Synth adds a channel and opens the Mammoth window");
const s1 = await synths();
check(s1.instruments.length === 1 && s1.instruments[0].preset === "Permafrost Pluck", "project holds one Mammoth channel with the default preset", JSON.stringify(s1.instruments));
const ui1 = await evalIn(
  page,
  `(() => { const w = document.querySelector('.mmth-window'); return {
    knobs: w.querySelectorAll('.mmth-knob').length,
    tabs: w.querySelectorAll('.mmth-tab').length,
    sources: w.querySelectorAll('.mmth-src').length,
    sections: Array.from(w.querySelectorAll('.mmth-sec-title')).map((h) => h.textContent),
    card: !!Array.from(document.querySelectorAll('.asset-card')).find((c) => c.textContent.includes('Synth ·')),
    rackEdit: document.querySelectorAll('.mmth-rack-edit').length,
  }; })()`
);
check(ui1.tabs === 13 && ui1.sources === 20, "13 pages (4 Env, 4 slots, OSC, KTR, Voicing, Routing, Global) and 20 modulation sources", `${ui1.tabs} tabs, ${ui1.sources} sources`);
const wanted = ["OSC 1", "OSC 2", "OSC 3", "MODULATION OSC", "FILTER 1", "FILTER 2", "AMP", "BYPASS", "MASTER", "FX 1", "FX 2", "EQ", "NOISE", "FEEDBACK", "INSERT 1", "INSERT 2", "MACRO CONTROL"];
const missing = wanted.filter((w) => !ui1.sections.includes(w));
check(missing.length === 0, "every section of the architecture is on the panel", missing.join(", "));
check(ui1.card, "the Library shows the synth channel with a Synth badge");
await shot(page, `${SHOT_DIR}/desktop-synth.png`);

/* ---------------------------------------------------------- 2. play */
const keyC = await centerOf('.mmth-key[data-note="60"]');
await mouse("mouseMoved", keyC.x, keyC.y + 30, 0);
await mouse("mousePressed", keyC.x, keyC.y + 30);
const sounding = await waitFor("/Voices [1-9]/.test(document.querySelector('.mmth-readout').textContent)", 4000);
check(sounding, "on-screen keyboard plays the live AudioWorklet synth (voice count rises)", await evalIn(page, "document.querySelector('.mmth-readout').textContent"));
const levels = await evalIn(page, "(async () => { let m = 0; for (let i = 0; i < 10; i++) { const l = window.audiusStudioInfo().levels; m = Math.max(m, l.left || l[0] || 0, l.right || l[1] || 0); await new Promise(r => setTimeout(r, 30)); } return m; })()");
check(levels > 0.001, "the synth reaches the master meters", String(levels));
await mouse("mouseReleased", keyC.x, keyC.y + 30);
const released = await waitFor("/Voices 0/.test(document.querySelector('.mmth-readout').textContent)", 6000);
check(released, "releasing the key ends the note");

// Computer keyboard inside the window.
await evalIn(page, "document.querySelector('.mmth-window').focus()");
await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", text: "z", windowsVirtualKeyCode: 90 });
const typed = await waitFor("/Voices [1-9]/.test(document.querySelector('.mmth-readout').textContent)", 3000);
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90 });
check(typed, "computer keys (Z…M, Q…P) play the synth while its window has focus");

/* ------------------------------------------------------- 3. knobs */
const before = await evalIn(page, "document.querySelector('.mmth-knob[data-param=\"filter1.cutoff\"] .mmth-knob-value').textContent");
const dial = await centerOf('.mmth-knob[data-param="filter1.cutoff"] .mmth-dial');
await mouse("mouseMoved", dial.x, dial.y, 0);
await mouse("mousePressed", dial.x, dial.y);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", dial.x, dial.y - i * 10);
await mouse("mouseReleased", dial.x, dial.y - 60);
const after = await evalIn(page, "document.querySelector('.mmth-knob[data-param=\"filter1.cutoff\"] .mmth-knob-value').textContent");
check(before !== after, "dragging a knob up changes its value", `${before} → ${after}`);
await evalIn(page, "document.querySelector('.mmth-knob[data-param=\"osc2.amp\"] .mmth-dial').focus()");
const k0 = await evalIn(page, "document.querySelector('.mmth-knob[data-param=\"osc2.amp\"] .mmth-dial').getAttribute('aria-valuenow')");
await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
const k1 = await evalIn(page, "document.querySelector('.mmth-knob[data-param=\"osc2.amp\"] .mmth-dial').getAttribute('aria-valuenow')");
check(Number(k1) === Number(k0) + 1, "knobs are ARIA sliders that step with the arrow keys", `${k0} → ${k1}`);
const filt = await evalIn(page, `(() => { const s = document.querySelector('select[aria-label="Filter 1 type"]'); s.value = '10'; s.dispatchEvent(new Event('change', { bubbles: true })); return document.querySelector('.mmth-knob[data-param="filter1.res"] .mmth-knob-label').textContent; })()`);
check(filt === "Feedback", "changing the filter type relabels its knobs (Comb: Pitch / Damping / Feedback)", filt);

/* ------------------------------------------------- 4. modulation */
await clickSel('.mmth-src[data-src="env1"]');
await clickSel('.mmth-knob[data-param="osc1.pos"] .mmth-dial');
const slot1 = await evalIn(page, "document.querySelector('.mmth-knob[data-param=\"osc1.pos\"] .mmth-slot').textContent");
check(slot1 === "1", "tap a source, then a knob: Envelope 1 now modulates OSC 1 Wt-position", slot1);
// The Env page sits right under the source tabs, so both ends of the drag are on screen together.
const res = await centerOf('.mmth-knob[data-param="env1.decay"] .mmth-dial');
const src5 = await evalIn(page, `(() => { const b = document.querySelector('.mmth-src[data-src="mod5"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
await mouse("mouseMoved", src5.x, src5.y, 0);
await mouse("mousePressed", src5.x, src5.y);
for (let i = 1; i <= 12; i++) await mouse("mouseMoved", src5.x + ((res.x - src5.x) * i) / 12, src5.y + ((res.y - src5.y) * i) / 12);
await mouse("mouseReleased", res.x, res.y);
const slot5 = await evalIn(page, "Array.from(document.querySelectorAll('.mmth-knob[data-param=\"env1.decay\"] .mmth-slot')).map(s => s.textContent).join(',')");
check(slot5.includes("5"), "drag a source handle onto a knob: Slot 5 modulates Envelope 1 decay", slot5);
const ring = await evalIn(page, "!!document.querySelector('.mmth-knob[data-param=\"env1.decay\"] .mmth-modarc').getAttribute('d')");
check(ring, "the knob draws a modulation depth ring");
const mods = (await synths()).instruments[0].mods;
check(mods >= 2, "both routings are stored in the patch", String(mods));
await clickSel('.mmth-knob[data-param="filter1.cutoff"] .mmth-slots');
const pop = await evalIn(page, "(() => { const p = document.querySelector('.mmth-popover'); return p ? p.querySelectorAll('.mmth-pop-row').length : -1; })()");
check(pop >= 1, "pressing the slots opens the modulation popover (depth sliders, remove, add)", String(pop));
await key("Escape");

/* -------------------------------------------- 5. presets and undo */
const p0 = await evalIn(page, "document.querySelector('.mmth-preset-name').textContent");
await clickSel('.mmth-presetbar button[aria-label="Next preset"]');
const p1 = await evalIn(page, "document.querySelector('.mmth-preset-name').textContent");
check(p0 !== p1, "▸ steps to the next preset", `${p0} → ${p1}`);
await clickSel('.mmth-view-tab[aria-label="Preset browser"]');
const count = await evalIn(page, "document.querySelectorAll('.mmth-preset-btn').length");
check(count >= 33, "the browser lists the factory presets", String(count));
await evalIn(page, "Array.from(document.querySelectorAll('.mmth-preset-btn')).find(b => b.textContent.includes('Wobble Glacier')).click()");
const p2 = await evalIn(page, "document.querySelector('.mmth-preset-name').textContent");
check(p2 === "Wobble Glacier", "clicking a browser entry loads it", p2);
await key("z", { ctrl: true });
await sleep(200);
const p3 = await evalIn(page, "document.querySelector('.mmth-preset-name').textContent");
check(p3 === p1, "Ctrl+Z in the DAW undoes the preset change in the synth", `${p2} → ${p3}`);
await clickSel('.mmth-view-tab[aria-label="Synth view"]');
for (const t of ["mod5", "mod7", "osc", "voicing", "global", "env4"]) {
  await evalIn(page, `document.querySelector('.mmth-tab[data-tab="${t}"]').click()`);
}
check(page.pageErrors.length === 0, "every page of the modulation area renders without errors", page.pageErrors.join(" | "));
await clickSel(".mmth-close");
check(await evalIn(page, "document.querySelector('.mmth-window').hidden"), "✕ closes the synth window");

/* --------------------------------------------- 6. Step Rack render */
await evalIn(page, "document.getElementById('btn-toggle-channel-rack').click()");
await sleep(300);
const rowSteps = await evalIn(
  page,
  `(() => { const row = document.querySelector('.mmth-rack-edit').closest('.cr-row'); const steps = row.querySelectorAll('.cr-step'); [0, 3, 6, 8, 11, 14].forEach((i) => steps[i].click()); return row.querySelectorAll('.cr-step.active').length; })()`
);
check(rowSteps === 6, "the synth row has its own 16 steps in the Step Rack", String(rowSteps));
await evalIn(page, "document.getElementById('btn-stamp-pattern').click()");
const stamped = await waitFor("window.audiusStudioSynths().clips.length >= 1", 10000);
const s2 = await synths();
check(stamped && s2.clips[0].durationBeats >= 4, "Paint Pat renders the synth row into one audio clip on the playlist", JSON.stringify(s2.clips));
check(s2.renders.length === 1 && s2.renders[0].notes === 6, "the render recipe keeps its 6 notes for reloads", JSON.stringify(s2.renders));
const renderPeak = await evalIn(page, "(async () => { const m = await import('/instruments/mammoth/mammoth-host.js?v=2'); return true; })()");
check(renderPeak, "synth modules load as same-origin ES modules");

/* -------------------------------------------- 7. Piano Roll render */
await evalIn(page, "document.querySelector('.mmth-rack-edit').closest('.cr-row').querySelector('.cr-channel-btn').click()");
await evalIn(page, "document.getElementById('btn-toggle-piano-roll').click()");
await sleep(300);
await evalIn(page, "document.getElementById('btn-pr-stamp').click()");
const rolled = await waitFor("window.audiusStudioSynths().clips.length >= 2", 10000);
check(rolled, "Render Clip renders the Piano Roll notes through the synth", JSON.stringify((await synths()).clips));

/* ------------------------------------------------- 8. typing keys */
await evalIn(page, "document.getElementById('btn-typing-piano').click(); document.activeElement && document.activeElement.blur()");
await sleep(100);
await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "x", code: "KeyX", text: "x", windowsVirtualKeyCode: 88 });
await sleep(150);
const status = await evalIn(page, "document.getElementById('status-pill').textContent");
await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "x", code: "KeyX", windowsVirtualKeyCode: 88 });
check(/Typing keyboard: D4 · Mammoth 1/.test(status), "the DAW typing keyboard plays the selected synth channel", status);
await evalIn(page, "document.getElementById('btn-typing-piano').click()");

/* ------------------------------------------- 9. save and reload */
await evalIn(page, "document.getElementById('project-name') && (document.getElementById('project-name').value = 'Synth Audit')");
await key("s", { ctrl: true });
await sleep(600);
const stored = await evalIn(page, `(() => { const map = JSON.parse(localStorage.getItem('audius_studio_projects_v1') || '{}'); const e = map['Synth Audit']; return e ? { inst: (e.payload.instruments || []).length, renders: (e.payload.synthRenders || []).length, patch: !!(e.payload.instruments[0] && e.payload.instruments[0].patch && e.payload.instruments[0].patch.format) } : null; })()`);
check(stored && stored.inst === 1 && stored.renders === 2 && stored.patch, "saving stores the synth channel, its patch and both render recipes", JSON.stringify(stored));
await goto(page, PAGE_URL, { waitMs: 2500 });
check((await synths()).instruments.length === 0, "a fresh page starts without the synth");
await key("o", { ctrl: true });
await waitFor("document.querySelectorAll('.saved-proj-row').length > 0", 4000);
await evalIn(page, "Array.from(document.querySelectorAll('.saved-proj-row')).find(r => r.textContent.includes('Synth Audit')).click()");
const restored = await waitFor("(() => { const s = window.audiusStudioSynths(); return s.instruments.length === 1 && s.renderAssets.length === 2 && s.clips.length === 2; })()", 15000);
const s3 = await synths();
check(restored, "opening the project brings back the channel and re-renders both synth clips", JSON.stringify({ i: s3.instruments.length, a: s3.renderAssets, c: s3.clips.length }));
check(
  await evalIn(page, "!!Array.from(document.querySelectorAll('.asset-card')).find((c) => c.textContent.includes('Synth ·'))"),
  "the reopened synth channel is back in the Library"
);

/* ------------------------------------------- 10. render fallback */
const fb = await evalIn(
  page,
  `(async () => {
    const host = await import('/instruments/mammoth/mammoth-host.js?v=2');
    const P = await import('/instruments/mammoth/params.js?v=1');
    const peak = (b) => { let m = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; };
    const job = { patch: P.makeInitPatch(), notes: [{ time: 0, dur: 0.3, note: 60, vel: 0.9 }], seconds: 0.4, tailSec: 0.5, sampleRate: 44100 };
    await host.loadMammothWorklet(new OfflineAudioContext(2, 4410, 44100));
    const viaWorklet = await host.renderMammoth(job);
    const OAC = window.OfflineAudioContext;
    window.OfflineAudioContext = undefined;
    let viaMain;
    try { viaMain = await host.renderMammoth(job); } finally { window.OfflineAudioContext = OAC; }
    return { worklet: peak(viaWorklet), main: peak(viaMain), lenW: viaWorklet.length, lenM: viaMain.length };
  })()`
);
check(fb.worklet > 0.05, "offline rendering runs the worklet in an OfflineAudioContext", JSON.stringify(fb));
check(fb.main > 0.05 && Math.abs(fb.main - fb.worklet) < 0.02, "the main-thread fallback renders the same sound when offline worklets are missing", JSON.stringify(fb));

/* ------------------------------------------------------ 11. layout */
async function openEditor() {
  await evalIn(page, "(document.querySelector('.mmth-rack-edit') || Array.from(document.querySelectorAll('.asset-card button')).find(b => /Edit/.test(b.textContent))).click()");
  await waitFor("(() => { const w = document.querySelector('.mmth-window'); return !!w && !w.hidden; })()", 5000);
  await sleep(250);
}
async function layout(label, w, h, { touch = false } = {}) {
  await setViewport(page, w, h, { touch, mobile: touch });
  await sleep(400);
  await openEditor();
  const r = await evalIn(
    page,
    `(() => {
      const win = document.querySelector('.mmth-window');
      const b = win.getBoundingClientRect();
      const body = win.querySelector('.mmth-body');
      const docOverflow = document.scrollingElement.scrollWidth - window.innerWidth;
      const small = [];
      for (const el of win.querySelectorAll('*')) {
        if (!el.offsetParent && el.tagName !== 'OPTION') continue;
        const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!direct) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 15) small.push(el.className + ':' + fs);
      }
      const tiny = [];
      if (${touch}) {
        for (const el of win.querySelectorAll('button, select, input, .mmth-dial, [role=slider]')) {
          if (!el.offsetParent) continue;
          const rr = el.getBoundingClientRect();
          if (el.classList.contains('mmth-key') || el.classList.contains('mmth-step')) continue;
          if (rr.width < 43.5 || rr.height < 43.5) tiny.push((el.className || el.tagName) + ' ' + Math.round(rr.width) + 'x' + Math.round(rr.height));
        }
      }
      const colOsc = win.querySelector('.mmth-col-osc').getBoundingClientRect().width;
      const top = win.querySelector('.mmth-top').getBoundingClientRect().width;
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, vw: window.innerWidth, vh: window.innerHeight,
               docOverflow, bodyOverflow: body.scrollWidth - body.clientWidth, small: small.slice(0, 6), smallCount: small.length,
               tiny: tiny.slice(0, 8), tinyCount: tiny.length, oscFull: colOsc > top * 0.9 };
    })()`
  );
  await shot(page, `${SHOT_DIR}/${label}.png`);
  check(r.left >= -0.5 && r.right <= r.vw + 0.5 && r.top >= -0.5, `${label}: window fits the viewport`, JSON.stringify(r));
  check(r.docOverflow <= 0 && r.bodyOverflow <= 1, `${label}: no horizontal scroll`, `doc ${r.docOverflow} body ${r.bodyOverflow}`);
  check(r.smallCount === 0, `${label}: all text in the window is at least 15px`, r.small.join(" "));
  if (touch) check(r.tinyCount === 0, `${label}: every control is at least 44×44 px`, r.tiny.join(" | "));
  return r;
}
const d = await layout("desktop-1361", 1361, 900);
check(!d.oscFull, "desktop-1361: three columns (oscillators | filters | output)");
const t = await layout("tablet-1024", 1024, 768);
check(t.oscFull, "tablet-1024: oscillators span the top, filters and output share a row");
const ph = await layout("phone-360", 360, 740, { touch: true });
check(Math.abs(ph.left) < 1 && Math.abs(ph.right - 360) < 1 && Math.abs(ph.bottom - 740) < 1, "phone-360: the synth is a full-screen sheet", JSON.stringify(ph));
await layout("phone-320", 320, 800, { touch: true });
await layout("landscape-640", 640, 360, { touch: true });
await evalIn(page, "document.querySelector('.mmth-close').click()");

check(page.pageErrors.length === 0, "no uncaught page errors during the audit", page.pageErrors.join(" | "));
const errs = page.consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND|net::ERR/.test(e));
check(errs.length === 0, "no console errors during the audit", errs.slice(0, 5).join(" | "));

server.stop();
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`Screenshots: ${SHOT_DIR}`);
process.exit(fail ? 1 : 0);
