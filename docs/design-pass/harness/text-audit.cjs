// Text placement audit for Audius Studio: opens every window, menu, dialog and editor at each
// viewport, then measures every visible piece of text (DOM text, not canvas) for:
//   cut        text clipped by its box or an overflow:hidden ancestor, with no ellipsis
//   spill      text running outside its own box (overflow visible)
//   ellipsis   text shortened with "…" in the default state (reported with the share shown)
//   offcenter  a control's label off its centre (vertical, or horizontal when centred)
//   cramped    a label within 3px of the edge of a control that has a visible fill or border
//   overlap    two pieces of text drawn over each other
//   row        same-size text side by side in a row whose vertical centres differ by > 2px
//   ragged     stacked siblings of one kind whose left-aligned text starts at different x
//   wrapmix    sibling controls where some labels wrap to two lines and others don't
//   small      text under 15px
//
// Usage:  STUDIO_URL=http://127.0.0.1:8767/ NODE_PATH=/opt/node22/lib/node_modules \
//         node text-audit.cjs <outDir> [viewport,viewport,...] [state,state,...]
// Writes <outDir>/audit.json (every finding) and <outDir>/<viewport>-<state>.png per state.
const fs = require('fs');
const path = require('path');
const H = require('./lib.cjs');

const OUT = process.argv[2] || './text-audit-out';
const VPS = (process.argv[3] || '1440x900,1366x768,1024x1366t,1366x1024t,360x640t,640x360t').split(',');
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });

const LONG_TRACK = 'Extremely Long Track Name For Edge Case Checks 0123456789';
const LONG_PROJECT = 'My Very Long Project Title That Keeps Going And Going';

const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
const clickText = (p, sel, re) => p.evaluate(({ s, r }) => { const e = [...document.querySelectorAll(s)].find((x) => new RegExp(r, 'i').test(x.textContent) && x.checkVisibility()); if (!e) return false; e.click(); return true; }, { s: sel, r: re });

// Edge-case data: long track and project names, a 999.999 BPM tempo.
async function stress(p) {
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? LONG_TRACK : undefined));
  for (let i = 0; i < 2; i++) {
    const t = p.locator('.track-title').nth(i);
    if (await t.count()) await t.dblclick().catch(() => {});
    await p.waitForTimeout(150);
  }
  await p.evaluate(({ name }) => {
    const n = document.getElementById('project-name');
    if (n && n.tagName === 'INPUT') { n.value = name; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); }
    const b = document.getElementById('bpm-input');
    if (b) { b.value = '999.999'; b.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { name: LONG_PROJECT });
  await p.waitForTimeout(250);
}

// Each state: how to reach it. `phone` states only exist on compact layouts.
const STATES = [
  { id: 'home', open: async () => {} },
  { id: 'step', open: (p) => H.openWindow(p, 'step') },
  { id: 'piano', open: async (p) => { await H.openWindow(p, 'piano'); await click(p, '#btn-pr-tools'); } },
  { id: 'mixer', open: (p) => H.openWindow(p, 'mixer') },
  { id: 'pads', open: (p) => H.openWindow(p, 'trellis') },
  { id: 'pad-editor', open: async (p) => { await H.openWindow(p, 'trellis'); await click(p, '#btn-edit-pads'); } },
  { id: 'inspector', open: (p) => H.openWindow(p, 'inspector') },
  { id: 'library', open: (p) => H.openWindow(p, 'library') },
  { id: 'options', open: (p) => click(p, '#options-menu > summary') },
  { id: 'cuts', open: (p) => click(p, '#cuts-menu > summary') },
  { id: 'more', open: (p) => click(p, '#btn-more'), phone: true },
  { id: 'track-menu', open: (p) => click(p, '.trk-menu') },
  { id: 'synth-menu', open: (p) => click(p, '#btn-add-synth') },
  { id: 'export', open: (p) => click(p, '#btn-export-modal') },
  { id: 'shortcuts', open: (p) => click(p, '#btn-fl-shortcuts') },
  { id: 'projects', open: (p) => click(p, '#btn-load-proj') },
  { id: 'mammoth', open: async (p) => { await H.openWindow(p, 'step'); await p.waitForTimeout(200); await click(p, '.mmth-rack-edit'); } },
  { id: 'quartet', open: async (p) => { await click(p, '#btn-add-synth'); await p.waitForTimeout(200); await clickText(p, '.synth-menu .ctx-btn', 'Quartet'); } },
  { id: 'fx-menu', open: async (p) => { await H.openWindow(p, 'mixer'); await p.waitForTimeout(200); await click(p, '#btn-fx-add-plugin'); } },
  { id: 'plugin', open: async (p) => { await H.openWindow(p, 'mixer'); await p.waitForTimeout(200); await click(p, '#btn-fx-add-plugin'); await p.waitForTimeout(200); await p.evaluate(() => { const m = document.getElementById('fx-plugin-menu'); const b = m && [...m.querySelectorAll('button')].find((x) => x.checkVisibility()); if (b) b.click(); }); } },
  { id: 'gate', open: async (p) => { await H.openWindow(p, 'mixer'); await p.waitForTimeout(200); await click(p, '#fx-slot-gate'); } },
  { id: 'clip-menu', open: async (p) => { const c = await p.locator('#playlist-canvas, .playlist-canvas, #timeline-viewport canvas').first().boundingBox(); if (c) await p.mouse.click(c.x + 40, c.y + 60, { button: 'right' }); } },
  // Edge cases: long names and a 999.999 BPM tempo on the busiest views.
  { id: 'stress-home', stress: true, open: async () => {} },
  { id: 'stress-mixer', stress: true, open: (p) => H.openWindow(p, 'mixer') },
  { id: 'stress-inspector', stress: true, open: (p) => H.openWindow(p, 'inspector') },
];

// Runs in the page: every visible DOM text holder, measured.
function measure() {
  const W = innerWidth, Hh = innerHeight;
  const vis = (el) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < Hh && r.right > 0 && r.left < W;
  };
  const key = (e) => {
    const one = (x) => `${x.tagName.toLowerCase()}${x.id ? '#' + x.id : ''}${x.classList.length ? '.' + [...x.classList].slice(0, 2).join('.') : ''}`;
    const parts = [one(e)];
    let a = e.parentElement;
    while (a && parts.length < 3 && a !== document.body) { if (a.id || a.classList.length) parts.unshift(one(a)); a = a.parentElement; }
    return parts.join(' > ');
  };
  const CONTROL = 'button, summary, a[href], [role=button], [role=tab], [role=menuitem], label.toggle, .tool-btn, .tiny-btn';
  const textNodes = (e) => [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
  const rectOf = (nodes) => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity; const tops = new Set();
    for (const n of nodes) {
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) { if (q.width < 0.5) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); tops.add(Math.round(q.top)); }
    }
    return l === Infinity ? null : { l, t, r, b, w: r - l, h: b - t, lines: tops.size };
  };
  const pad = (cs) => ({ l: parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), r: parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth), t: parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth), b: parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth) });
  const visibleFill = (cs) => (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none';
  const f = (n) => Math.round(n * 10) / 10;

  // The part of a text rect a user can see: cut by the element's own box and by every
  // ancestor that clips or scrolls.
  const seen = (e, tr) => {
    let { l, t, r, b } = tr;
    for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const ar = a.getBoundingClientRect();
      if (acs.overflowX !== 'visible') { l = Math.max(l, ar.left); r = Math.min(r, ar.right); }
      if (acs.overflowY !== 'visible') { t = Math.max(t, ar.top); b = Math.min(b, ar.bottom); }
    }
    l = Math.max(l, 0); t = Math.max(t, 0); r = Math.min(r, W); b = Math.min(b, Hh);
    return r - l > 1 && b - t > 1 ? { l, t, r, b, w: r - l, h: b - t, lines: tr.lines } : null;
  };
  const holders = [];
  for (const e of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION', 'TEXTAREA', 'SELECT', 'svg', 'title', 'KBD'].includes(e.tagName)) continue;
    if (e.closest('#app-tooltip, .tooltip, .toast')) continue;
    const tn = textNodes(e);
    if (!tn.length || !vis(e)) continue;
    const bx = e.getBoundingClientRect();
    if (bx.width <= 2 || bx.height <= 2) continue; // screen-reader-only text
    const tr = rectOf(tn);
    if (!tr) continue;
    const sv = seen(e, tr);
    if (!sv) continue;
    holders.push({ e, tr, sv, text: tn.map((n) => n.textContent).join('').trim().replace(/\s+/g, ' ') });
  }

  const out = [];
  const add = (type, h, detail) => out.push({ type, key: key(h.e), text: h.text.slice(0, 60), detail, rect: { x: f(h.tr.l), y: f(h.tr.t), w: f(h.tr.w), h: f(h.tr.h) } });

  for (const h of holders) {
    const { e, tr } = h;
    const cs = getComputedStyle(e);
    const box = e.getBoundingClientRect();
    if (parseFloat(cs.fontSize) < 15) add('small', h, `font-size ${cs.fontSize}`);

    // Clipping: the element itself, then overflow:hidden/clip ancestors (scrollers excluded).
    const ellipsis = cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1;
    if (ellipsis) add('ellipsis', h, `shows ${f((e.clientWidth / e.scrollWidth) * 100)}% (${e.clientWidth}/${e.scrollWidth}px)`);
    else {
      let clip = null;
      for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
        const acs = getComputedStyle(a);
        const ox = acs.overflowX, oy = acs.overflowY;
        if (['hidden', 'clip'].includes(ox) || ['hidden', 'clip'].includes(oy)) {
          const ar = a.getBoundingClientRect();
          const cutX = ['hidden', 'clip'].includes(ox) && (tr.l < ar.left - 1 || tr.r > ar.right + 1);
          const cutY = ['hidden', 'clip'].includes(oy) && (tr.t < ar.top - 1 || tr.b > ar.bottom + 1);
          if (cutX || cutY) { clip = { a, cutX, cutY, ar }; break; }
        }
        if (['auto', 'scroll'].includes(acs.overflowX) || ['auto', 'scroll'].includes(acs.overflowY)) break;
      }
      if (clip) add('cut', h, `${clip.cutX ? 'sideways' : ''}${clip.cutX && clip.cutY ? '+' : ''}${clip.cutY ? 'vertically' : ''} by ${key(clip.a)} (text ${f(tr.l)}..${f(tr.r)} x ${f(tr.t)}..${f(tr.b)}, box ${f(clip.ar.left)}..${f(clip.ar.right)} x ${f(clip.ar.top)}..${f(clip.ar.bottom)})`);
      else if (cs.overflowX === 'visible' && (tr.r > box.right + 1.5 || tr.l < box.left - 1.5 || tr.b > box.bottom + 1.5)) add('spill', h, `text ${f(tr.l)}..${f(tr.r)} x ${f(tr.t)}..${f(tr.b)} outside box ${f(box.left)}..${f(box.right)} x ${f(box.top)}..${f(box.bottom)}`);
    }

    // Control labels: centred, with room to breathe.
    const ctl = e.matches(CONTROL) ? e : e.closest(CONTROL);
    if (ctl && vis(ctl) && !ellipsis) {
      const ccs = getComputedStyle(ctl);
      const cb = ctl.getBoundingClientRect();
      const p = pad(ccs);
      const inner = { l: cb.left + p.l, r: cb.right - p.r, t: cb.top + p.t, b: cb.bottom - p.b };
      // The label plus any icon beside it, as one group.
      let g = { ...tr };
      for (const ic of ctl.querySelectorAll('*')) {
        if (ic.contains(e) || !vis(ic) || textNodes(ic).length) continue;
        const ics = getComputedStyle(ic);
        if (ics.position === 'absolute' || ics.position === 'fixed') continue;
        const ir = ic.getBoundingClientRect();
        if (ir.width < 2 || ir.height < 2) continue;
        g = { l: Math.min(g.l, ir.left), r: Math.max(g.r, ir.right), t: Math.min(g.t, ir.top), b: Math.max(g.b, ir.bottom) };
      }
      const column = ccs.flexDirection === 'column' && ctl.querySelectorAll('*').length > 1;
      const ownText = [...ctl.querySelectorAll('*'), ctl].filter((x) => textNodes(x).length).length;
      if (tr.lines === 1 && ownText === 1 && !column) {
        const dy = (tr.t + tr.b) / 2 - (cb.top + cb.bottom) / 2;
        if (Math.abs(dy) > 2.5 && cb.height < 80) add('offcenter', h, `label ${dy > 0 ? 'low' : 'high'} by ${f(Math.abs(dy))}px in ${key(ctl)} (${f(cb.height)}px tall)`);
      }
      const flexy = /flex|grid/.test(ccs.display);
      // A flex row whose child stretches to fill it is laid out from the start, whatever justify-content says.
      const stretches = flexy && [...ctl.children].some((c) => parseFloat(getComputedStyle(c).flexGrow) > 0);
      const centred = flexy ? /center/.test(ccs.justifyContent) && !stretches : ['center', '-webkit-center'].includes(ccs.textAlign);
      if (centred && ownText === 1) {
        const dx = (g.l + g.r) / 2 - (inner.l + inner.r) / 2;
        if (Math.abs(dx) > 2.5 && g.r - g.l < inner.r - inner.l - 2) add('offcenter', h, `label group ${dx > 0 ? 'right' : 'left'} of centre by ${f(Math.abs(dx))}px in ${key(ctl)}`);
      }
      if (visibleFill(ccs)) {
        const gapL = tr.l - cb.left, gapR = cb.right - tr.r;
        if (Math.min(gapL, gapR) < 3 && tr.w > 6) add('cramped', h, `text ${f(gapL)}px / ${f(gapR)}px from the edges of ${key(ctl)}`);
      }
    }
  }

  // Overlapping text (not nested).
  const opaque = (el) => {
    const cs = getComputedStyle(el);
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const alpha = m ? (m[1].split(',')[3] === undefined ? 1 : parseFloat(m[1].split(',')[3])) : 0;
    return alpha >= 0.85 || (cs.backgroundImage !== 'none' && !/gradient\(.*rgba\(.*0\)/.test(cs.backgroundImage));
  };
  for (let i = 0; i < holders.length; i++) for (let j = i + 1; j < holders.length; j++) {
    const a = holders[i], b = holders[j];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const ox = Math.min(a.sv.r, b.sv.r) - Math.max(a.sv.l, b.sv.l), oy = Math.min(a.sv.b, b.sv.b) - Math.max(a.sv.t, b.sv.t);
    if (ox <= 2 || oy <= 2) continue;
    // Both texts must be painted at the overlap, not one hidden under an opaque layer.
    const cx = (Math.max(a.sv.l, b.sv.l) + Math.min(a.sv.r, b.sv.r)) / 2, cy = (Math.max(a.sv.t, b.sv.t) + Math.min(a.sv.b, b.sv.b)) / 2;
    const stack = document.elementsFromPoint(cx, cy);
    const ia = stack.findIndex((x) => a.e === x || a.e.contains(x));
    const ib = stack.findIndex((x) => b.e === x || b.e.contains(x));
    if (ia < 0 || ib < 0) continue;
    const lowerEl = stack[Math.max(ia, ib)];
    let covered = false;
    for (let k = Math.min(ia, ib) + 1; k < Math.max(ia, ib); k++) {
      if (stack[k].contains(lowerEl)) continue;
      if (opaque(stack[k])) { covered = true; break; }
    }
    if (!covered) add('overlap', a, `over "${b.text.slice(0, 30)}" (${key(b.e)}) by ${f(ox)}x${f(oy)}px`);
  }

  // Rows: same-size single-line text side by side whose centres differ.
  const byParent = new Map();
  for (const h of holders) {
    if (h.tr.lines !== 1) continue;
    const row = h.e.parentElement;
    if (!row) continue;
    const rcs = getComputedStyle(row);
    if (!/flex|grid/.test(rcs.display) || rcs.flexDirection === 'column') continue;
    if (!byParent.has(row)) byParent.set(row, []);
    byParent.get(row).push(h);
  }
  for (const [row, hs] of byParent) {
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j];
      const fa = parseFloat(getComputedStyle(a.e).fontSize), fb = parseFloat(getComputedStyle(b.e).fontSize);
      if (Math.abs(fa - fb) > 0.5) continue;
      const sideBySide = a.sv.r <= b.sv.l + 2 || b.sv.r <= a.sv.l + 2;
      const sameLine = Math.min(a.tr.b, b.tr.b) - Math.max(a.tr.t, b.tr.t) > Math.min(a.tr.h, b.tr.h) * 0.4;
      const dy = (a.tr.t + a.tr.b) / 2 - (b.tr.t + b.tr.b) / 2;
      if (sideBySide && sameLine && Math.abs(dy) > 2) add('row', a, `${f(Math.abs(dy))}px ${dy > 0 ? 'below' : 'above'} "${b.text.slice(0, 24)}" in ${key(row)}`);
    }
  }

  // Ragged left edges: stacked siblings of one class with left-aligned text.
  const groups = new Map();
  for (const h of holders) {
    const cs = getComputedStyle(h.e);
    if (!['left', 'start'].includes(cs.textAlign) || h.e.classList.length === 0) continue;
    const parent = h.e.parentElement && h.e.parentElement.parentElement;
    const k = (parent ? key(parent) : '') + '|' + h.e.className + '|' + Math.round(h.e.getBoundingClientRect().left);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }
  for (const hs of groups.values()) {
    if (hs.length < 3) continue;
    const lefts = hs.map((h) => h.tr.l);
    const spread = Math.max(...lefts) - Math.min(...lefts);
    if (spread > 1.5) add('ragged', hs[0], `${hs.length} items, text starts vary by ${f(spread)}px`);
  }

  // Mixed wrapping among sibling controls.
  const sib = new Map();
  for (const h of holders) {
    const ctl = h.e.matches(CONTROL) ? h.e : h.e.closest(CONTROL);
    if (!ctl || !ctl.parentElement) continue;
    if (!sib.has(ctl.parentElement)) sib.set(ctl.parentElement, new Map());
    const m = sib.get(ctl.parentElement);
    m.set(ctl, Math.max(m.get(ctl) || 0, h.tr.lines));
  }
  for (const [parent, m] of sib) {
    if (m.size < 2) continue;
    const lines = [...m.values()];
    if (Math.max(...lines) > 1 && Math.min(...lines) === 1) {
      const wrapped = [...m.entries()].filter(([, n]) => n > 1).map(([c]) => c.textContent.trim().replace(/\s+/g, ' ').slice(0, 24));
      out.push({ type: 'wrapmix', key: key(parent), text: wrapped.join(' | '), detail: `${wrapped.length} of ${m.size} controls wrap to two lines` });
    }
  }
  return out;
}

(async () => {
  const b = await H.launch();
  const all = [];
  for (const vp of VPS) {
    const touch = H.VPS[vp][2];
    const compact = vp.startsWith('360') || vp.startsWith('640');
    for (const st of STATES) {
      if (ONLY && !ONLY.includes(st.id)) continue;
      if (st.phone && !compact) continue;
      const { ctx, page, errors } = await H.open(b, vp);
      let ok = true;
      try {
        if (st.stress) await stress(page);
        await st.open(page);
        await page.waitForTimeout(450);
      } catch (err) { ok = false; errors.push('open failed: ' + err.message); }
      const shot = path.join(OUT, `${vp}-${st.id}.png`);
      await page.screenshot({ path: shot });
      const found = ok ? await page.evaluate(measure) : [];
      for (const x of found) all.push({ vp, touch, state: st.id, shot, ...x });
      const errs = [...new Set(errors.filter((e) => !/404/.test(e)))];
      console.log(`${vp} ${st.id}: ${found.length} findings${errs.length ? ' | errors: ' + errs.join(' | ') : ''}`);
      await ctx.close();
    }
  }
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(all, null, 1));
  await b.close();
})();
