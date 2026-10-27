/**
 * STUDIO — Sweep Filter (built-in effect, plain JavaScript DSP).
 * 24 dB/oct low-pass: two state-variable (TPT) stages, resonance on the second,
 * optional soft drive, smoothed cutoff (no zipper noise when swept) and a mix.
 */
const STATE = new WeakMap();
const cutoffHz = (v) => 20 * Math.pow(1000, Math.min(1, Math.max(0, v)));

export const PLUGIN = {
  name: "Sweep Filter",
  version: "1.0.0",
  params: [
    { id: "cutoff", name: "Cutoff", min: 0, max: 1, default: 1, unit: "Hz", format: "freq" },
    { id: "resonance", name: "Resonance", min: 0, max: 1, default: 0.2, unit: "%", format: "percent" },
    { id: "drive", name: "Drive", min: 0, max: 1, default: 0, unit: "%", format: "percent" },
    { id: "mix", name: "Mix", min: 0, max: 1, default: 1, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Open", values: { cutoff: 1, resonance: 0.2, drive: 0, mix: 1 } },
    { name: "Warm", values: { cutoff: 0.72, resonance: 0.15, drive: 0.15, mix: 1 } },
    { name: "Muffled", values: { cutoff: 0.45, resonance: 0.25, drive: 0, mix: 1 } },
    { name: "Acid", values: { cutoff: 0.55, resonance: 0.8, drive: 0.4, mix: 1 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      s = { fc: cutoffHz(params.cutoff), z: new Float64Array(8) };
      STATE.set(params, s);
    }
    const target = Math.min(cutoffHz(params.cutoff), sampleRate * 0.45);
    const k2 = 2 - 1.95 * Math.min(1, Math.max(0, params.resonance));
    const drive = 1 + params.drive * 5;
    const mix = params.mix;
    const z = s.z;
    const smooth = 1 - Math.exp(-1 / (sampleRate * 0.01));
    let fc = s.fc;
    let g = 0;
    let a1 = 0;
    let a2 = 0;
    let a3 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    for (let i = 0; i < frames; i++) {
      if ((i & 15) === 0) {
        fc += (target - fc) * Math.min(1, smooth * 16);
        g = Math.tan((Math.PI * fc) / sampleRate);
        a1 = 1 / (1 + g * (g + 2));
        a2 = g * a1;
        a3 = g * a2;
        b1 = 1 / (1 + g * (g + k2));
        b2 = g * b1;
        b3 = g * b2;
      }
      for (let c = 0; c < 2; c++) {
        let x = c ? inR[i] : inL[i];
        const dry = x;
        if (drive > 1) x = Math.tanh(x * drive) / Math.tanh(drive);
        const o = c * 4;
        // stage 1 (no resonance)
        let v3 = x - z[o + 1];
        let v1 = a1 * z[o] + a2 * v3;
        let v2 = z[o + 1] + a2 * z[o] + a3 * v3;
        z[o] = 2 * v1 - z[o];
        z[o + 1] = 2 * v2 - z[o + 1];
        // stage 2 (resonant)
        v3 = v2 - z[o + 3];
        v1 = b1 * z[o + 2] + b2 * v3;
        v2 = z[o + 3] + b2 * z[o + 2] + b3 * v3;
        z[o + 2] = 2 * v1 - z[o + 2];
        z[o + 3] = 2 * v2 - z[o + 3];
        const y = dry * (1 - mix) + v2 * mix;
        if (c) outR[i] = y;
        else outL[i] = y;
      }
    }
    s.fc = fc;
  },
};
