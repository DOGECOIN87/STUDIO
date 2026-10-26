/**
 * Audius Studio — Silk Chorus (built-in effect, plain JavaScript DSP).
 * Two modulated delay lines (12 ms centre, up to 8 ms sweep) with the right
 * channel's LFO offset by up to 180 degrees for width; linear interpolation.
 */
const STATE = new WeakMap();
const rateHz = (v) => 0.05 * Math.pow(100, Math.min(1, Math.max(0, v)));

export const PLUGIN = {
  name: "Silk Chorus",
  version: "1.0.0",
  params: [
    { id: "rate", name: "Rate", min: 0, max: 1, default: 0.45, unit: "Hz", format: "rate" },
    { id: "depth", name: "Depth", min: 0, max: 1, default: 0.5, unit: "%", format: "percent" },
    { id: "width", name: "Width", min: 0, max: 1, default: 0.8, unit: "%", format: "percent" },
    { id: "mix", name: "Mix", min: 0, max: 1, default: 0.45, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Subtle", values: { rate: 0.35, depth: 0.3, width: 0.6, mix: 0.3 } },
    { name: "Lush", values: { rate: 0.45, depth: 0.6, width: 0.9, mix: 0.5 } },
    { name: "Wobble", values: { rate: 0.7, depth: 0.85, width: 0.7, mix: 0.55 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      const size = Math.ceil(sampleRate * 0.05);
      s = { bufL: new Float32Array(size), bufR: new Float32Array(size), size, w: 0, phase: 0 };
      STATE.set(params, s);
    }
    const { bufL, bufR, size } = s;
    const inc = rateHz(params.rate) / sampleRate;
    const centre = 0.012 * sampleRate;
    const sweep = 0.008 * sampleRate * params.depth;
    const offset = 0.5 * params.width;
    const mix = params.mix;
    let w = s.w;
    let phase = s.phase;
    const tap = (buf, delay) => {
      let pos = w - delay;
      while (pos < 0) pos += size;
      const i0 = Math.floor(pos);
      const f = pos - i0;
      return buf[i0 % size] * (1 - f) + buf[(i0 + 1) % size] * f;
    };
    for (let i = 0; i < frames; i++) {
      bufL[w] = inL[i];
      bufR[w] = inR[i];
      const dl = centre + sweep * Math.sin(2 * Math.PI * phase);
      const dr = centre + sweep * Math.sin(2 * Math.PI * (phase + offset));
      outL[i] = inL[i] * (1 - mix * 0.5) + tap(bufL, dl) * mix;
      outR[i] = inR[i] * (1 - mix * 0.5) + tap(bufR, dr) * mix;
      phase += inc;
      if (phase >= 1) phase -= 1;
      w = (w + 1) % size;
    }
    s.w = w;
    s.phase = phase;
  },
};
