/**
 * The synth windows' display screens: small glowing CRT-style canvases that draw the
 * sound — oscillator waves, filter curves, envelopes, the LFO — and, while a window
 * is open, a live oscilloscope, spectrum and an analog VU meter of what it plays.
 * Colours come from the window's skin (--an-lcd, --an-lcd-ink, --an-lcd-glow).
 */

/** A screen: a bezel with a canvas (and room for text laid over it). */
export function makeScreen(className = "") {
  const wrap = document.createElement("div");
  wrap.className = `an-screen ${className}`.trim();
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  wrap.appendChild(canvas);
  return { wrap, canvas };
}

/** Sizes the canvas to its box (sharp on high-DPI screens); returns null while hidden. */
function fit(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const g = canvas.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(canvas);
  return {
    g,
    w: W,
    h: H,
    dpr,
    ink: cs.getPropertyValue("--an-lcd-ink").trim() || "#9dffbe",
    glow: cs.getPropertyValue("--an-lcd-glow").trim() || "rgba(120,255,170,0.45)",
  };
}

function grid(s, cols = 8, rows = 4) {
  const { g, w, h, ink } = s;
  g.save();
  g.globalAlpha = 0.1;
  g.strokeStyle = ink;
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < cols; i++) {
    const x = Math.round((w * i) / cols) + 0.5;
    g.moveTo(x, 0);
    g.lineTo(x, h);
  }
  for (let j = 1; j < rows; j++) {
    const y = Math.round((h * j) / rows) + 0.5;
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();
  g.restore();
}

/** Strokes a path of points with the phosphor glow, optionally filling down to `base`. */
function trace(s, pts, { alpha = 1, width = 1.7, fill = false, base = null } = {}) {
  const { g, ink, glow, dpr, h } = s;
  if (pts.length < 2) return;
  g.save();
  if (fill) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, glow);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.globalAlpha = 0.55 * alpha;
    g.beginPath();
    g.moveTo(pts[0][0], base == null ? h : base);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(pts[pts.length - 1][0], base == null ? h : base);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = alpha;
  g.strokeStyle = ink;
  g.lineWidth = width * dpr;
  g.lineJoin = "round";
  g.shadowColor = glow;
  g.shadowBlur = 7 * dpr;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
  g.restore();
}

/** One cycle of a wave shape at phase p (0..1), -1..1. Noise uses a fixed pattern. */
export function shapeAt(shape, p) {
  p -= Math.floor(p);
  switch (shape) {
    case "sine":
      return Math.sin(2 * Math.PI * p);
    case "triangle":
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    case "sawtooth":
      return p < 0.5 ? 2 * p : 2 * p - 2;
    case "square":
      return p < 0.5 ? 1 : -1;
    case "noise": {
      const i = Math.floor(p * 97);
      const x = Math.sin(i * 12.9898) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    }
    default:
      return 0;
  }
}

/** An oscillator: two cycles of its wave; unison copies drawn faint and slightly shifted. */
export function drawWave(canvas, { wave, level = 1, unison = 1, spread = 0, on = true }) {
  const s = fit(canvas);
  if (!s) return;
  grid(s, 8, 2);
  const { w, h } = s;
  const amp = (h / 2 - 5 * s.dpr) * (0.25 + 0.75 * level);
  const steps = wave === "noise" ? 194 : Math.max(60, Math.round(w / 2));
  const line = (shift, alpha) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push([t * w, h / 2 - shapeAt(wave, t * 2 + shift) * amp]);
    }
    trace(s, pts, { alpha: on ? alpha : alpha * 0.3 });
  };
  const n = Math.max(1, unison);
  if (n > 1) for (let u = 1; u < n; u++) line((u / n) * Math.min(0.5, spread / 60), 0.35);
  line(0, 1);
}

const biquads = new WeakMap();
const FREQS = (() => {
  const f = new Float32Array(160);
  for (let i = 0; i < f.length; i++) f[i] = 20 * Math.pow(1000, i / (f.length - 1));
  return f;
})();

/** A filter's response from 20 Hz to 20 kHz (−36 … +24 dB), with the cutoff marked. */
export function drawFilter(canvas, audioCtx, { type, cutoff, reso }) {
  const s = fit(canvas);
  if (!s || !audioCtx) return;
  grid(s, 10, 4);
  let bq = biquads.get(audioCtx);
  if (!bq) {
    bq = audioCtx.createBiquadFilter();
    biquads.set(audioCtx, bq);
  }
  bq.type = type;
  bq.frequency.value = cutoff;
  bq.Q.value = reso;
  const mag = new Float32Array(FREQS.length);
  const ph = new Float32Array(FREQS.length);
  bq.getFrequencyResponse(FREQS, mag, ph);
  const { w, h } = s;
  const yOf = (db) => h - ((Math.max(-36, Math.min(24, db)) + 36) / 60) * h;
  const pts = [];
  for (let i = 0; i < FREQS.length; i++) pts.push([(i / (FREQS.length - 1)) * w, yOf(20 * Math.log10(Math.max(1e-6, mag[i])))]);
  trace(s, pts, { fill: true });
  const cx = (Math.log(cutoff / 20) / Math.log(1000)) * w;
  const { g } = s;
  g.save();
  g.globalAlpha = 0.45;
  g.strokeStyle = s.ink;
  g.setLineDash([3 * s.dpr, 3 * s.dpr]);
  g.beginPath();
  g.moveTo(cx, 0);
  g.lineTo(cx, h);
  g.stroke();
  g.restore();
}

/** An envelope's shape: attack, decay to sustain, a held stretch, release. */
export function drawEnv(canvas, { a, d, s: sus, r }) {
  const s = fit(canvas);
  if (!s) return;
  grid(s, 8, 4);
  const { w, h, dpr } = s;
  const top = 5 * dpr;
  const bottom = h - 4 * dpr;
  const yOf = (v) => bottom - v * (bottom - top);
  // Square-root time keeps short and long stages both visible.
  const A = Math.sqrt(a);
  const D = Math.sqrt(d);
  const R = Math.sqrt(r);
  const hold = (A + D + R) * 0.35 + 0.15;
  const total = A + D + hold + R;
  const xOf = (t) => (t / total) * w;
  const pts = [[0, yOf(0)], [xOf(A), yOf(1)]];
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    pts.push([xOf(A + D * t), yOf(sus + (1 - sus) * Math.exp(-4 * t))]);
  }
  pts.push([xOf(A + D + hold), yOf(sus)]);
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    pts.push([xOf(A + D + hold + R * t), yOf(sus * Math.exp(-5 * t))]);
  }
  trace(s, pts, { fill: true, base: bottom });
}

/** The LFO's wave (depth sets its height) and a dot riding it at the LFO's rate. */
export function drawLfo(canvas, { shape, depth, rate, target }, timeSec) {
  const s = fit(canvas);
  if (!s) return;
  grid(s, 8, 2);
  const { w, h, dpr } = s;
  const off = target === "off";
  const amp = (h / 2 - 6 * dpr) * (off ? 0.05 : 0.15 + 0.85 * depth);
  const pts = [];
  const steps = Math.max(60, Math.round(w / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([t * w, h / 2 - shapeAt(shape, t * 2) * amp]);
  }
  trace(s, pts, { alpha: off ? 0.35 : 1 });
  if (off) return;
  const ph = (timeSec * rate) % 2;
  const x = (ph / 2) * w;
  const y = h / 2 - shapeAt(shape, ph) * amp;
  const { g } = s;
  g.save();
  g.fillStyle = s.ink;
  g.shadowColor = s.glow;
  g.shadowBlur = 10 * dpr;
  g.beginPath();
  g.arc(x, y, 3.2 * dpr, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/* ------------------------------------------------------------- live taps */
const taps = new WeakMap();

/** An analyser listening to a live synth (its `output` node), made once per synth. */
export function tapOf(synth) {
  if (!synth || !synth.output || !synth.ctx) return null;
  let t = taps.get(synth);
  if (!t) {
    const an = synth.ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.72;
    synth.output.connect(an);
    t = { an, time: new Float32Array(an.fftSize), freq: new Float32Array(an.frequencyBinCount) };
    taps.set(synth, t);
  }
  return t;
}

/** RMS level of what the synth is playing now (0..1). */
export function levelOf(tap) {
  if (!tap) return 0;
  tap.an.getFloatTimeDomainData(tap.time);
  let sum = 0;
  for (let i = 0; i < tap.time.length; i++) sum += tap.time[i] * tap.time[i];
  return Math.sqrt(sum / tap.time.length);
}

/**
 * The live scope: the waveform (held still on a rising zero crossing) over a faint
 * spectrum. Silence draws a resting line.
 */
export function drawScope(canvas, tap, { spectrum = true } = {}) {
  const s = fit(canvas);
  if (!s) return;
  grid(s, 12, 4);
  const { w, h, dpr, g } = s;
  if (tap && spectrum) {
    tap.an.getFloatFrequencyData(tap.freq);
    const bins = tap.freq.length;
    const sr = tap.an.context.sampleRate;
    g.save();
    g.fillStyle = s.ink;
    g.globalAlpha = 0.16;
    const bars = 64;
    for (let b = 0; b < bars; b++) {
      const f0 = 30 * Math.pow(16000 / 30, b / bars);
      const f1 = 30 * Math.pow(16000 / 30, (b + 1) / bars);
      const i0 = Math.max(1, Math.floor((f0 / (sr / 2)) * bins));
      const i1 = Math.max(i0 + 1, Math.floor((f1 / (sr / 2)) * bins));
      let m = -140;
      for (let i = i0; i < i1 && i < bins; i++) m = Math.max(m, tap.freq[i]);
      const v = Math.max(0, Math.min(1, (m + 100) / 80));
      const bw = w / bars;
      g.fillRect(b * bw + dpr, h - v * h, bw - 2 * dpr, v * h);
    }
    g.restore();
  }
  const pts = [];
  if (tap) {
    const d = tap.time;
    tap.an.getFloatTimeDomainData(d);
    let start = 0;
    for (let i = 1; i < d.length / 2; i++) {
      if (d[i - 1] <= 0 && d[i] > 0) {
        start = i;
        break;
      }
    }
    const span = Math.min(d.length - start, 1024);
    let peak = 0;
    for (let i = 0; i < span; i++) peak = Math.max(peak, Math.abs(d[start + i]));
    const gain = peak > 0.001 ? Math.min(6, 0.85 / peak) : 1;
    for (let i = 0; i < span; i += 2) pts.push([(i / span) * w, h / 2 - d[start + i] * gain * (h / 2 - 4 * dpr)]);
  } else {
    pts.push([0, h / 2], [w, h / 2]);
  }
  trace(s, pts, { width: 1.6 });
}

/**
 * An analog VU meter (cream face, black scale, red zone above 0 VU, a needle with
 * ballistics). `state` keeps the needle between frames. 0 VU = −14 dBFS RMS.
 */
export function drawVu(canvas, rms, state) {
  const s = fit(canvas);
  if (!s) return;
  const { g, w, h, dpr } = s;
  const db = 20 * Math.log10(Math.max(1e-6, rms)) + 14;
  const target = Math.max(0, Math.min(1, (db + 20) / 23)); // −20 … +3 VU
  state.v = state.v == null ? target : state.v + (target - state.v) * (target > state.v ? 0.35 : 0.12);
  const face = g.createLinearGradient(0, 0, 0, h);
  face.addColorStop(0, "#fff6dc");
  face.addColorStop(1, "#e8d9a8");
  g.fillStyle = face;
  g.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 1.32;
  const R = h * 1.08;
  const ang = (t) => (-50 + 100 * t) * (Math.PI / 180);
  const at = (t, r) => [cx + r * Math.sin(ang(t)), cy - r * Math.cos(ang(t))];
  g.lineWidth = 1.2 * dpr;
  const marks = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
  for (const m of marks) {
    const t = (m + 20) / 23;
    const [x0, y0] = at(t, R * 0.86);
    const [x1, y1] = at(t, R * (m % 5 === 0 || m >= 0 ? 0.97 : 0.93));
    g.strokeStyle = m > 0 ? "#c0261c" : "#1b1b1b";
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  // Red zone arc
  g.strokeStyle = "#c0261c";
  g.lineWidth = 3 * dpr;
  g.beginPath();
  g.arc(cx, cy, R * 0.9, -Math.PI / 2 + ang(20 / 23), -Math.PI / 2 + ang(1));
  g.stroke();
  g.fillStyle = "#1b1b1b";
  g.font = `700 ${Math.round(15 * dpr)}px sans-serif`;
  g.textAlign = "center";
  g.fillText("VU", cx, h * 0.72);
  // Needle
  const [nx, ny] = at(state.v, R * 0.98);
  g.strokeStyle = "#111";
  g.lineWidth = 1.6 * dpr;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(nx, ny);
  g.stroke();
  // Glass glare
  const glare = g.createLinearGradient(0, 0, w, h);
  glare.addColorStop(0, "rgba(255,255,255,0.35)");
  glare.addColorStop(0.5, "rgba(255,255,255,0)");
  g.fillStyle = glare;
  g.fillRect(0, 0, w, h * 0.5);
}

/** Draws a list of sample points (-1..1) as one glowing cycle, e.g. a wavetable frame. */
export function drawWavePoints(canvas, pts) {
  const s = fit(canvas);
  if (!s || !pts || !pts.length) return;
  grid(s, 8, 2);
  const { w, h, dpr } = s;
  const amp = h / 2 - 5 * dpr;
  const line = [];
  for (let i = 0; i < pts.length; i++) line.push([(i / (pts.length - 1)) * w, h / 2 - pts[i] * amp]);
  trace(s, line, { fill: true, base: h / 2 });
}
