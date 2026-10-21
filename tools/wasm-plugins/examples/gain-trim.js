/**
 * Gain Trim — a worked example of an Audius Studio WASM effect.
 *
 * Load it in the mixer: FX Chain → Plugins → "+ Add effect" → Load effect files…
 * and pick this file plus gain-trim.wasm (both live in tools/wasm-plugins/examples/).
 *
 * Contract: export a PLUGIN object. It is composed into an AudioWorklet
 * module, so it must not use import/require — everything it needs is here.
 */
const SCRATCH = { inL: 0, inR: 1024, outL: 2048, outR: 3072, frames: 256 };

export const PLUGIN = {
  name: "Gain Trim",
  version: "1.0.0",
  params: [
    { id: "gain", name: "Gain", min: 0, max: 1, default: 0.5, unit: "%", format: "percent" },
    { id: "smooth", name: "Smoothing", min: 0, max: 1, default: 0.2, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Unity", values: { gain: 0.5, smooth: 0.2 } },
    { name: "Boost", values: { gain: 0.8, smooth: 0.35 } },
    { name: "Fade", values: { gain: 0.2, smooth: 0.8 } },
  ],

  init({ wasm, sampleRate }) {
    if (!wasm || !wasm.exports || !wasm.exports.init) throw new Error("gain-trim.wasm did not load");
    this.ex = wasm.exports;
    this.ex.init(sampleRate || 44100);
    this.index = { gain: 0, smooth: 1 };
  },

  setParam(id, value) {
    const index = this.index[id];
    if (index == null) return;
    this.ex.set_param(index, value);
  },

  process({ inL, inR, outL, outR, frames }) {
    for (let start = 0; start < frames; start += SCRATCH.frames) {
      const n = Math.min(SCRATCH.frames, frames - start);
      const mem = new Float32Array(this.ex.memory.buffer);
      mem.set(inL.subarray(start, start + n), SCRATCH.inL / 4);
      mem.set(inR.subarray(start, start + n), SCRATCH.inR / 4);
      this.ex.process(SCRATCH.inL, SCRATCH.inR, SCRATCH.outL, SCRATCH.outR, n);
      const out = new Float32Array(this.ex.memory.buffer);
      outL.set(out.subarray(SCRATCH.outL / 4, SCRATCH.outL / 4 + n), start);
      outR.set(out.subarray(SCRATCH.outR / 4, SCRATCH.outR / 4 + n), start);
    }
  },
};
