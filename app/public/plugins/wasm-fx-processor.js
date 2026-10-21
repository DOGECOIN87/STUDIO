/**
 * Audius Studio — WASM effect driver (AudioWorklet side).
 *
 * This file is NOT loaded directly by the page. wasm-fx-host.js fetches it as
 * text and composes a per-plugin module:
 *
 *     const PROCESSOR_NAME = "wasm-fx-…";
 *     <this file>
 *     <the plugin's JS module source>          // export const PLUGIN = { … }
 *     if (typeof registerProcessor === "function") {
 *       registerProcessor(PROCESSOR_NAME, createWasmFxProcessor());
 *     }
 *
 * The composed module is added with audioWorklet.addModule(blobUrl), so a
 * plugin is really an AudioWorklet + a WebAssembly module — no remote code is
 * ever fetched.
 *
 * Plugin contract (see tools/wasm-plugins/README.md):
 *
 *   export const PLUGIN = {
 *     name: "Aurora Reverb",
 *     version: "1.0",
 *     presets: [{ name: "Hall", values: { mix: 0.4 } }],       // optional
 *     params: [
 *       { id: "mix", name: "Mix", min: 0, max: 1, default: 0.25,
 *         unit: "%", curve: "linear" | "log", format: "percent"|"ms"|"hz"|"db"|"raw" },
 *     ],
 *     init({ sampleRate, wasm }) { … },   // wasm = { exports, memory } | null
 *     process({ inL, inR, outL, outR, frames, params }) { … },
 *     dispose() {},
 *   };
 */

function createWasmFxProcessor() {
  const sanitizeParams = (list) =>
    (Array.isArray(list) ? list : [])
      .slice(0, 24)
      .map((p, i) => ({
        id: String(p && p.id ? p.id : `p${i}`),
        name: String((p && (p.name || p.id)) || `Param ${i + 1}`).slice(0, 40),
        min: Number.isFinite(p && p.min) ? p.min : 0,
        max: Number.isFinite(p && p.max) ? p.max : 1,
        default: Number.isFinite(p && p.default) ? p.default : 0.5,
        unit: String((p && p.unit) || "").slice(0, 8),
        curve: p && p.curve === "log" ? "log" : "linear",
        format: String((p && p.format) || "raw").slice(0, 12),
      }));

  return class WasmFxProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const opts = (options && options.processorOptions) || {};
      this.name = opts.name || "WASM effect";
      this.def = null;
      this.error = null;
      this.bypass = !!opts.bypass;
      this.frames = 128;
      // Four buffers, reused every render quantum. The plugin reads/writes
      // these views, so no allocation happens on the audio thread.
      this.inL = new Float32Array(this.frames);
      this.inR = new Float32Array(this.frames);
      this.outL = new Float32Array(this.frames);
      this.outR = new Float32Array(this.frames);

      try {
        const plugin = typeof PLUGIN !== "undefined" ? PLUGIN : null;
        if (!plugin || typeof plugin.process !== "function") {
          throw new Error("the plugin module does not export PLUGIN.process");
        }
        this.def = plugin;
        this.meta = sanitizeParams(plugin.params);
        this.presets = Array.isArray(plugin.presets) ? plugin.presets.slice(0, 12) : [];
        this.params = {};
        for (const p of this.meta) this.params[p.id] = p.default;
        if (opts.values && typeof opts.values === "object") {
          for (const p of this.meta) {
            const v = Number(opts.values[p.id]);
            if (Number.isFinite(v)) this.params[p.id] = Math.min(p.max, Math.max(p.min, v));
          }
        }
        let wasm = null;
        if (opts.wasmModule) {
          wasm = { exports: new WebAssembly.Instance(opts.wasmModule, {}).exports, memory: null };
          wasm.memory = wasm.exports.memory || null;
        }
        if (typeof plugin.init === "function") {
          plugin.init({
            sampleRate: typeof sampleRate === "number" ? sampleRate : 44100,
            wasm,
            params: this.params,
            meta: this.meta,
          });
        }
        // Push the stored values into the DSP so a restored slot sounds the same.
        if (typeof plugin.setParam === "function") {
          for (const p of this.meta) plugin.setParam(p.id, this.params[p.id], this.params);
        }
        this.wasm = wasm;
        this.port.postMessage({
          type: "meta",
          name: String(plugin.name || this.name),
          version: String(plugin.version || "1.0"),
          params: this.meta,
          presets: this.presets.map((p) => ({
            name: String((p && p.name) || "Preset").slice(0, 40),
            values: p && p.values && typeof p.values === "object" ? p.values : {},
          })),
        });
      } catch (err) {
        this.error = (err && err.message) || String(err);
        this.port.postMessage({ type: "error", message: this.error });
      }

      this.port.onmessage = (event) => {
        const msg = event.data || {};
        try {
          if (msg.type === "param" && this.def) {
            const p = this.meta.find((x) => x.id === msg.id);
            if (!p) return;
            const v = Number(msg.value);
            if (!Number.isFinite(v)) return;
            this.params[p.id] = Math.min(p.max, Math.max(p.min, v));
            if (typeof this.def.setParam === "function") this.def.setParam(p.id, this.params[p.id], this.params);
          } else if (msg.type === "values" && this.def) {
            for (const p of this.meta) {
              const v = Number(msg.values && msg.values[p.id]);
              if (Number.isFinite(v)) this.params[p.id] = Math.min(p.max, Math.max(p.min, v));
            }
            for (const p of this.meta) {
              if (typeof this.def.setParam === "function") this.def.setParam(p.id, this.params[p.id], this.params);
            }
          } else if (msg.type === "bypass") {
            this.bypass = !!msg.on;
          } else if (msg.type === "dispose") {
            this.disposed = true;
            if (this.def && typeof this.def.dispose === "function") this.def.dispose();
            this.def = null;
          }
        } catch (err) {
          this.reportError(err);
        }
      };
    }

    reportError(err) {
      if (this.reported) return;
      this.reported = true;
      this.error = (err && err.message) || String(err);
      this.bypass = true;
      this.port.postMessage({ type: "error", message: this.error });
    }

    copyThrough(input, output) {
      if (!input || !output) return;
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0];
        if (src) output[c].set(src);
        else output[c].fill(0);
      }
    }

    process(inputs, outputs) {
      const input = inputs[0];
      const output = outputs[0];
      if (!output || !output.length) return true;
      if (this.disposed) return false;
      if (this.bypass || this.error || !this.def) {
        this.copyThrough(input, output);
        return true;
      }
      const frames = Math.min(output[0].length, this.frames);
      const inL = (input && input[0]) || null;
      const inR = (input && input[1]) || inL;
      if (inL) this.inL.set(inL.subarray(0, frames));
      else this.inL.fill(0, 0, frames);
      if (inR) this.inR.set(inR.subarray(0, frames));
      else this.inR.fill(0, 0, frames);
      this.outL.fill(0, 0, frames);
      this.outR.fill(0, 0, frames);
      try {
        this.def.process({
          inL: this.inL,
          inR: this.inR,
          outL: this.outL,
          outR: this.outR,
          frames,
          params: this.params,
          sampleRate: typeof sampleRate === "number" ? sampleRate : 44100,
          wasm: this.wasm,
        });
      } catch (err) {
        this.reportError(err);
        this.copyThrough(input, output);
        return true;
      }
      // A plugin may write silence or garbage after an internal fault; keep the
      // output finite so one bad module can never blast the mixer.
      for (let i = 0; i < frames; i++) {
        const l = this.outL[i];
        const r = this.outR[i];
        if (!Number.isFinite(l) || !Number.isFinite(r)) {
          this.copyThrough(input, output);
          this.reportError(new Error("plugin produced a non-finite sample"));
          return true;
        }
      }
      output[0].set(this.outL.subarray(0, frames));
      if (output[1]) output[1].set(this.outR.subarray(0, frames));
      return true;
    }
  };
}

if (typeof registerProcessor !== "function") {
  // Imported from the page for metadata only (see wasm-fx-host.js): nothing to register.
  globalThis.__audiusWasmFxDriverLoaded = true;
}
