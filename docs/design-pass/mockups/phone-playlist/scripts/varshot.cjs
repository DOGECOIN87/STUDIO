// Usage: node varshot.cjs <variant.css|none> <tag> [sizes]
// Loads the app, injects the variant CSS, screenshots the full screen and reports the playlist height.
const { chromium } = require('playwright');
const fs = require('fs');
const H = require('/home/user/DAW/docs/design-pass/harness/lib.cjs');
const [css, tag, sizes = '360x640t'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const c of sizes.split(',')) {
    const m = c.match(/(\d+)x(\d+)(t?)/); const w = +m[1], h = +m[2], touch = !!m[3];
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(H.URL, { waitUntil: 'networkidle' });
    if (process.env.VARJS) await p.evaluate(fs.readFileSync(process.env.VARJS, 'utf8'));
    if (css && css !== 'none') await p.addStyleTag({ content: fs.readFileSync(css, 'utf8') });
    await p.waitForTimeout(700);
    if (process.env.VARJS_AFTER) { await p.evaluate(process.env.VARJS_PRE || ''); await p.evaluate(fs.readFileSync(process.env.VARJS_AFTER, 'utf8')); if (process.env.VARJS_AFTER2) await p.evaluate(fs.readFileSync(process.env.VARJS_AFTER2, 'utf8')); await p.waitForTimeout(200); }
    const r = await H.probe(p, touch);
    const pl = await p.evaluate(() => { const e = document.getElementById('timeline-viewport'); const r = e.getBoundingClientRect(); return Math.round(Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); });
    await p.screenshot({ path: `${__dirname}/variants/${tag}-${c}.png` });
    console.log(`${tag} ${c}: playlist ${pl}px tall | hscroll=${r.hscroll.length} off=${r.off.length} overlaps=${r.overlaps.length ? r.overlaps.slice(0, 3).join(',') : 0} tiny=${r.tiny.length} small=${touch ? (r.small.length ? r.small.slice(0, 3).join(' / ') : 0) : '-'} errors=${errs.length ? errs[0] : 'none'}`);
    await ctx.close();
  }
  await b.close();
})();
