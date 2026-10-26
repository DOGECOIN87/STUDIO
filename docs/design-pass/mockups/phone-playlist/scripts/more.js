// Preview only: three ways to open "more options" on top of the Minimal layout.
// window.__M = 'V1' (action bar) | 'V2' (floating button) | 'V3' (tap a lane); window.__OPEN = true/false.
(() => {
  const M = window.__M || 'V1';
  const OPEN = !!window.__OPEN;
  const ws = document.getElementById('workspace').getBoundingClientRect();
  const slider = document.getElementById('hscroll-slider');
  let row = slider;
  while (row.parentElement && row.parentElement.getBoundingClientRect().width < ws.width * .9) row = row.parentElement;
  const rowTop = row.getBoundingClientRect().top;
  const W = innerWidth, Hs = innerHeight;
  const NS = window.__NS || 15;
  const nameW = Math.round(NS * 7.2), tlW = ws.width - nameW;
  const laneH = Math.max(44, Math.floor((rowTop - ws.top - 32) / 9));
  const selY = ws.top + 32 + 4 * laneH;

  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:60;pointer-events:none;color:#F6F8FC;font-size:15px;';
  document.body.appendChild(layer);
  const el = (css, html, parent = layer) => { const e = document.createElement('div'); e.style.cssText = css; e.innerHTML = html || ''; parent.appendChild(e); return e; };
  const ic = (n, s = 20) => `<svg class="icon" aria-hidden="true" style="width:${s}px;height:${s}px;flex:none"><use href="#i-${n}"/></svg>`;
  const svgPath = (d, s = 20) => `<svg viewBox="0 0 24 24" style="width:${s}px;height:${s}px;flex:none" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const I = {
    draw: ic('pencil'), select: ic('square-dashed-mouse-pointer'), smooth: ic('spline'), copy: ic('copy'), undo: ic('undo-2'), redo: ic('redo-2'),
    more: ic('ellipsis'), up: ic('chevron-up'), x: ic('x'), clear: ic('trash-2'), mute: ic('volume-x'), loop: ic('repeat'), metro: ic('metronome'),
    flag: ic('flag'), save: ic('save'), exp: ic('download'), settings: ic('settings'), plus: ic('plus'),
    step: svgPath('M3 18h6V8h6v8h6'), line: svgPath('M3 18 21 6'), rec: `<svg viewBox="0 0 24 24" style="width:20px;height:20px;flex:none"><circle cx="12" cy="12" r="7" fill="#F9344C"/></svg>`,
    solo: '<span style="font-weight:800;width:20px;text-align:center">S</span>',
  };
  const BTN = 'display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 12px;border-radius:12px;background:#353A51;border:1px solid rgba(246,248,252,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 2px 6px rgba(0,0,0,.35);font-weight:600;white-space:nowrap;';
  const ON = 'background:linear-gradient(135deg,#C011D6 0%,#8A1FD6 55%,#5B23E1 100%);border-color:rgba(255,255,255,.2);';
  const chip = (icon, label, on) => `<div style="${BTN}${on ? ON : ''}flex-direction:column;gap:4px;min-height:64px;padding:6px 4px;">${icon}<span>${label}</span></div>`;
  const pill = (icon, label, on) => `<div style="${BTN}${on ? ON : ''}">${icon}<span>${label}</span></div>`;
  const title = t => `<div style="font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#A6AAC0;margin:14px 0 8px">${t}</div>`;
  const grid = (cols, items) => `<div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:8px">${items.join('')}</div>`;
  const scrim = () => el('position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(8,8,16,.6)');
  const laneTag = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#1BA1F1;margin-right:8px;vertical-align:1px"></span>`;
  const sheet = (heightPct, inner) => {
    scrim();
    return el(`position:absolute;left:0;right:0;bottom:0;height:${heightPct}%;background:#242538;border-radius:18px 18px 0 0;border-top:1px solid rgba(246,248,252,.14);box-shadow:0 -12px 32px rgba(0,0,0,.55);padding:8px 16px 16px;overflow:hidden`,
      `<div style="width:40px;height:5px;border-radius:3px;background:#6C718A;margin:2px auto 10px"></div>` + inner);
  };
  const sheetHead = t => `<div style="display:flex;align-items:center;justify-content:space-between"><div style="font-size:18px;font-weight:700">${laneTag}${t}</div><div style="${BTN}width:44px;padding:0;background:transparent;border-color:transparent;box-shadow:none">${I.x}</div></div>`;

  if (M === 'V1') {
    const barH = 72;
    el(`position:absolute;left:0;right:0;top:${rowTop - barH}px;height:${barH}px;background:#1F2032;border-top:1px solid rgba(246,248,252,.12);padding:4px 8px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;align-items:center`,
      [chip(I.draw, 'Draw', true), chip(I.smooth, 'Curve'), chip(I.copy, 'Copy'), chip(I.undo, 'Undo'), chip(I.up, 'More')].join(''));
    if (OPEN) {
      sheet(66, sheetHead('Synth Arp · Delay mix') +
        title('This lane') + grid(3, [chip(I.draw, 'Draw', true), chip(I.select, 'Select'), chip(I.clear, 'Clear'), chip(I.smooth, 'Smooth'), chip(I.step, 'Step'), chip(I.line, 'Line')]) +
        title('Playback') + grid(4, [chip(I.loop, 'Loop', true), chip(I.metro, 'Click'), chip(I.rec, 'Record'), chip(I.flag, 'Marker')]) +
        title('Track') + grid(4, [chip(I.mute, 'Mute'), chip(I.solo, 'Solo'), chip(I.plus, 'Lane'), chip(I.settings, 'Setup')]));
    }
  }

  if (M === 'V2') {
    const fx = tlW - 64 - 4, fy = rowTop - 64 - 12;
    if (OPEN) {
      scrim();
      const items = [[I.more, 'All options'], [I.undo, 'Undo'], [I.clear, 'Clear lane'], [I.step, 'Step curve'], [I.smooth, 'Smooth curve'], [I.draw, 'Draw points', true]];
      items.forEach(([icn, lbl, on], k) => el(`position:absolute;right:${W - tlW + 4}px;top:${fy - (k + 1) * 54}px;`, pill(icn, lbl, on)));
    }
    el(`position:absolute;left:${fx}px;top:${fy}px;width:64px;height:64px;border-radius:50%;${ON}display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(126,27,204,.7),inset 0 1px 0 rgba(255,255,255,.25)`,
      OPEN ? ic('x', 26) : ic('pencil', 26));
  }

  if (M === 'V3') {
    if (!OPEN) {
      // toolbar pops up above the lane you tapped, pointing at your finger
      const tw = 5 * 44 + 4 * 4 + 12, tx = Math.max(6, Math.min(tlW - tw - 6, 70)), ty = selY - 44 - 22;
      el(`position:absolute;left:${tx}px;top:${ty}px;padding:6px;border-radius:14px;background:#2F3348;border:1px solid rgba(246,248,252,.16);box-shadow:0 10px 24px rgba(0,0,0,.55);display:flex;gap:4px`,
        [I.draw, I.smooth, I.step, I.clear, I.more].map((icn, k) => `<div style="${BTN}width:44px;padding:0;${k === 0 ? ON : ''}">${icn}</div>`).join(''));
      el(`position:absolute;left:${tx + 100}px;top:${ty + 56}px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:9px solid #2F3348`);
      el(`position:absolute;left:${tx + 104}px;top:${selY + laneH / 2 - 14}px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.85)`);
    } else {
      sheet(70, sheetHead('Synth Arp · Delay mix') +
        title('This lane controls') +
        `<div style="display:flex;flex-wrap:wrap;gap:8px">${['Volume', 'Pan', 'Filter', 'Delay mix', 'Reverb', 'Feedback'].map(p => `<div style="${BTN}${p === 'Delay mix' ? ON : ''}border-radius:999px;padding:0 16px">${p}</div>`).join('')}</div>` +
        title('Curve') + grid(3, [chip(I.smooth, 'Smooth', true), chip(I.step, 'Step'), chip(I.line, 'Line')]) +
        title('Track') + grid(4, [chip(I.mute, 'Mute'), chip(I.solo, 'Solo'), chip(I.copy, 'Copy'), chip(I.clear, 'Delete')]));
    }
  }
})();
