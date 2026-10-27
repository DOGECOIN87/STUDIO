const H = require('./lib.cjs');
(async () => {
  const b = await H.launch();
  for (const vp of H.CORE) {
    const s = await H.open(b, vp);
    await H.shot(s.page, `shots/before/${vp}-app.png`);
    console.log(H.report(vp + ' app', await H.probe(s.page, s.touch), s.errors));
    await s.ctx.close();
    for (const win of ['step', 'piano', 'mixer', 'inspector', 'trellis']) {
      const t = await H.open(b, vp);
      await H.openWindow(t.page, win);
      await H.shot(t.page, `shots/before/${vp}-${win}.png`);
      await t.ctx.close();
    }
  }
  await b.close();
})();
