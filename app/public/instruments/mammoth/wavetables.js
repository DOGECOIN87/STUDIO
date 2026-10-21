/**
 * Mammoth — procedural wavetables.
 *
 * Every table is generated here from math (no sampled or third-party data):
 * 16 frames per table, 2048 samples per frame, and 11 band-limited mip levels
 * per frame (level L keeps at most 1024 >> L harmonics), built with an FFT so
 * the oscillator can pick an alias-free level for any pitch.
 *
 * Memory layout of `data` (Float32Array):
 *   [level][frame][SIZE + 1]   — the extra guard sample repeats sample 0 so the
 *   oscillator can interpolate without wrapping.
 */

export const TABLE_SIZE = 2048;
export const TABLE_FRAMES = 16;
export const TABLE_LEVELS = 11;

const TAU = Math.PI * 2;

/* ----------------------------------------------------------------- helpers */

function frac(x) {
  return x - Math.floor(x);
}
function sinC(x) {
  return Math.sin(TAU * x);
}
function tri(x) {
  x = frac(x);
  return x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
}
function saw(x) {
  x = frac(x + 0.5);
  return 2 * x - 1;
}
function square(x) {
  return frac(x) < 0.5 ? 1 : -1;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
/** Deterministic PRNG so every build of a table is identical. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

/* ------------------------------------------------------------- definitions */

// Formant centres (Hz) for the vowel table, voiced as if the note were 110 Hz.
const VOWEL_FORMANTS = [
  [800, 1150, 2900],
  [400, 1700, 2600],
  [300, 2200, 3000],
  [450, 800, 2830],
  [325, 700, 2530],
];

const SCRAP_SEEDS = [11, 23, 37, 51, 77];

/**
 * Each definition provides either `gen(t, x)` (time domain: morph t∈[0,1],
 * phase x∈[0,1)) or `spec(t, n)` (harmonic amplitude of harmonic n, phase 0
 * sine series). Names are original to this instrument.
 */
const DEFS = [
  {
    name: "Sine-Saw",
    gen(t, x) {
      if (t < 0.5) return lerp(sinC(x), tri(x), t * 2);
      return lerp(tri(x), saw(x), (t - 0.5) * 2);
    },
  },
  {
    name: "Square-Saw",
    gen(t, x) {
      return lerp(square(x), saw(x), t);
    },
  },
  {
    name: "Pulse Width",
    gen(t, x) {
      const w = 0.5 - 0.47 * t;
      return frac(x) < w ? 1 : -1;
    },
  },
  {
    name: "Additive Odd",
    spec(t, n) {
      if (n % 2 === 0) return 0;
      const count = 1 + t * 44;
      const k = (n + 1) / 2;
      if (k > count + 1) return 0;
      const fade = Math.min(1, count + 1 - k);
      return fade / n;
    },
  },
  {
    name: "Additive Full",
    spec(t, n) {
      const p = lerp(3.2, 0.62, t);
      return 1 / Math.pow(n, p);
    },
  },
  {
    name: "Formant Vox",
    spec(t, n) {
      const pos = t * (VOWEL_FORMANTS.length - 1);
      const a = Math.floor(pos);
      const b = Math.min(VOWEL_FORMANTS.length - 1, a + 1);
      const f = pos - a;
      const hz = n * 110;
      let amp = 0;
      for (let k = 0; k < 3; k++) {
        const fc = lerp(VOWEL_FORMANTS[a][k], VOWEL_FORMANTS[b][k], f);
        const bw = 90 + fc * 0.08;
        const d = (hz - fc) / bw;
        amp += [1, 0.55, 0.3][k] * Math.exp(-0.5 * d * d);
      }
      return (amp + 0.015 / n) / Math.sqrt(n);
    },
  },
  {
    name: "Sync Sweep",
    gen(t, x) {
      const r = 1 + t * 7;
      return saw(frac(x) * r) * (1 - 0.15 * t);
    },
  },
  {
    name: "Fold",
    gen(t, x) {
      const g = 1 + t * 7;
      return Math.sin(g * Math.sin(TAU * x) * (Math.PI / 2));
    },
  },
  {
    name: "Metallic",
    spec(t, n) {
      if (n !== 1 && !isPrime(n)) return 0;
      const centre = lerp(Math.log(2), Math.log(160), t);
      const d = Math.log(n) - centre;
      return (n === 1 ? 0.6 : 1) * Math.exp(-(d * d) / 0.9) / Math.pow(n, 0.25);
    },
  },
  {
    name: "Resonant Chirp",
    gen(t, x) {
      const r = 1 + t * 15;
      const ph = frac(x);
      return Math.sin(TAU * ph * r) * (1 - ph) * 1.2 + saw(x) * 0.15;
    },
  },
  {
    name: "Digital Steps",
    gen(t, x) {
      const q = Math.max(2, Math.round(lerp(32, 2, t)));
      const hold = Math.max(1, Math.round(lerp(1, 48, t * t)));
      const xs = Math.floor(frac(x) * TABLE_SIZE / hold) * hold / TABLE_SIZE;
      return Math.round(Math.sin(TAU * xs) * q) / q;
    },
  },
  {
    name: "Organ Bars",
    spec(t, n) {
      // Four registrations morphed in turn.
      const regs = [
        { 1: 1, 2: 0.7, 3: 0.5 },
        { 1: 1, 2: 0.8, 4: 0.6, 8: 0.4 },
        { 1: 0.8, 3: 0.7, 5: 0.5, 6: 0.4, 8: 0.35 },
        { 1: 0.7, 2: 0.6, 3: 0.6, 4: 0.5, 6: 0.45, 8: 0.45, 10: 0.3, 12: 0.3, 16: 0.25 },
      ];
      const pos = t * (regs.length - 1);
      const a = Math.floor(pos);
      const b = Math.min(regs.length - 1, a + 1);
      const f = pos - a;
      return lerp(regs[a][n] || 0, regs[b][n] || 0, f);
    },
  },
  {
    name: "Growl Comb",
    spec(t, n) {
      const d = lerp(0.03, 0.48, t);
      return Math.abs(Math.cos(Math.PI * n * d)) / Math.pow(n, 0.85);
    },
  },
  {
    name: "Scrap",
    spec(t, n) {
      const pos = t * (SCRAP_SEEDS.length - 1);
      const a = Math.floor(pos);
      const b = Math.min(SCRAP_SEEDS.length - 1, a + 1);
      const f = pos - a;
      const ra = mulberry32(SCRAP_SEEDS[a] * 1000 + n)();
      const rb = mulberry32(SCRAP_SEEDS[b] * 1000 + n)();
      const r = lerp(ra, rb, f);
      return (r * r) / Math.pow(n, 0.75);
    },
  },
  {
    name: "Saw Stack",
    gen(t, x) {
      return (saw(x) + t * 0.6 * saw(2 * x + 0.13) + t * t * 0.45 * saw(3 * x + 0.31) + t * t * t * 0.3 * saw(4 * x + 0.07)) / (1 + t);
    },
  },
  {
    name: "Warm Harmonics",
    spec(t, n) {
      if (n === 1) return 1;
      if (n > 9) return 0;
      return Math.pow(t, (n - 1) * 0.6) * (n % 2 === 0 ? 0.75 : 0.5) / (n - 0.5);
    },
  },
];

export const TABLE_NAMES = DEFS.map((d) => d.name);

/* --------------------------------------------------------------------- FFT */

/** In-place iterative radix-2 complex FFT (sign −1 forward, +1 inverse, unscaled). */
function fft(re, im, sign) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * TAU) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k + half] * cr - im[i + k + half] * ci;
        const ai = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k + half] = re[i + k] - ar;
        im[i + k + half] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/* ------------------------------------------------------------------- build */

const cache = new Map();

/**
 * Builds (or returns the cached) table `index`.
 * @returns {{index:number,name:string,frames:number,size:number,levels:number,data:Float32Array}}
 */
export function buildWavetable(index) {
  const i = Math.max(0, Math.min(DEFS.length - 1, index | 0));
  if (cache.has(i)) return cache.get(i);
  const def = DEFS[i];
  const N = TABLE_SIZE;
  const F = TABLE_FRAMES;
  const L = TABLE_LEVELS;
  const stride = N + 1;
  const data = new Float32Array(L * F * stride);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const hRe = new Float64Array(N / 2);
  const hIm = new Float64Array(N / 2);

  for (let f = 0; f < F; f++) {
    const t = F === 1 ? 0 : f / (F - 1);
    // 1. Harmonic content of this frame.
    hRe.fill(0);
    hIm.fill(0);
    if (def.spec) {
      // Sine series: harmonic n has amplitude a → spectrum bin −i·a/2 (scaled below).
      for (let n = 1; n < N / 2; n++) {
        const a = def.spec(t, n) || 0;
        hRe[n] = 0;
        hIm[n] = -a;
      }
    } else {
      for (let s = 0; s < N; s++) {
        re[s] = def.gen(t, s / N);
        im[s] = 0;
      }
      fft(re, im, -1);
      for (let n = 1; n < N / 2; n++) {
        hRe[n] = (re[n] * 2) / N;
        hIm[n] = (im[n] * 2) / N;
      }
    }
    // 2. Every level is rendered from the same spectrum; level 0 sets the peak normaliser.
    let norm = 1;
    for (let lvl = 0; lvl < L; lvl++) {
      const cap = Math.max(1, Math.min(N / 2 - 1, 1024 >> lvl));
      re.fill(0);
      im.fill(0);
      for (let n = 1; n <= cap; n++) {
        // x(t) = Σ (hRe cos − hIm sin) … build the conjugate-symmetric spectrum.
        re[n] = hRe[n] / 2;
        im[n] = hIm[n] / 2;
        re[N - n] = hRe[n] / 2;
        im[N - n] = -hIm[n] / 2;
      }
      fft(re, im, 1);
      if (lvl === 0) {
        let peak = 0;
        for (let s = 0; s < N; s++) peak = Math.max(peak, Math.abs(re[s]));
        norm = peak > 1e-9 ? 1 / peak : 0;
      }
      const base = (lvl * F + f) * stride;
      for (let s = 0; s < N; s++) data[base + s] = re[s] * norm;
      data[base + N] = data[base];
    }
  }
  const table = { index: i, name: def.name, frames: F, size: N, levels: L, data };
  cache.set(i, table);
  return table;
}

/** Peaks of one frame (level 0) for drawing the wavetable preview in the editor. */
export function framePreview(table, position, points = 96) {
  const F = table.frames;
  const stride = table.size + 1;
  const fp = Math.max(0, Math.min(1, position)) * (F - 1);
  const f0 = Math.floor(fp);
  const f1 = Math.min(F - 1, f0 + 1);
  const ff = fp - f0;
  const out = new Float32Array(points);
  for (let p = 0; p < points; p++) {
    const s = Math.floor((p / points) * table.size);
    const a = table.data[f0 * stride + s];
    const b = table.data[f1 * stride + s];
    out[p] = a + (b - a) * ff;
  }
  return out;
}
