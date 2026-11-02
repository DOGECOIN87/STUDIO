/**
 * STUDIO — Drive (built-in effect, plain JavaScript DSP).
 * Tanh waveshaper with level compensation, a 12 dB/oct tone low-pass after the
 * shaper, dry/wet mix and an output trim. Ported from the LYNX SHARE
 * distortion (AGPL-3.0): drive 0…36 dB, tone 800 Hz…20 kHz, output ±12 dB.
 */
const STATE = new WeakMap();
const dbToGain = (db) => Math.pow(10, db / 20);

function lowpass(fc, sampleRate) {
  // RBJ cookbook low-pass, Q = 0.707
  const w = (2 * Math.PI * Math.min(fc, sampleRate * 0.45)) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * 0.7071);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export const PLUGIN = {
  name: "Drive",
  version: "1.0.0",
  params: [
    { id: "drive", name: "Drive", min: 0, max: 36, default: 14, unit: "dB", format: "db" },
    { id: "tone", name: "Tone", min: 800, max: 20000, default: 9000, unit: "Hz", format: "hz" },
    { id: "mix", name: "Mix", min: 0, max: 1, default: 1, unit: "%", format: "percent" },
    { id: "output", name: "Output", min: -12, max: 12, default: 0, unit: "dB", format: "db" },
  ],
  presets: [
    { name: "Warm", values: { drive: 6, tone: 12000, mix: 1, output: 0 } },
    { name: "Crunch", values: { drive: 16, tone: 7000, mix: 1, output: -2 } },
    { name: "Fuzz", values: { drive: 32, tone: 4000, mix: 1, output: -4 } },
    { name: "Parallel grit", values: { drive: 24, tone: 6000, mix: 0.35, output: 0 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      s = { tone: -1, c: null, z: new Float64Array(8) };
      STATE.set(params, s);
    }
    if (s.tone !== params.tone) {
      s.tone = params.tone;
      s.c = lowpass(params.tone, sampleRate);
    }
    const { b0, b1, b2, a1, a2 } = s.c;
    const z = s.z;
    const drive = dbToGain(params.drive);
    const comp = 1 / Math.tanh(Math.max(drive, 1));
    const mix = params.mix;
    const out = dbToGain(params.output);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < 2; c++) {
        const x = c ? inR[i] : inL[i];
        const w = Math.tanh(x * drive) * comp;
        const o = c * 4; // direct form I: x1 x2 y1 y2
        const y = b0 * w + b1 * z[o] + b2 * z[o + 1] - a1 * z[o + 2] - a2 * z[o + 3];
        z[o + 1] = z[o];
        z[o] = w;
        z[o + 3] = z[o + 2];
        z[o + 2] = y;
        const v = (x + (y - x) * mix) * out;
        if (c) outR[i] = v;
        else outL[i] = v;
      }
    }
  },
};
