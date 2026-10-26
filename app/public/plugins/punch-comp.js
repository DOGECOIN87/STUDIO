/**
 * Audius Studio — Punch Compressor (built-in effect, plain JavaScript DSP).
 * Stereo-linked peak compressor with a 6 dB soft knee, smoothed attack / release,
 * makeup gain and a dry/wet mix for parallel compression.
 * Per-slot state lives in STATE, keyed by the slot's params object.
 */
const STATE = new WeakMap();

export const PLUGIN = {
  name: "Punch Compressor",
  version: "1.0.0",
  params: [
    { id: "threshold", name: "Threshold", min: -40, max: 0, default: -18, unit: "dB", format: "db" },
    { id: "ratio", name: "Ratio", min: 1, max: 20, default: 4, unit: ":1", format: "ratio" },
    { id: "attack", name: "Attack", min: 0.1, max: 100, default: 10, unit: "ms", format: "time-ms" },
    { id: "release", name: "Release", min: 10, max: 1000, default: 120, unit: "ms", format: "time-ms" },
    { id: "makeup", name: "Makeup", min: 0, max: 24, default: 2, unit: "dB", format: "db" },
    { id: "mix", name: "Mix", min: 0, max: 1, default: 1, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Glue", values: { threshold: -14, ratio: 2, attack: 30, release: 200, makeup: 2.5, mix: 1 } },
    { name: "Punch", values: { threshold: -20, ratio: 4, attack: 12, release: 90, makeup: 5, mix: 1 } },
    { name: "Squash", values: { threshold: -30, ratio: 10, attack: 1, release: 60, makeup: 10, mix: 1 } },
    { name: "Parallel", values: { threshold: -32, ratio: 8, attack: 3, release: 100, makeup: 12, mix: 0.4 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      s = { gr: 0, key: "" };
      STATE.set(params, s);
    }
    const key = `${params.attack}|${params.release}|${params.makeup}|${sampleRate}`;
    if (key !== s.key) {
      s.key = key;
      s.atk = Math.exp(-1 / (sampleRate * Math.max(0.0001, params.attack / 1000)));
      s.rel = Math.exp(-1 / (sampleRate * Math.max(0.001, params.release / 1000)));
      s.makeup = Math.pow(10, params.makeup / 20);
    }
    const T = params.threshold;
    const slope = 1 - 1 / Math.max(1, params.ratio);
    const knee = 6;
    const mix = params.mix;
    let gr = s.gr;
    for (let i = 0; i < frames; i++) {
      const l = inL[i];
      const r = inR[i];
      const level = Math.max(Math.abs(l), Math.abs(r)) + 1e-9;
      const over = 20 * Math.log10(level) - T;
      let target = 0;
      if (over >= knee / 2) target = over * slope;
      else if (over > -knee / 2) {
        const x = over + knee / 2;
        target = (slope * x * x) / (2 * knee);
      }
      gr = target + (gr - target) * (target > gr ? s.atk : s.rel);
      const g = Math.pow(10, -gr / 20) * s.makeup;
      outL[i] = l * (1 - mix + g * mix);
      outR[i] = r * (1 - mix + g * mix);
    }
    s.gr = gr;
  },
};
