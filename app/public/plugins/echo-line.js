/**
 * STUDIO — Echo Line, reference WASM effect (adapter).
 *
 * The DSP is echo-line.wasm (source: tools/wasm-plugins/src/echo-line.wat).
 * Same bridge pattern as aurora-reverb.js.
 */

const SCRATCH = { inL: 0, inR: 1024, outL: 2048, outR: 3072, frames: 256 };
const PARAM_INDEX = { mix: 0, time: 1, feedback: 2, tone: 3 };

// PLUGIN is shared by every copy of this effect in the worklet, so each copy's
// WASM instance is kept by its own params object, never on PLUGIN itself
// (two tracks with the same effect would otherwise share one DSP).
const DSP = new WeakMap();

export const PLUGIN = {
  name: "Echo Line",
  version: "1.0.0",
  params: [
    { id: "mix", name: "Mix", min: 0, max: 1, default: 0.28, unit: "%", format: "percent" },
    { id: "time", name: "Time", min: 0, max: 1, default: 0.3, unit: "s", format: "ms" },
    { id: "feedback", name: "Feedback", min: 0, max: 1, default: 0.45, unit: "%", format: "percent" },
    { id: "tone", name: "Tone", min: 0, max: 1, default: 0.65, unit: "%", format: "percent" },
  ],
  // Time is stored as the normalised knob position; the label reads the real
  // milliseconds out of the same 20 ms … 1.9 s curve the DSP uses.
  presets: [
    { name: "Slap", values: { mix: 0.2, time: 0.09, feedback: 0.12, tone: 0.8 } },
    { name: "Eighth", values: { mix: 0.26, time: 0.26, feedback: 0.4, tone: 0.62 } },
    { name: "Dotted", values: { mix: 0.3, time: 0.39, feedback: 0.52, tone: 0.55 } },
    { name: "Dub", values: { mix: 0.45, time: 0.58, feedback: 0.82, tone: 0.3 } },
  ],

  init({ wasm, sampleRate, params }) {
    if (!wasm || !wasm.exports || !wasm.exports.init) throw new Error("echo-line.wasm did not load");
    wasm.exports.init(sampleRate || 44100);
    DSP.set(params, wasm.exports);
  },

  setParam(id, value, params) {
    const ex = DSP.get(params);
    const index = PARAM_INDEX[id];
    if (!ex || index == null) return;
    ex.set_param(index, value);
  },

  process({ inL, inR, outL, outR, frames, params }) {
    const ex = DSP.get(params);
    if (!ex) return;
    for (let start = 0; start < frames; start += SCRATCH.frames) {
      const n = Math.min(SCRATCH.frames, frames - start);
      const mem = new Float32Array(ex.memory.buffer);
      mem.set(inL.subarray(start, start + n), SCRATCH.inL / 4);
      mem.set(inR.subarray(start, start + n), SCRATCH.inR / 4);
      ex.process(SCRATCH.inL, SCRATCH.inR, SCRATCH.outL, SCRATCH.outR, n);
      const out = new Float32Array(ex.memory.buffer);
      outL.set(out.subarray(SCRATCH.outL / 4, SCRATCH.outL / 4 + n), start);
      outR.set(out.subarray(SCRATCH.outR / 4, SCRATCH.outR / 4 + n), start);
    }
  },
};
