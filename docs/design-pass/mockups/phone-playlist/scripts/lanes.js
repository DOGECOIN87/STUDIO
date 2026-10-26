// Preview only: draws the proposed phone playlist (automation lanes, names on the right,
// fixed playhead) over the real playlist area. window.__V picks the colour style
// (L1 track colour, L2 calm, L3 neon); window.__NS sets the name text size in px.
(() => {
  const V = window.__V || 'L1';
  const NS = window.__NS || 15;
  const ws = document.getElementById('workspace').getBoundingClientRect();
  const slider = document.getElementById('hscroll-slider');
  let bottom = ws.bottom;
  if (slider && slider.getBoundingClientRect().height) {
    let row = slider;
    while (row.parentElement && row.parentElement.getBoundingClientRect().width < ws.width * .9) row = row.parentElement;
    bottom = Math.min(bottom, row.parentElement ? row.getBoundingClientRect().top : slider.getBoundingClientRect().top - 12);
  }
  const W = ws.width, H = bottom - ws.top;
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = W * dpr; c.height = H * dpr;
  Object.assign(c.style, { position: 'fixed', left: ws.left + 'px', top: ws.top + 'px', width: W + 'px', height: H + 'px', zIndex: 40, pointerEvents: 'none' });
  document.body.appendChild(c);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const font = getComputedStyle(document.body).fontFamily;

  const C = { drums: '#CC0FE0', bass: '#8A3FFC', arp: '#1BA1F1', ost: '#B07CFF', lead: '#15D864' };
  const lanes = [
    { t: 'Drums', p: 'Volume', k: 'drums', pts: [[0, .72], [5.5, .72], [6.2, .22], [7.2, .72], [20, .72]] },
    { t: 'Drums', p: 'Filter', k: 'drums', smooth: b => .18 + .7 / (1 + Math.exp(-(b - 7) * .9)) },
    { t: 'Sub Bass', p: 'Volume', k: 'bass', pts: [[0, .3], [5, .3], [5, .82], [20, .82]] },
    { t: 'Synth Arp', p: 'Pan', k: 'arp', smooth: b => .5 + .32 * Math.sin(b * .9) },
    { t: 'Synth Arp', p: 'Delay mix', k: 'arp', smooth: b => .12 + .78 * Math.exp(-Math.pow((b - 6.5) / 1.3, 4)) },
    { t: 'Ostinato', p: 'Volume', k: 'ost', pts: [[0, .2], [3, .2], [13, .85], [20, .85]] },
    { t: 'Ostinato', p: 'Reverb', k: 'ost', smooth: b => .15 + .5 * Math.exp(-Math.pow((b - 10) / 1.6, 2)) },
    { t: 'Lead', p: 'Volume', k: 'lead', pts: [[0, .74], [20, .74]] },
    { t: 'Lead', p: 'Feedback', k: 'lead', pts: [[0, .8], [6, .2], [9, .2], [12, .9], [20, .9]] },
  ];
  const SEL = 4; // the lane being edited

  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const amp = (k, b) => {
    if (k === 'drums') { const ph = b % 1; return Math.min(1, .12 + .88 * Math.exp(-ph * 9) + (Math.floor(b) % 2 ? .3 * Math.exp(-ph * 5) : 0)); }
    if (k === 'bass') return .5 + .1 * Math.sin(b * .7);
    if (k === 'arp') return .18 + .62 * Math.exp(-((b * 4) % 1) * 4);
    if (k === 'ost') return .14 + .56 * Math.exp(-((b * 2) % 1) * 3);
    const p = b % 4, on = p < 1.6 || (p > 2 && p < 3.4);
    return on ? .9 * Math.pow(Math.sin(Math.PI * (p < 2 ? p / 1.6 : (p - 2) / 1.4)), .6) : .04;
  };

  const nameW = Math.round(NS * 7.2);
  const head = 32;
  const tlW = W - nameW;
  const laneH = Math.max(44, Math.floor((H - head) / lanes.length));
  const start = 2, ppb = tlW / 10; // ten beats visible, scrolled to beat 2
  const xOf = b => (b - start) * ppb;
  const playX = Math.round(tlW * .42);

  const S = {
    L1: { bg: '#1E1F2E', lane: k => C[k] + '2E', alt: null, wave: 'rgba(0,0,0,.42)', line: 'rgba(255,255,255,.92)', dot: '#FFFFFF', nameBg: '#202133', name: '#F6F8FC', sub: '#A6AAC0', grid: 'rgba(255,255,255,.06)' },
    L2: { bg: '#2A2D42', lane: () => '#2A2D42', alt: '#272A3E', wave: 'rgba(14,15,24,.55)', line: '#FF4D5E', dot: '#FF4D5E', nameBg: '#24263A', name: '#F6F8FC', sub: '#A6AAC0', grid: 'rgba(255,255,255,.05)' },
    L3: { bg: '#121320', lane: () => '#121320', alt: '#151626', wave: k => C[k] + '8C', line: '#FFFFFF', dot: '#FFFFFF', nameBg: '#161728', name: k => C[k], sub: '#A6AAC0', grid: 'rgba(255,255,255,.05)', glow: true },
  }[V];
  const val = (x, k) => (typeof x === 'function' ? x(k) : x);

  g.fillStyle = S.bg; g.fillRect(0, 0, W, H);

  // ruler
  g.fillStyle = '#1A1B29'; g.fillRect(0, 0, tlW, head);
  g.fillStyle = 'rgba(204,15,224,.10)'; g.fillRect(xOf(8), 0, xOf(12) - xOf(8), H); // loop band
  g.fillStyle = 'rgba(204,15,224,.55)'; g.fillRect(xOf(8), 0, xOf(12) - xOf(8), 4);
  g.font = `600 15px ${font}`; g.fillStyle = '#A6AAC0'; g.textBaseline = 'middle';
  for (let b = 0; b < 20; b++) {
    const x = xOf(b); if (x < -1 || x > tlW) continue;
    if (b % 4 === 0) { g.fillStyle = '#A6AAC0'; g.fillText(String(b / 4 + 1), x + 5, head / 2 + 1); g.fillRect(x, head - 10, 1, 10); }
    else { g.fillStyle = 'rgba(166,170,192,.35)'; g.fillRect(x, head - 5, 1, 5); }
  }

  lanes.forEach((ln, i) => {
    const y = head + i * laneH, mid = y + laneH / 2;
    g.fillStyle = (S.alt && i % 2) ? S.alt : val(S.lane, ln.k); g.fillRect(0, y, tlW, laneH);
    if (i === SEL) { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, y, tlW, laneH); }
    // beat grid
    for (let b = 0; b < 20; b++) { const x = xOf(b); if (x < 0 || x > tlW) continue; g.fillStyle = b % 4 ? S.grid : 'rgba(255,255,255,.12)'; g.fillRect(x, y, 1, laneH); }
    // waveform silhouette
    g.fillStyle = val(S.wave, ln.k);
    g.beginPath(); g.moveTo(0, mid);
    const pts = [];
    for (let x = 0; x <= tlW; x += 1.5) { const b = start + x / ppb; const a = amp(ln.k, b) * (.82 + .18 * rnd()) * (laneH * .4); pts.push([x, a]); g.lineTo(x, mid - a); }
    for (let j = pts.length - 1; j >= 0; j--) g.lineTo(pts[j][0], mid + pts[j][1]);
    g.closePath(); g.fill();
    // automation curve
    const yOf = v => y + 7 + (1 - v) * (laneH - 14);
    let curve;
    if (ln.smooth) { curve = []; for (let b = 0; b <= 20; b += .35) curve.push([b, ln.smooth(b)]); }
    else curve = ln.pts;
    g.save();
    if (S.glow) { g.shadowColor = C[ln.k]; g.shadowBlur = 6; }
    g.strokeStyle = S.line; g.lineWidth = i === SEL ? 2.5 : 2; g.lineJoin = 'round';
    g.beginPath(); curve.forEach(([b, v], j) => { const x = xOf(b), yy = yOf(v); j ? g.lineTo(x, yy) : g.moveTo(x, yy); }); g.stroke();
    g.restore();
    g.fillStyle = S.dot;
    curve.forEach(([b, v]) => { const x = xOf(b); if (x < -4 || x > tlW + 4) return; g.beginPath(); g.arc(x, yOf(v), i === SEL ? 4 : 2.2, 0, Math.PI * 2); g.fill(); });
    if (i === SEL) { g.strokeStyle = '#1B1C2A'; g.lineWidth = 1.5; curve.forEach(([b, v]) => { const x = xOf(b); if (x < -4 || x > tlW + 4) return; g.beginPath(); g.arc(x, yOf(v), 4, 0, Math.PI * 2); g.stroke(); }); }
    // lane separator
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y + laneH - 1, W, 1);
    // name column (right)
    g.fillStyle = i === SEL ? '#2E3148' : S.nameBg; g.fillRect(tlW, y, nameW, laneH - 1);
    g.fillStyle = C[ln.k]; g.fillRect(tlW, y, 3, laneH - 1);
    g.textBaseline = 'alphabetic';
    g.font = `700 ${NS}px ${font}`; g.fillStyle = val(S.name, ln.k);
    g.fillText(ln.t, tlW + 10, y + laneH / 2 - 2, nameW - 14);
    g.font = `500 ${NS}px ${font}`; g.fillStyle = S.sub;
    g.fillText(ln.p, tlW + 10, y + laneH / 2 + NS - 1, nameW - 14);
  });

  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(tlW - 1, 0, 1, H);
  // fixed playhead
  g.fillStyle = '#FFFFFF'; g.fillRect(playX, 0, 1.5, H);
  g.beginPath(); g.moveTo(playX - 6, 0); g.lineTo(playX + 7.5, 0); g.lineTo(playX + .75, 9); g.closePath(); g.fill();
})();
