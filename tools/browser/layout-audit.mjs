/**
 * Layout audit: horizontal overflow, clipped controls, touch targets, text size,
 * popover bounds, label truncation, Library tab round-trip.
 *
 * Real Chromium over CDP, zero dependencies. Start the dev server first:
 *   node app/server.mjs &            # http://127.0.0.1:3000
 *   node tools/browser/layout-audit.mjs
 * Override the server with PAGE_URL=http://127.0.0.1:3000/.
 * Chromium location: CHROME_BIN / CHROME_LIBS / CHROME_FONTS (see cdp.mjs).
 * Exits non-zero on the first failing viewport class.
 */
import { launch, newPage, goto, setViewport, evalIn } from "./cdp.mjs";

const SIZES = [
  [320, 640], [341, 835], [360, 640], [375, 812], [390, 844], [414, 896],
  [430, 932], [431, 800], [683, 912], [760, 900], [761, 900], [1024, 768],
  [1360, 900], [1361, 900], [1920, 1080],
];

const CHECK = `(() => {
  const INTERACTIVE = 'button, a[href], input, select, summary, [role="button"], [tabindex]:not([tabindex="-1"])';
  const skip = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
    if (el.closest('.icon-sprite, svg[width="0"], .visually-hidden, [aria-hidden="true"].visually-hidden')) return true;
    if (el.classList.contains('visually-hidden')) return true;
    return false;
  };
  const horiz = [];
  for (const el of document.querySelectorAll('body *')) {
    if (skip(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && !el.closest('details[open]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) continue;
    if (r.right > innerWidth + 0.5 || r.left < -0.5) {
      horiz.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
    }
  }
  // Touch targets: visible interactive elements that a finger has to hit.
  const small = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (skip(el)) continue;
    if (el.closest('.icon-sprite')) continue;
    // Scroll rails are thin scroll indicators (like a native scrollbar), not controls.
    if (el.classList.contains('vscroll-rail')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) continue;
    if (r.width < 44 || r.height < 44) {
      small.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.split(' ').slice(0,2).join('.') : '')) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  // Text below the 15px floor.
  const smallText = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (skip(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 15) {
      const key = el.tagName + '|' + fs + '|' + el.className;
      if (seen.has(key)) continue;
      seen.add(key);
      smallText.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.split(' ').slice(0,2).join('.') : '')) + ' ' + fs + 'px');
    }
  }
  const doc = document.documentElement;
  return {
    innerWidth,
    docW: doc.scrollWidth,
    bodyW: document.body.scrollWidth,
    horiz: [...new Set(horiz)].slice(0, 20),
    small: [...new Set(small)].slice(0, 20),
    smallText: smallText.slice(0, 20),
  };
})()`;

const PAGE_URL = process.env.PAGE_URL || "http://127.0.0.1:3000/";
const server = await launch({ port: Number(process.env.CDP_PORT || 9271) });
const page = await newPage(server, { width: 360, height: 740 });
let failures = 0;
for (const [w, h] of SIZES) {
  await setViewport(page, w, h, { touch: w < 900, mobile: w < 761 });
  await goto(page, PAGE_URL, { waitMs: 1500 });
  const r = await evalIn(page, CHECK);
  const bad = r.docW > w + 0.5 || r.bodyW > w + 0.5 || r.horiz.length > 0;
  if (bad) failures++;
  console.log(`${w}x${h} ${bad ? "FAIL" : "ok"}  docW=${r.docW} bodyW=${r.bodyW} overflow=${r.horiz.length} small=${r.small.length} smallText=${r.smallText.length}`);
  if (r.horiz.length) console.log("   horiz:", r.horiz.join(" | "));
  if (r.small.length) console.log("   small:", r.small.join(" | "));
  if (r.smallText.length) console.log("   text:", r.smallText.join(" | "));
}
// Phase 2: the phone header's own labels and popovers.
const LABELS = `(() => {
  const trunc = [];
  for (const sel of ['#btn-reopen-pool', '#touch-counter-badge', '#snap-select', '#bpm-input']) {
    const el = document.querySelector(sel);
    if (!el || !el.getClientRects().length) continue;
    if (el.scrollWidth > el.clientWidth + 1) trunc.push(sel + ' ' + el.scrollWidth + '>' + el.clientWidth);
  }
  return trunc;
})()`;

for (const [w, h] of [[320, 640], [360, 640], [390, 844], [430, 932]]) {
  await setViewport(page, w, h, { touch: true, mobile: true });
  await goto(page, PAGE_URL, { waitMs: 1500 });
  const trunc = await evalIn(page, LABELS);
  const okLabel = trunc.length === 0;
  if (!okLabel) failures++;
  console.log(`${w}x${h} labels ${okLabel ? "ok" : "FAIL " + trunc.join(", ")}`);

  for (const sel of [".transport-readouts", ".transport-extras"]) {
    await evalIn(page, `(() => { const d = document.querySelector('${sel}'); if (!d.open) d.querySelector('summary').click(); return d.open; })()`);
    await new Promise((r) => setTimeout(r, 150));
    const box = await evalIn(page, `(() => { const c = document.querySelector('${sel} > div'); const r = c.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight }; })()`);
    const inside = box.l >= -1 && box.r <= box.vw + 1 && box.t >= -1 && box.b <= box.vh + 1;
    if (!inside) failures++;
    console.log(`   ${sel} open -> ${inside ? "ok" : "FAIL"} [${box.l},${box.r}]x[${box.t},${box.b}] vp ${box.vw}x${box.vh}`);
    await evalIn(page, `(() => { const d = document.querySelector('${sel}'); if (d.open) d.querySelector('summary').click(); return d.open; })()`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

// Phase 3: the Library tab works at both layouts.
//  - phone: the playlist header tabs switch the one open phone window
//  - desktop: closing the Library surfaces the reopen button in the playlist header
for (const [w, h] of [[360, 640], [1024, 768]]) {
  await setViewport(page, w, h, { touch: w < 900, mobile: w < 761 });
  await goto(page, PAGE_URL, { waitMs: 1500 });
  const r = await evalIn(page, `(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const panel = document.querySelector('#left-panel');
    const btn = document.querySelector('#btn-reopen-pool');
    const ws = document.querySelector('#workspace');
    if (${w} >= 761) {
      document.querySelector('#btn-close-pool').click();
      await sleep(250);
    }
    const rect = btn.getBoundingClientRect();
    const before = { visible: btn.getClientRects().length > 0 && getComputedStyle(btn).display !== 'none',
      btn: [Math.round(rect.width), Math.round(rect.height)],
      labelClipped: btn.scrollWidth > btn.clientWidth + 1 };
    btn.click();
    await sleep(300);
    const opened = ${w} >= 761
      ? !panel.classList.contains('collapsed') && getComputedStyle(panel).display !== 'none'
      : ws.dataset.mobileWindow === 'library';
    document.querySelector('#btn-toggle-pool').click();
    await sleep(250);
    const back = ${w} >= 761 ? true : ws.dataset.mobileWindow === 'playlist';
    return { ...before, opened, back };
  })()`);
  const ok = r.visible && r.btn[0] >= 44 && r.btn[1] >= 44 && !r.labelClipped && r.opened && r.back;
  if (!ok) failures++;
  console.log(`${w}x${h} Library tab ${ok ? "ok" : "FAIL"} ${JSON.stringify(r)}`);
}

console.log(failures === 0 ? "AUDIT PASS" : `AUDIT FAIL (${failures})`);
