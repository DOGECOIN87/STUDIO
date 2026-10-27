/**
 * STUDIO — Orbit Phaser (built-in effect, plain JavaScript DSP).
 * Six first-order allpass stages per channel swept between 200 Hz and 3.2 kHz by
 * an LFO (right channel a quarter turn ahead), with feedback and a mix.
 */
const STATE = new WeakMap();
const STAGES = 6;
const rateHz = (v) => 0.05 * Math.pow(100, Math.min(1, Math.max(0, v)));

export const PLUGIN = {
  name: "Orbit Phaser",
  version: "1.0.0",
  params: [
    { id: "rate", name: "Rate", min: 0, max: 1, default: 0.35, unit: "Hz", format: "rate" },
    { id: "depth", name: "Depth", min: 0, max: 1, default: 0.7, unit: "%", format: "percent" },
    { id: "feedback", name: "Feedback", min: 0, max: 0.9, default: 0.45, unit: "%", format: "percent" },
    { id: "mix", name: "Mix", min: 0, max: 1, default: 0.5, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Slow Orbit", values: { rate: 0.25, depth: 0.7, feedback: 0.4, mix: 0.5 } },
    { name: "Jet", values: { rate: 0.4, depth: 0.9, feedback: 0.8, mix: 0.55 } },
    { name: "Shimmer", values: { rate: 0.6, depth: 0.5, feedback: 0.3, mix: 0.4 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      s = { zL: new Float64Array(STAGES), zR: new Float64Array(STAGES), fbL: 0, fbR: 0, phase: 0 };
      STATE.set(params, s);
    }
    const inc = rateHz(params.rate) / sampleRate;
    const depth = params.depth;
    const fbk = params.feedback;
    const mix = params.mix;
    const lo = Math.log(200);
    const span = Math.log(3200) - lo;
    let phase = s.phase;
    const run = (x, z, fbPrev, lfo) => {
      const hz = Math.exp(lo + span * (0.5 + 0.5 * lfo * depth) * Math.max(0.15, depth));
      const t = Math.tan((Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate);
      const a = (t - 1) / (t + 1);
      let y = x + fbPrev * fbk;
      for (let k = 0; k < STAGES; k++) {
        const out = a * y + z[k];
        z[k] = y - a * out;
        y = out;
      }
      return y;
    };
    for (let i = 0; i < frames; i++) {
      const lfoL = Math.sin(2 * Math.PI * phase);
      const lfoR = Math.sin(2 * Math.PI * (phase + 0.25));
      const wl = run(inL[i], s.zL, s.fbL, lfoL);
      const wr = run(inR[i], s.zR, s.fbR, lfoR);
      s.fbL = wl;
      s.fbR = wr;
      outL[i] = inL[i] * (1 - mix * 0.5) + wl * mix * 0.7;
      outR[i] = inR[i] * (1 - mix * 0.5) + wr * mix * 0.7;
      phase += inc;
      if (phase >= 1) phase -= 1;
    }
    s.phase = phase;
  },
};
