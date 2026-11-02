/**
 * STUDIO — Auto-Pan (built-in effect, plain JavaScript DSP).
 * An LFO moves the sound between the speakers: sine, triangle or a smoothed
 * square, with depth, a stereo offset (at 180° it becomes a tremolo on
 * each side in turn) and an equal-power pan law. After the LYNX SHARE
 * auto-pan (AGPL-3.0), whose rate law is 0.01 · 1000^v Hz.
 */
const STATE = new WeakMap();
const rateHz = (v) => 0.05 * Math.pow(400, Math.min(1, Math.max(0, v)));

export const PLUGIN = {
  name: "Auto-Pan",
  version: "1.0.0",
  params: [
    { id: "rate", name: "Rate", min: 0, max: 1, default: 0.45, unit: "Hz", format: "lfo-rate" },
    { id: "depth", name: "Depth", min: 0, max: 1, default: 0.75, unit: "%", format: "percent" },
    { id: "shape", name: "Shape", min: 0, max: 2, default: 0, unit: "", format: "lfo-shape" },
    { id: "smooth", name: "Smooth", min: 0, max: 1, default: 0.3, unit: "%", format: "percent" },
    { id: "tremolo", name: "Tremolo", min: 0, max: 1, default: 0, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Gentle sway", values: { rate: 0.3, depth: 0.5, shape: 0, smooth: 0.3, tremolo: 0 } },
    { name: "Ping-pong", values: { rate: 0.55, depth: 1, shape: 2, smooth: 0.15, tremolo: 0 } },
    { name: "Helicopter", values: { rate: 0.85, depth: 0.9, shape: 1, smooth: 0, tremolo: 0.4 } },
    { name: "Tremolo", values: { rate: 0.6, depth: 0, shape: 0, smooth: 0.2, tremolo: 0.8 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      s = { phase: 0, lfo: 0 };
      STATE.set(params, s);
    }
    const inc = rateHz(params.rate) / sampleRate;
    const depth = params.depth;
    const shape = Math.round(params.shape);
    const trem = params.tremolo;
    // one-pole smoothing of the LFO: 0 → 0.2 ms, 1 → 40 ms
    const tau = 0.0002 + 0.04 * params.smooth;
    const a = 1 - Math.exp(-1 / (sampleRate * tau));
    let phase = s.phase;
    let lfo = s.lfo;
    for (let i = 0; i < frames; i++) {
      let raw;
      if (shape === 0) raw = Math.sin(2 * Math.PI * phase);
      else if (shape === 1) raw = 1 - 4 * Math.abs(phase - 0.5);
      else raw = phase < 0.5 ? 1 : -1;
      lfo += (raw - lfo) * a;
      const pan = lfo * depth; // -1 … 1
      const angle = ((pan + 1) * Math.PI) / 4;
      const gain = 1 - trem * 0.5 * (1 - lfo); // tremolo dips with the LFO
      // equal power, normalised so centre is unity
      const gl = Math.cos(angle) * Math.SQRT2 * gain;
      const gr = Math.sin(angle) * Math.SQRT2 * gain;
      const mid = (inL[i] + inR[i]) * 0.5;
      const side = (inL[i] - inR[i]) * 0.5;
      // pan the mid, keep the original stereo image in the side
      outL[i] = gl * mid + side * gain;
      outR[i] = gr * mid - side * gain;
      phase += inc;
      if (phase >= 1) phase -= 1;
    }
    s.phase = phase;
    s.lfo = lfo;
  },
};
