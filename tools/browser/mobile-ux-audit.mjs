/**
 * Mobile and tablet UX audit for the Mammoth synth editor (and its gesture rules).
 *
 * Real Chromium over CDP with touch emulation: every gesture is a real
 * Input.dispatchTouchEvent sequence, so Chromium's touch-action handling is the
 * one a finger gets. Positions are re-measured right before each gesture.
 *
 *   node app/server.mjs &                       # http://127.0.0.1:3000
 *   node tools/browser/mobile-ux-audit.mjs
 *
 * Env: PAGE_URL (default http://127.0.0.1:3000/), SHOT_DIR (default /tmp/mobile-ux),
 *      ONLY=360x640,1024x768 to run a subset of viewports.
 * Chromium location: CHROME_BIN / CHROME_LIBS / CHROME_FONTS / CHROME_HEADLESS (cdp.mjs).
 *
 * Checks (per viewport unless noted):
 *  - header: one row and <= 64 px on phone portrait; the synth fills the screen
 *  - pages: every page is <= 2 screens long, and the keyboard is visible and playable on it
 *  - scrolling: a vertical swipe that starts on a knob, a source handle or a slot scrolls
 *    the page and changes no value and no modulation
 *  - touch turning: a sideways drag changes its knob
 *  - tap-to-assign: source tap + knob tap (2 taps) adds the routing; a swipe while armed adds nothing
 *  - knob sheet: a tap opens it; its slider, steps and Reset work
 *  - status: messages stay out of the keyboard (header line, not the toast)
 *  - octave label matches the keys on screen
 *  - landscape phone: at least 60% of the height goes to controls
 *  - touch targets 44x44, 15px text, no horizontal scroll, no console errors
 */
import fs from "node:fs";
import { launch, newPage, goto, evalIn, setViewport, shot, sleep } from "./cdp.mjs";

const PAGE_URL = process.env.PAGE_URL || "http://127.0.0.1:3000/";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/mobile-ux";
fs.mkdirSync(SHOT_DIR, { recursive: true });

// [width, height, kind]: kind is phone, landscape-phone or tablet.
const ALL = [
  [360, 640, "phone"],
  [390, 844, "phone"],
  [640, 360, "landscape"],
  [844, 390, "landscape"],
  [810, 1080, "tablet"],
  [1024, 768, "tablet"],
  [1180, 820, "tablet"],
  [1024, 1366, "tablet"],
];
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const SIZES = ALL.filter(([w, h]) => !only || only.has(`${w}x${h}`));

let pass = 0;
let fail = 0;
const log = [];
const check = (cond, msg, extra = "") => {
  if (cond) {
    pass++;
    log.push(`  ✓ ${msg}`);
  } else {
    fail++;
    log.push(`  ✗ ${msg}${extra ? ` — ${extra}` : ""}`);
  }
  console.log(log[log.length - 1]);
};
const info = (msg) => {
  log.push(`    · ${msg}`);
  console.log(`    · ${msg}`);
};

const server = await launch({ port: Number(process.env.CDP_PORT || 9331) });
const page = await newPage(server, { width: 390, height: 844 });

/* ------------------------------------------------------------- gestures */
// Touch helpers. One finger, id 1, 16 moves 16 ms apart (the handover's recipe).
async function touchTap(x, y, ms = 70) {
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await sleep(ms);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(120);
}
async function touchSwipe(x0, y0, dx, dy, steps = 16) {
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await page.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps, id: 1 }],
    });
    await sleep(16);
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(250);
}
/** Current centre of a selector inside the synth window (re-measured every time). */
async function centre(selector) {
  const r = await evalIn(
    page,
    `(() => { const e = document.querySelector('.mmth-window ${selector}'); if (!e) return null; const bb = e.getBoundingClientRect(); if (bb.top < 0 || bb.bottom > innerHeight) e.scrollIntoView({ block: 'center', inline: 'nearest' }); const b = e.getBoundingClientRect(); if (!b.width || !b.height) return null; return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`
  );
  if (!r) throw new Error(`not on the current page: ${selector}`);
  return r;
}
/** Marks the first knob dial that is showing on the current page and returns a selector for it. */
async function showingDial(mark) {
  const ok = await evalIn(
    page,
    `(() => { document.querySelectorAll('[data-gate-dial]').forEach((d) => d.removeAttribute('data-gate-dial')); const ds = Array.from(document.querySelectorAll('.mmth-window .mmth-body .mmth-knob .mmth-dial')); const d = ds.find((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.top > 60 && b.bottom < innerHeight - 40; }) || ds.find((x) => x.getClientRects().length); if (!d) return false; d.setAttribute('data-gate-dial', '${mark}'); return true; })()`
  );
  if (!ok) throw new Error("no knob on the current page");
  return `[data-gate-dial="${mark}"]`;
}
/** Everything a gesture must not change: every knob's value and every slot's text. */
const SNAP = `(() => {
  const w = document.querySelector('.mmth-window');
  const knobs = Array.from(w.querySelectorAll('.mmth-dial')).map((d) => d.getAttribute('aria-valuenow') + ':' + (d.closest('.mmth-knob') || {}).dataset?.param);
  const slots = Array.from(w.querySelectorAll('.mmth-slots')).map((s) => s.textContent).join(',');
  const mods = Array.from(w.querySelectorAll('.mmth-slots')).reduce((n, s) => n + s.textContent.trim().length, 0);
  return { knobs: knobs.join('|'), slots, mods };
})()`;
const BODY = `(() => { const b = document.querySelector('.mmth-window .mmth-body'); return { top: b.scrollTop, sh: b.scrollHeight, ch: b.clientHeight }; })()`;

/* ------------------------------------------------------------- helpers */
async function waitFor(expr, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evalIn(page, expr)) return true;
    await sleep(100);
  }
  return false;
}
async function openSynth() {
  await goto(page, PAGE_URL, { waitMs: 2200 });
  await evalIn(page, "document.getElementById('btn-add-synth').click()");
  return waitFor("(() => { const w = document.querySelector('.mmth-window'); return !!w && !w.hidden && w.querySelectorAll('.mmth-knob').length >= 60; })()", 9000);
}
async function gotoPage(name) {
  // Phones and tablets have a bottom page bar; if it is missing the whole synth is one page.
  const has = await evalIn(page, "!!document.querySelector('.mmth-window .mmth-pagebar')");
  if (!has) return false;
  await evalIn(page, `document.querySelector('.mmth-window .mmth-pagetab[data-page="${name}"]').click()`);
  await sleep(180);
  return true;
}
async function viewportInfo() {
  return evalIn(
    page,
    `(() => {
      const win = document.querySelector('.mmth-window');
      const b = win.getBoundingClientRect();
      const tb = win.querySelector('.mmth-titlebar').getBoundingClientRect();
      const rows = new Set();
      for (const el of win.querySelectorAll('.mmth-titlebar button, .mmth-titlebar select, .mmth-titlebar .mmth-readout')) {
        if (!el.getClientRects().length) continue;
        rows.add(Math.round(el.getBoundingClientRect().top / 8));
      }
      const keys = win.querySelector('.mmth-keys');
      const kr = keys ? keys.getBoundingClientRect() : null;
      const body = win.querySelector('.mmth-body').getBoundingClientRect();
      return { win: [b.left, b.top, b.right, b.bottom], vw: innerWidth, vh: innerHeight, headerH: tb.height, headerRows: rows.size,
        keys: kr && kr.height > 0 ? [kr.left, kr.top, kr.right, kr.bottom] : null,
        keysOnScreen: !!kr && kr.height > 0 && kr.bottom <= innerHeight + 0.5 && kr.top >= 0,
        bodyH: body.height, bodyFrac: body.height / b.height };
    })()`
  );
}
async function keysPlayable() {
  return evalIn(
    page,
    `(() => {
      const keys = document.querySelector('.mmth-window .mmth-keys');
      if (!keys || !keys.getClientRects().length) return { ok: false, why: 'no keys' };
      const r = keys.getBoundingClientRect();
      if (r.height < 60) return { ok: false, why: 'keys ' + Math.round(r.height) + 'px' };
      if (r.bottom > innerHeight + 0.5) return { ok: false, why: 'keys below the screen' };
      const x = r.left + r.width * 0.3;
      const y = r.top + r.height * 0.7;
      const hit = document.elementFromPoint(x, y);
      const onKey = !!(hit && hit.closest && hit.closest('.mmth-key'));
      // The page bar and status line must not sit on the keys either.
      const cover = Array.from(document.querySelectorAll('#status-toast:not([hidden]), .mmth-window .mmth-flash:not([hidden])')).some((t) => {
        const q = t.getBoundingClientRect();
        return q.width > 0 && q.bottom > r.top && q.top < r.bottom && q.right > r.left && q.left < r.right;
      });
      return { ok: onKey && !cover, why: onKey ? (cover ? 'covered by a message' : '') : 'hit ' + (hit ? hit.tagName + '.' + hit.className : 'nothing') };
    })()`
  );
}

/* ------------------------------------------------------------- the audit */
for (const [w, h, kind] of SIZES) {
  const phone = kind === "phone";
  const landscape = kind === "landscape";
  const touch = true;
  console.log(`\n=== ${w}×${h} ${kind} (touch) ===`);
  await setViewport(page, w, h, { touch, mobile: w < 761 });
  await sleep(300);
  const opened = await openSynth();
  check(opened, `${w}×${h}: + Synth opens the editor`);
  if (!opened) continue;
  await sleep(300);

  // 1. Header and window shape.
  const vi = await viewportInfo();
  info(`header ${Math.round(vi.headerH)}px in ${vi.headerRows} row(s); synth ${vi.win.map(Math.round).join(',')}; keys ${vi.keys ? vi.keys.map(Math.round).join(',') : 'none'}; body ${Math.round(vi.bodyH)}px (${Math.round(vi.bodyFrac * 100)}%)`);
  const full = Math.abs(vi.win[0]) < 1 && Math.abs(vi.win[2] - w) < 1 && Math.abs(vi.win[3] - h) < 1;
  check(full, `${w}×${h}: the synth is a full-screen sheet`, JSON.stringify(vi.win));
  if (phone && w === 360 || phone && w === 390) {
    check(vi.headerRows === 1 && vi.headerH <= 64.5, `${w}×${h}: header is one row and 64px or less`, `${vi.headerRows} row(s), ${Math.round(vi.headerH)}px`);
  }
  if (landscape) {
    check(vi.bodyFrac >= 0.6, `${w}×${h}: at least 60% of the height goes to controls`, `${Math.round(vi.bodyFrac * 100)}%`);
  }

  // 2. Every page: length and a playable keyboard.
  const pageNames = ["play", "osc1", "osc2", "osc3", "filter", "mod", "fx"];
  const hasBar = await evalIn(page, "!!document.querySelector('.mmth-window .mmth-pagebar')");
  check(hasBar, `${w}×${h}: the editor has a bottom page bar (Play · OSC 1 · OSC 2 · OSC 3 · Filter · Mod · FX)`);
  const pagesToCheck = hasBar ? pageNames : [null];
  let longest = { name: "", over: -1 };
  for (const name of pagesToCheck) {
    if (name) await gotoPage(name);
    const bodyInfo = await evalIn(page, BODY);
    const screens = bodyInfo.sh / Math.max(1, bodyInfo.ch);
    const limit = phone || landscape ? 2 : 2.5;
    check(screens <= limit + 0.01, `${w}×${h}: page "${name || "all"}" is ${screens.toFixed(2)} screens long (limit ${limit})`);
    const kp = await keysPlayable();
    check(kp.ok, `${w}×${h}: keyboard visible and playable on "${name || "all"}"`, kp.why || "");
    if (bodyInfo.sh - bodyInfo.ch > longest.over) longest = { name: name || "all", over: bodyInfo.sh - bodyInfo.ch };
    const hs = await evalIn(page, `document.querySelector('.mmth-window .mmth-body').scrollWidth - document.querySelector('.mmth-window .mmth-body').clientWidth`);
    check(hs <= 1, `${w}×${h}: no horizontal scroll on "${name || "all"}"`, String(hs));
  }
  if (hasBar) await gotoPage("play");

  // 3. Octave label matches the keys on screen.
  const oct = await evalIn(
    page,
    `(() => { const lbl = document.querySelector('.mmth-window .mmth-oct-label'); const ks = Array.from(document.querySelectorAll('.mmth-window .mmth-key')).filter((k) => k.getClientRects().length); if (!lbl || !ks.length) return { ok: false, text: '' }; const last = ks[ks.length - 1].getAttribute('aria-label'); const first = ks[0].getAttribute('aria-label'); return { ok: lbl.textContent.trim() === first + '–' + last, text: lbl.textContent.trim(), keys: ks.length, expect: first + '–' + last }; })()`
  );
  check(oct.ok, `${w}×${h}: octave label matches the keys shown`, `"${oct.text}" vs "${oct.expect}" (${oct.keys} keys)`);
  if (phone || landscape) check(oct.keys === 12, `${w}×${h}: a phone shows one octave (12 keys)`, String(oct.keys));

  // 4. Gestures, on a page that scrolls.
  if (hasBar) {
    // find the longest page
    let best = null;
    for (const name of pageNames) {
      await gotoPage(name);
      const b = await evalIn(page, BODY);
      if (!best || b.sh - b.ch > best.over) best = { name, over: b.sh - b.ch };
    }
    await gotoPage(best.name);
    info(`longest page for gestures: "${best.name}" (${Math.max(0, best.over)}px of scroll)`);
  }
  // Swipe that starts on a knob: scrolls, changes nothing.
  const scrollPage = hasBar ? (await evalIn(page, BODY)).sh > (await evalIn(page, BODY)).ch + 40 : false;
  const k1 = await centre(await showingDial("k1"));
  const before1 = await evalIn(page, SNAP);
  const top1 = (await evalIn(page, BODY)).top;
  await touchSwipe(k1.x, k1.y, 0, -Math.min(260, k1.y - 20));
  const after1 = await evalIn(page, SNAP);
  const top1b = (await evalIn(page, BODY)).top;
  if (scrollPage) check(top1b > top1 + 20, `${w}×${h}: a vertical swipe starting on a knob scrolls the page`, `${top1} → ${top1b}`);
  check(before1.knobs === after1.knobs, `${w}×${h}: …and changes no knob`, "knob values moved");
  check(before1.mods === after1.mods && before1.slots === after1.slots, `${w}×${h}: …and assigns no modulation`);

  // Swipe that starts on a source handle (Play page has macro sources, Mod page has envelope sources).
  if (hasBar) await gotoPage("mod");
  const srcSel = hasBar ? '.mmth-src[data-src="env1"]' : '.mmth-src[data-src="env1"]';
  const src = await centre(srcSel).catch(() => null);
  if (src) {
    const b0 = await evalIn(page, SNAP);
    const t0 = (await evalIn(page, BODY)).top;
    await touchSwipe(src.x, src.y, 0, -Math.min(220, src.y - 20));
    const b1 = await evalIn(page, SNAP);
    const t1 = (await evalIn(page, BODY)).top;
    check(b0.knobs === b1.knobs && b0.mods === b1.mods, `${w}×${h}: a swipe starting on a source handle changes nothing`);
    if (t1 === t0 && (await evalIn(page, BODY)).sh > (await evalIn(page, BODY)).ch + 40) check(false, `${w}×${h}: a swipe starting on a source handle scrolls`, "did not scroll");
  } else check(false, `${w}×${h}: source handle on screen`);

  // Sideways drag on a knob turns it.
  if (hasBar) await gotoPage("filter");
  const cut = await centre('.mmth-knob[data-param="filter1.cutoff"] .mmth-dial');
  const cutBefore = await evalIn(page, `document.querySelector('.mmth-knob[data-param="filter1.cutoff"] .mmth-dial').getAttribute('aria-valuenow')`);
  const scrollBefore = (await evalIn(page, BODY)).top;
  await touchSwipe(cut.x, cut.y, -70, 0);
  const cutAfter = await evalIn(page, `document.querySelector('.mmth-knob[data-param="filter1.cutoff"] .mmth-dial').getAttribute('aria-valuenow')`);
  check(cutBefore !== cutAfter, `${w}×${h}: a sideways drag on a knob turns it`, `${cutBefore} → ${cutAfter}`);
  check((await evalIn(page, BODY)).top === scrollBefore, `${w}×${h}: …and the page does not scroll`);

  // Tap-to-assign: source tap, knob tap, 2 taps total; never while scrolling.
  if (hasBar) await gotoPage("mod");
  const e1 = await centre('.mmth-src[data-src="env1"]');
  await touchTap(e1.x, e1.y);
  const armed = await evalIn(page, "document.querySelector('.mmth-window').classList.contains('mmth-arming')");
  check(armed, `${w}×${h}: tapping a source arms it`);
  const banner = await evalIn(page, "(() => { const b = document.querySelector('.mmth-window .mmth-banner'); return !!b && !b.hidden && /Tap a knob/.test(b.textContent) && /Cancel/.test(b.textContent); })()");
  check(banner, `${w}×${h}: a sticky banner tells you to tap a knob, with Cancel`);
  // a swipe on a knob while armed: no routing
  const env2 = await centre(await showingDial("env2"));
  const m0 = await evalIn(page, SNAP);
  await touchSwipe(env2.x, env2.y, 0, -Math.min(200, env2.y - 20));
  const m1 = await evalIn(page, SNAP);
  check(m0.mods === m1.mods, `${w}×${h}: a swipe while armed does not assign the source`, `${m0.mods} → ${m1.mods}`);
  const armedStill = await evalIn(page, "document.querySelector('.mmth-window').classList.contains('mmth-arming')");
  if (!armedStill) {
    await touchTap(e1.x, e1.y);
  }
  if (hasBar) await gotoPage("osc1");
  const tgt = await centre('.mmth-knob[data-param="osc1.pos"] .mmth-dial');
  await touchTap(tgt.x, tgt.y);
  const m2 = await evalIn(page, SNAP);
  check(m2.mods === m1.mods + 1, `${w}×${h}: then a tap on a knob assigns Envelope 1 (2 taps)`, `${m1.mods} → ${m2.mods}`);
  const disarmed = await evalIn(page, "!document.querySelector('.mmth-window').classList.contains('mmth-arming')");
  check(disarmed, `${w}×${h}: the banner clears after the assignment`);

  // Knob sheet: tap a knob (no movement) opens it; slider, steps and Reset.
  if (hasBar) await gotoPage("filter");
  const kr = await centre('.mmth-knob[data-param="filter1.res"] .mmth-dial');
  await touchTap(kr.x, kr.y);
  const sheetOpen = await waitFor("(() => { const s = document.querySelector('.mmth-window .mmth-ksheet'); return !!s && !s.hidden; })()", 2000);
  check(sheetOpen, `${w}×${h}: tapping a knob opens the knob sheet`);
  if (sheetOpen) {
    const sh = await evalIn(page, `(() => { const s = document.querySelector('.mmth-window .mmth-ksheet'); const b = s.getBoundingClientRect(); const sl = s.querySelector('input[type=range]'); const sb = sl.getBoundingClientRect(); return { inside: b.left >= -0.5 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5, sliderW: sb.width, slider: sb.height, reset: !!s.querySelector('[data-act=reset]'), hasMods: !!s.querySelector('[data-act=add]') }; })()`);
    check(sh.inside && sh.sliderW >= w * 0.6 && sh.reset && sh.hasMods, `${w}×${h}: the sheet fits the screen and has a full-width slider, Reset and modulation`, JSON.stringify(sh));
    await evalIn(page, `document.querySelector('.mmth-window .mmth-ksheet [data-act=plus]').click()`);
    const v1 = await evalIn(page, `document.querySelector('.mmth-window .mmth-ksheet input[type=range]').value`);
    await evalIn(page, `document.querySelector('.mmth-window .mmth-ksheet [data-act=reset]').click()`);
    const dflt = await evalIn(page, `document.querySelector('.mmth-window .mmth-ksheet input[type=range]').dataset.default`);
    const v2 = await evalIn(page, `document.querySelector('.mmth-window .mmth-ksheet input[type=range]').value`);
    check(v2 === dflt && v1 !== dflt, `${w}×${h}: Reset returns the knob to its default`, `value ${v2}, default ${dflt}`);
    await evalIn(page, `document.querySelector('.mmth-window .mmth-ksheet [data-act=close]').click()`);
    await sleep(120);
  }

  // 5. Status messages stay out of the keyboard.
  if (hasBar) await gotoPage("play");
  await evalIn(page, "document.querySelector('.mmth-window .mmth-presetbar button[aria-label=\"Next preset\"]').click()");
  await sleep(150);
  const st = await evalIn(page, `(() => { const f = document.querySelector('.mmth-window .mmth-flash'); const t = document.getElementById('status-toast'); const k = document.querySelector('.mmth-window .mmth-keys'); const kr = k ? k.getBoundingClientRect() : null; const overlap = (q) => q && q.width > 0 && kr && q.bottom > kr.top && q.top < kr.bottom; const fl = f && !f.hidden && f.textContent.trim() ? f : null; return { flash: !!fl, toastVisible: !!t && !t.hidden, overlapToast: overlap(t && !t.hidden ? t.getBoundingClientRect() : null), overlapFlash: overlap(fl ? fl.getBoundingClientRect() : null) }; })()`);
  check(!st.overlapToast && !st.overlapFlash, `${w}×${h}: a status message does not cover the keyboard`, JSON.stringify(st));
  await evalIn(page, "document.querySelector('.mmth-window .mmth-presetbar button[aria-label=\"Previous preset\"]').click()");

  // 6. Dock controls: Hold latches notes, Panic silences them.
  const dock = await evalIn(page, "(() => { const h = document.querySelector('.mmth-window .mmth-hold'); const p = document.querySelector('.mmth-window .mmth-keys-ctl button[aria-label=\"Stop all sounding notes\"]'); const d = document.querySelector('.mmth-window .mmth-keys-ctl'); const b = d ? d.getBoundingClientRect() : null; return { hold: !!h, panic: !!p, ctlInside: !!b && b.bottom <= innerHeight + 0.5 }; })()");
  check(dock.hold && dock.panic && dock.ctlInside, `${w}×${h}: the keyboard dock has Hold and Panic on screen`, JSON.stringify(dock));
  // Phone-only: the one-row header holds ◂ name ▸ · menu · ✕.
  // Screenshot for the owner.
  await shot(page, `${SHOT_DIR}/synth-${w}x${h}.png`);

  // 7. Layout and accessibility on the open synth.
  const lay = await evalIn(
    page,
    `(() => {
      const win = document.querySelector('.mmth-window');
      const small = [];
      for (const el of win.querySelectorAll('*')) {
        if (!el.getClientRects().length) continue;
        const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!direct) continue;
        if (el.closest('.mmth-ksheet') && false) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 15) small.push((el.className || el.tagName) + ':' + fs);
      }
      const tiny = [];
      for (const el of win.querySelectorAll('button, select, input, [role=slider]')) {
        if (!el.getClientRects().length) continue;
        if (el.classList.contains('mmth-key') || el.classList.contains('mmth-step')) continue;
        if (el.closest('.mmth-keys')) continue;
        if (el.type === 'range' && el.closest('.mmth-pop-row')) continue;
        const rr = el.getBoundingClientRect();
        if (rr.width < 43.5 || rr.height < 43.5) tiny.push((el.className || el.tagName) + ' ' + Math.round(rr.width) + 'x' + Math.round(rr.height));
      }
      return { small: small.slice(0, 6), smallCount: small.length, tiny: tiny.slice(0, 8), tinyCount: tiny.length,
        doc: document.scrollingElement.scrollWidth - innerWidth };
    })()`
  );
  check(lay.smallCount === 0, `${w}×${h}: text in the synth is at least 15px`, lay.small.join(" "));
  check(lay.tinyCount === 0, `${w}×${h}: every control is at least 44×44`, lay.tiny.join(" | "));
  check(lay.doc <= 0, `${w}×${h}: no horizontal page scroll`, String(lay.doc));

  // Close (✕) and make sure the page is clean.
  await evalIn(page, "document.querySelector('.mmth-window .mmth-close').click()");
  await sleep(150);
  check(await evalIn(page, "document.querySelector('.mmth-window').hidden"), `${w}×${h}: ✕ closes the synth`);
}

check(page.pageErrors.length === 0, "no uncaught page errors", page.pageErrors.slice(0, 3).join(" | "));
const errs = page.consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND|net::ERR/.test(e));
check(errs.length === 0, "no console errors", errs.slice(0, 3).join(" | "));

server.stop();
console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail === 0 ? "MOBILE UX AUDIT PASS" : `MOBILE UX AUDIT FAIL (${fail})`);
console.log(`Screenshots: ${SHOT_DIR}`);
process.exit(fail ? 1 : 0);
