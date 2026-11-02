/**
 * STUDIO — Pitch Shift (built-in effect, plain JavaScript DSP).
 * Two crossfaded delay-line read heads (sine windows half a cycle apart)
 * sweep through a window, so the pitch moves without changing the length.
 * Ported from the LYNX SHARE pitch shifter (AGPL-3.0): ±24 semitones,
 * ±100 cents, 20…120 ms window.
 */
const STATE = new WeakMap();

export const PLUGIN = {
  name: "Pitch Shift",
  version: "1.0.0",
  params: [
    { id: "semitones", name: "Semitones", min: -24, max: 24, default: 0, unit: "st", format: "semitones" },
    { id: "cents", name: "Fine", min: -100, max: 100, default: 0, unit: "ct", format: "cents" },
    { id: "window", name: "Window", min: 20, max: 120, default: 60, unit: "ms", format: "time-ms" },
    { id: "mix", name: "Mix", min: 0, max: 1, default: 1, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Octave down", values: { semitones: -12, cents: 0, window: 80, mix: 1 } },
    { name: "Octave up", values: { semitones: 12, cents: 0, window: 50, mix: 1 } },
    { name: "Fifth harmony", values: { semitones: 7, cents: 0, window: 60, mix: 0.45 } },
    { name: "Doubler", values: { semitones: 0, cents: 12, window: 40, mix: 0.4 } },
  ],
  init() {},
  setParam() {},
  process({ inL, inR, outL, outR, frames, params, sampleRate }) {
    let s = STATE.get(params);
    if (!s) {
      const size = Math.ceil(sampleRate * 0.13) + 8;
      s = { buf: [new Float32Array(size), new Float32Array(size)], size, w: 0, phase: 0 };
      STATE.set(params, s);
    }
    const { buf, size } = s;
    const semis = Math.round(params.semitones);
    const ratio = Math.pow(2, (semis + params.cents / 100) / 12);
    const mix = params.mix;
    const win = Math.min((params.window / 1000) * sampleRate, size - 4);
    const step = (1 - ratio) / win;
    const read = (b, w, delay) => {
      let p = w - delay;
      while (p < 0) p += size;
      const i0 = p | 0;
      const f = p - i0;
      const i1 = i0 + 1 >= size ? 0 : i0 + 1;
      return b[i0] + (b[i1] - b[i0]) * f;
    };
    let w = s.w;
    let phase = s.phase;
    for (let i = 0; i < frames; i++) {
      buf[0][w] = inL[i];
      buf[1][w] = inR[i];
      const phaseB = phase + 0.5 >= 1 ? phase - 0.5 : phase + 0.5;
      const gA = Math.sin(Math.PI * phase);
      const gB = Math.sin(Math.PI * phaseB);
      const dA = 1 + phase * win;
      const dB = 1 + phaseB * win;
      const l = gA * read(buf[0], w, dA) + gB * read(buf[0], w, dB);
      const r = gA * read(buf[1], w, dA) + gB * read(buf[1], w, dB);
      outL[i] = inL[i] + (l - inL[i]) * mix;
      outR[i] = inR[i] + (r - inR[i]) * mix;
      phase += step;
      phase -= Math.floor(phase);
      if (++w >= size) w = 0;
    }
    s.w = w;
    s.phase = phase;
  },
};
