// Shared Playwright harness for the Audius Studio design pass.
// Usage from a scene script:  const H = require('/tmp/claude-0/-home-user-DAW/717ea5f2-42d2-5656-8044-03574a727b85/scratchpad/design/lib.cjs')
// Run scripts with:  NODE_PATH=/opt/node22/lib/node_modules node script.cjs
// The app is served statically at http://127.0.0.1:8767/ (a background python http.server; do not start another).
const { chromium } = require('playwright');

const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8767/';

// Target viewports: name, width, height, touch
const VPS = {
  '1920x1080': [1920, 1080, false],
  '1440x900': [1440, 900, false],
  '1366x768': [1366, 768, false],
  '1024x1366t': [1024, 1366, true],
  '1366x1024t': [1366, 1024, true],
  '360x640t': [360, 640, true],
  '640x360t': [640, 360, true],
};
const CORE = ['1920x1080', '1366x768', '1024x1366t', '360x640t', '640x360t'];

// Window name -> [desktop toggle button id, window element id]
const WINDOWS = {
  library: [null, 'left-panel'],
  playlist: [null, 'timeline-viewport'],
  step: ['btn-toggle-channel-rack', 'channel-rack-window'],
  piano: ['btn-toggle-piano-roll', 'piano-roll-window'],
  mixer: ['btn-toggle-mixer', 'mixer-window'],
  inspector: ['btn-toggle-inspector', 'right-panel'],
  trellis: ['btn-toggle-trellis', 'trellis-dock'],
};

async function launch() { return chromium.launch(); }

// Open the app at a viewport. opts: { reducedMotion, colorScheme, theme, scale }
async function open(browser, vpName, opts = {}) {
  const [w, h, touch] = VPS[vpName];
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: opts.scale || (touch ? 2 : 1),
    isMobile: touch, hasTouch: touch,
    reducedMotion: opts.reducedMotion || 'no-preference',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (opts.theme) {
    await page.selectOption('#theme-select', opts.theme).catch(() => {});
    await page.waitForTimeout(300);
  }
  return { ctx, page, errors, touch, w, h, name: vpName };
}

// Open a studio window the way a user would: the phone tab on compact layouts, the toolbar toggle otherwise.
async function openWindow(page, win) {
  const how = await page.evaluate(({ win, btnId }) => {
    const tab = document.querySelector(`.mobile-window-switcher [data-mobile-window="${win}"]`);
    if (tab && tab.checkVisibility()) { tab.click(); return 'tab'; }
    if (!btnId) return 'always-open';
    const btn = document.getElementById(btnId); if (!btn) return 'no-button';
    btn.click(); return 'toggle';
  }, { win, btnId: WINDOWS[win][0] });
  await page.waitForTimeout(450);
  return how;
}

// Screenshot the full viewport, or crop to a selector (with padding). Returns the path.
async function shot(page, path, selector, pad = 0) {
  if (!selector) { await page.screenshot({ path }); return path; }
  const box = await page.evaluate(sel => {
    const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, selector);
  if (!box || box.width < 1 || box.height < 1) { await page.screenshot({ path }); return path; }
  const vw = page.viewportSize();
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const clip = { x, y, width: Math.min(vw.width - x, box.width + pad * 2), height: Math.min(vw.height - y, box.height + pad * 2) };
  await page.screenshot({ path, clip });
  return path;
}

// Regression probe: page width, sideways scrollers, off-screen controls, clipped text, text < 15px,
// touch targets < 44px (touch only), overlapping sibling controls. scope: optional selector.
async function probe(page, touch, scope) {
  return page.evaluate(({ touch, scope }) => {
    const root = scope ? document.querySelector(scope) : document.body;
    if (!root) return { missing: scope };
    const vis = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return el.checkVisibility() && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
    const key = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''}`;
    const group = arr => { const m = {}; arr.forEach(([k, v]) => { (m[k] = m[k] || []).push(v); }); return Object.entries(m).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} x${v.length} ${v.slice(0, 2).join(' | ')}`); };
    const W = innerWidth, H = innerHeight;
    const all = [...root.querySelectorAll('*')].filter(vis);
    const clipped = all.filter(e => e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map(e => [key(e), JSON.stringify(e.textContent.trim().slice(0, 24)) + ' ' + e.clientWidth + '/' + e.scrollWidth]);
    const tiny = all.filter(e => e.tagName !== 'KBD' && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15).map(e => [key(e), getComputedStyle(e).fontSize + ' ' + JSON.stringify(e.textContent.trim().slice(0, 16))]);
    const ctrls = all.filter(e => e.matches('button,select,input,summary,[role=button],a,label.toggle'));
    const small = ctrls.filter(e => { const r = e.getBoundingClientRect(); return e.type !== 'range' && (r.width < 44 || r.height < 44); }).map(e => { const r = e.getBoundingClientRect(); return [key(e), Math.round(r.width) + 'x' + Math.round(r.height)]; });
    const off = ctrls.filter(e => { const r = e.getBoundingClientRect(); return r.right > W + 1 || r.left < -1; }).map(e => key(e));
    const hscroll = [...document.querySelectorAll('*')].filter(e => vis(e) && e.scrollWidth > e.clientWidth + 2 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && !e.matches('#timeline-viewport, #timeline-viewport *, .piano-grid-scroll, canvas')).map(e => key(e) + ' ' + e.clientWidth + '/' + e.scrollWidth);
    // overlapping controls: pairs of visible controls whose boxes intersect by > 4px both ways and neither contains the other
    const boxes = ctrls.map(e => [e, e.getBoundingClientRect()]);
    const overlaps = [];
    for (let i = 0; i < boxes.length && overlaps.length < 12; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, ra] = boxes[i], [b, rb] = boxes[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 4 && oy > 4) overlaps.push(key(a) + ' ~ ' + key(b));
    }
    return {
      doc: document.documentElement.scrollWidth + '/' + W + (document.documentElement.scrollWidth > W ? ' OVERFLOW' : ''),
      hscroll, off: [...new Set(off)], overlaps,
      clipped: group(clipped), tiny: group(tiny),
      small: touch ? group(small) : [`(desktop, not required) ${small.length} under 44px`],
    };
  }, { touch, scope });
}

function report(label, r, errors) {
  const lines = [`##### ${label}  doc=${r.doc}  errors=${errors && errors.length ? [...new Set(errors)].slice(0, 3).join(' | ') : 'none'}`];
  if (r.missing) return lines.concat(['  scope missing: ' + r.missing]).join('\n');
  lines.push('  hscroll: ' + (r.hscroll.length ? r.hscroll.join(', ') : 'none'));
  lines.push('  off-screen controls: ' + (r.off.length ? r.off.join(', ') : 'none'));
  lines.push('  overlapping controls: ' + (r.overlaps.length ? r.overlaps.join(', ') : 'none'));
  lines.push('  clipped text:\n    ' + (r.clipped.join('\n    ') || 'none'));
  lines.push('  text < 15px:\n    ' + (r.tiny.join('\n    ') || 'none'));
  lines.push('  small targets:\n    ' + (r.small.join('\n    ') || 'none'));
  return lines.join('\n');
}

module.exports = { URL, VPS, CORE, WINDOWS, launch, open, openWindow, shot, probe, report };
