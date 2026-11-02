/**
 * STUDIO — Lo-Fi (built-in effect, plain JavaScript DSP).
 * Sample-rate reduction (sample and hold) and bit-depth reduction with a
 * dry/wet mix. Laws ported from the LYNX SHARE lo-fi effect (AGPL-3.0):
 * each sample is held for 128·r³ + 1 samples and quantised to
 * 65536 / (2048·b² + 1) levels.
 */
const STATE = new WeakMap();
const holdSamples = (v) => Math.floor(128 * v * v * v) + 1;
const levels = (v) => 65536 / (2048 * v * v + 1);

export const PLUGIN = {
  name: "Lo-Fi",
  version: "1.0.0",
  params: [
    { id: "rate", name: "Downsample", min: 0, max: 1, default: 0.35, unit: "", format: "lofi-rate" },
    { id: "bits", name: "Crush", min: 0, max: 1, default: 0.6, unit: "bits", format: "lofi-bits" },
    { id: "mix", name: "Mix", min: 0, max: 1, default: 1, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Clean", values: { rate: 0, bits: 0, mix: 1 } },
    { name: "12-bit sampler", values: { rate: 0.32, bits: 0.35, mix: 1 } },
    { name: "8-bit console", values: { rate: 0.5, bits: 0.72, mix: 1 } },
    { name: "Destroyed", values: { rate: 0.8, bits: 0.95, mix: 0.8 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params }) {
    let s = STATE.get(params);
    if (!s) {
      s = { l: 0, r: 0, count: 0 };
      STATE.set(params, s);
    }
    const hold = holdSamples(params.rate);
    const step = 2 / levels(params.bits);
    const mix = params.mix;
    const q = (x) => step * Math.floor(x / step + 0.5);
    let { l, r, count } = s;
    for (let i = 0; i < frames; i++) {
      if (--count <= 0) {
        count = hold;
        l = q(inL[i]);
        r = q(inR[i]);
      }
      outL[i] = inL[i] + mix * (l - inL[i]);
      outR[i] = inR[i] + mix * (r - inR[i]);
    }
    s.l = l;
    s.r = r;
    s.count = count;
  },
};
