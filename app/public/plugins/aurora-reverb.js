/**
 * Audius Studio — Aurora Reverb, reference WASM effect (adapter).
 *
 * The DSP is aurora-reverb.wasm (source: tools/wasm-plugins/src/aurora-reverb.wat).
 * This module is the small bridge every WASM effect needs: it reserves the
 * plugin's scratch area in the module's linear memory, copies the audio in,
 * calls the exported `process`, and copies the result out.
 *
 * Loaded by wasm-fx-host.js: it is composed into the AudioWorklet module and
 * imported (for its metadata only) on the main thread.
 */

const SCRATCH = { inL: 0, inR: 1024, outL: 2048, outR: 3072, frames: 256 };
const PARAM_INDEX = { mix: 0, size: 1, damping: 2, width: 3 };

// PLUGIN is shared by every copy of this effect in the worklet, so each copy's
// WASM instance is kept by its own params object, never on PLUGIN itself
// (two tracks with the same effect would otherwise share one DSP).
const DSP = new WeakMap();

export const PLUGIN = {
  name: "Aurora Reverb",
  version: "1.0.0",
  params: [
    { id: "mix", name: "Mix", min: 0, max: 1, default: 0.26, unit: "%", format: "percent" },
    { id: "size", name: "Size", min: 0, max: 1, default: 0.62, unit: "%", format: "percent" },
    { id: "damping", name: "Damping", min: 0, max: 1, default: 0.3, unit: "%", format: "percent" },
    { id: "width", name: "Width", min: 0, max: 1, default: 0.8, unit: "%", format: "percent" },
  ],
  presets: [
    { name: "Room", values: { mix: 0.18, size: 0.34, damping: 0.55, width: 0.5 } },
    { name: "Plate", values: { mix: 0.3, size: 0.66, damping: 0.18, width: 0.9 } },
    { name: "Hall", values: { mix: 0.4, size: 0.9, damping: 0.34, width: 1 } },
    { name: "Space", values: { mix: 0.62, size: 1, damping: 0.12, width: 0.7 } },
  ],

  init({ wasm, sampleRate, params }) {
    if (!wasm || !wasm.exports || !wasm.exports.init) throw new Error("aurora-reverb.wasm did not load");
    wasm.exports.init(sampleRate || 44100);
    DSP.set(params, wasm.exports);
  },

  setParam(id, value, params) {
    const ex = DSP.get(params);
    const index = PARAM_INDEX[id];
    if (!ex || index == null) return;
    // The DSP works in normalised 0..1, which is exactly the UI range here.
    ex.set_param(index, value);
  },

  process({ inL, inR, outL, outR, frames, params }) {
    const ex = DSP.get(params);
    if (!ex) return;
    // The WASM scratch area holds at most 256 frames (1 KiB per buffer).
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
