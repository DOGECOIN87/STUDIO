/**
 * STUDIO — Frequency Shifter (built-in effect, plain JavaScript DSP).
 * Builds the analytic signal with two chains of 2nd-order allpasses in z²
 * (a ~90° Hilbert pair) and multiplies it by a complex oscillator, moving
 * every partial by the same number of hertz. Ported from the LYNX SHARE
 * frequency shifter (AGPL-3.0). Stereo spread shifts the right side the
 * opposite way for a wide, swirling barber-pole effect.
 */
const STATE = new WeakMap();
const A = [0.6923878, 0.9360654322959, 0.988229522686, 0.9987488452737];
const B = [0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278];

function makeChain() {
  // per stage: x1, x2, y1, y2 for branch a and b (4 stages × 4 values each)
  return { a: new Float64Array(16), b: new Float64Array(16), delayed: 0 };
}

function stage(k, x, st, o) {
  const y = k * k * (x + st[o + 3]) - st[o + 1];
  st[o + 1] = st[o];
  st[o] = x;
  st[o + 3] = st[o + 2];
  st[o + 2] = y;
  return y;
}

export const PLUGIN = {
  name: "Frequency Shifter",
  version: "1.0.0",
  params: [
    { id: "shift", name: "Shift", min: -1, max: 1, default: 0.15, unit: "Hz", format: "fshift" },
    { id: "spread", name: "Stereo", min: 0, max: 1, default: 0, unit: "%", format: "percent" },
    { id: "mix", name: "Mix", min: 0, max: 1, default: 0.5, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Shimmer", values: { shift: 0.1, spread: 0.6, mix: 0.35 } },
    { name: "Metallic", values: { shift: 0.45, spread: 0, mix: 0.7 } },
    { name: "Wide detune", values: { shift: 0.04, spread: 1, mix: 0.5 } },
    { name: "Robot", values: { shift: -0.55, spread: 0.2, mix: 1 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      s = { chains: [makeChain(), makeChain()], phase: 0 };
      STATE.set(params, s);
    }
    const x = params.shift;
    const hz = 2000 * x * Math.abs(x); // quadratic curve: fine control near zero
    const step = hz / sampleRate;
    const mix = params.mix;
    const signR = 1 - 2 * params.spread;
    let phase = s.phase;
    for (let i = 0; i < frames; i++) {
      const ang = 2 * Math.PI * phase;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      for (let c = 0; c < 2; c++) {
        const ch = s.chains[c];
        const input = c ? inR[i] : inL[i];
        let u = input;
        let v = input;
        for (let k = 0; k < 4; k++) {
          u = stage(A[k], u, ch.a, k * 4);
          v = stage(B[k], v, ch.b, k * 4);
        }
        const re = ch.delayed;
        ch.delayed = u;
        const shifted = re * cosA + (c ? signR : 1) * v * sinA;
        const y = input + (shifted - input) * mix;
        if (c) outR[i] = y;
        else outL[i] = y;
      }
      phase += step;
      phase -= Math.floor(phase);
    }
    s.phase = phase;
  },
};
