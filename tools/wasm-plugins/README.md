# WebAssembly effect plugins

Audius Studio's mixer takes user-loadable effects. A plugin is **two files**:

| File | What it is |
|---|---|
| `my-effect.js` | An ES module that exports a `PLUGIN` object (metadata, parameters, presets, glue to the DSP). |
| `my-effect.wasm` | The DSP itself, compiled to WebAssembly. |

Load them in the mixer: **FX Chain → Plugins → “+ Add effect” → “Load effect files…”** (or drop both files onto the Plugins section). Loading is only ever an explicit choice: the app never fetches plugin code from a network URL, and an AudioWorklet module that uses `import`/`require` is refused.

## What this is not

`.vst`, `.vst3`, `.dll` and `.so` files are **native binaries** built for a desktop host. A browser cannot load or run them — not with a workaround, not with a flag. “VST support” in Audius Studio therefore means *effects compiled to WebAssembly*, including a VST3 whose DSP was built with a WASM target and wrapped in a plugin module like the one below. A desktop companion app that hosts real `.vst3` files is a separate, future project (not started).

## Ship-quality reference effects

Two effects ship with the app and go through exactly the same host path as your files:

- **Aurora Reverb** — damped stereo reverb, four combs and two allpasses per channel, with size, damping, width and mix.
- **Echo Line** — tape-style stereo delay with damped feedback, a smoothed Time control and soft saturation on the repeats.

Their sources are `app/public/plugins/*.js` (adapters) and `tools/wasm-plugins/src/*.wat` (DSP).

## The ABI

The host composes one AudioWorklet module per plugin:

```
const PROCESSOR_NAME = "wasm-fx-…";
<app/public/plugins/wasm-fx-processor.js>   // the driver: buffers, params, bypass, errors
<your module source>                        // exports PLUGIN
registerProcessor(PROCESSOR_NAME, createWasmFxProcessor());
```

Your module must not use `import`/`require`; everything it needs is in the two files.

### `PLUGIN`

```js
export const PLUGIN = {
  name: "Gain Trim",
  version: "1.0.0",
  params: [
    { id: "gain", name: "Gain", min: 0, max: 1, default: 0.5, unit: "%", format: "percent" },
  ],
  presets: [{ name: "Unity", values: { gain: 0.5 } }],
  init({ sampleRate, wasm, params, meta }) {},          // once, before the first block
  setParam(id, value, params) {},                      // on every change
  process({ inL, inR, outL, outR, frames, params, sampleRate, wasm }) {},
  dispose() {},                                        // when the slot is removed
};
```

- `params` — up to 24 entries. `format` is one of `percent`, `ms`, `hz`, `db`, `raw` and only affects the read-out under the knob.
- `presets` — up to 12; each fills the parameters it lists, the rest keep their current value.
- `process` writes both output channels. The driver passes audio through and marks the slot as failed if `process` throws or produces a non-finite sample, so one bad plugin can never take the mixer down.
- The driver pushes every stored value through `setParam` right after `init`, so a restored project sounds the same as when it was saved.

### The WASM side

The reference effects use a four-function C-like ABI, called from the adapter:

| Export | Signature | Meaning |
|---|---|---|
| `memory` | — | Linear memory. Bytes `0..4095` are the host scratch area: `inL` at 0, `inR` at 1024, `outL` at 2048, `outR` at 3072 (256 frames each, `f32`). |
| `init(sampleRate)` | `f32 → ()` | Called once. Tune delay lengths, clear the state. |
| `set_param(index, value)` | `i32, f32 → ()` | `value` is normalised `0..1`. |
| `process(inL, inR, outL, outR, frames)` | `i32 × 4, i32 → ()` | Byte addresses of four `f32` buffers. |

A plugin may use any other ABI it likes — the ABI is between your `.js` and your `.wasm`; only `process()` and the `PLUGIN` object are the host's business.

## Building the reference effects

```sh
npm install                 # brings in wabt (an assembler as a JS/WASM package)
npm run build:wasm          # .wat → app/public/plugins/*.wasm + examples/*.wasm
npm run build:wasm -- --check   # CI-style check: do the .wasm files match the sources?
```

`tools/wasm-plugins/src/*.wat` holds the sources; `tools/wasm-plugins/examples/` holds the worked example (`gain-trim.js` + `gain-trim.wasm`) to copy when writing your own.

## Tests

```sh
node tools/test-wasm-fx.mjs     # 43 checks, no browser: DSP stability, ABI, module rules, sanitiser
```

The browser suites (real Chromium over CDP) add the parts that need an AudioContext: live signal flow, bypass, reorder, remove, project save/restore of a user plugin, offline-export rendering and the 10-slot / 32-track performance gate.
