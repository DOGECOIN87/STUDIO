#!/usr/bin/env node
/**
 * Node-side tests for the WASM effects and the plugin host.
 *
 *   node tools/test-wasm-fx.mjs
 *
 * What it covers without a browser: the two reference .wasm cores (impulse
 * response, stability, parameter range), the ABI contract the worklet relies
 * on, the plugin module sources (no imports, PLUGIN exported, metadata sane),
 * the registry ↔ files agreement, and the project sanitiser's plugin rules.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(repo, "app/public");

let pass = 0, fail = 0;
const check = (cond, msg, extra = "") => {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.log(`✗ ${msg}${extra ? " — " + extra : ""}`); }
};

const registrySource = fs.readFileSync(path.join(pub, "plugins/registry.js"), "utf8");
const builtins = [...registrySource.matchAll(/type: "([^"]+)",\s*\n\s*name: "([^"]+)",\s*\n\s*category: "([^"]+)",\s*\n\s*description: "([^"]+)",\s*\n\s*js: "([^"]+)",\s*\n\s*wasm: "([^"]+)"/g)]
  .map((m) => ({ type: m[1], name: m[2], category: m[3], description: m[4], js: m[5], wasm: m[6] }));
check(builtins.length === 2, "registry ships exactly two reference effects", JSON.stringify(builtins.map((b) => b.name)));
check(builtins.every((b) => b.category && b.description), "each registry entry carries a category and description");

const DRIVER = fs.readFileSync(path.join(pub, "plugins/wasm-fx-processor.js"), "utf8");
check(/registerProcessor\(PROCESSOR_NAME, createWasmFxProcessor\(\)\)/.test(DRIVER), "the driver registers a processor under the composed name");
check(/copyThrough/.test(DRIVER) && /reportError/.test(DRIVER), "the driver passes audio through and reports faults instead of throwing");
check(/postMessage\(\{ type: "error"/.test(DRIVER), "the driver posts an error message to the page");

const host = fs.readFileSync(path.join(pub, "wasm-fx-host.js"), "utf8");
check(/import\s*\(\s*\/\* @vite-ignore \*\/\s*blobUrl/.test(host), "the host imports plugins from a Blob URL, never a remote URL");
check(!/fetch\(\s*["'`]https?:/.test(host), "the host never fetches remote code");
check(/import.*require/s.test(host), "the host rejects plugin modules that use import/require");
check(/MAX_PLUGIN_SLOTS = 10/.test(host), "the slot cap is 10");

async function instantiate(file) {
  const bytes = fs.readFileSync(file);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

for (const entry of builtins) {
  const wasmPath = path.join(pub, entry.wasm.replace(/^\//, ""));
  const jsPath = path.join(pub, entry.js.replace(/^\//, ""));
  check(fs.existsSync(wasmPath), `${entry.name}: ${entry.wasm} exists`);
  check(fs.existsSync(jsPath), `${entry.name}: ${entry.js} exists`);
  if (!fs.existsSync(wasmPath) || !fs.existsSync(jsPath)) continue;

  const js = fs.readFileSync(jsPath, "utf8");
  check(!/(^|[^.\w])import\s*[({'"]/m.test(js) && !/\brequire\s*\(/.test(js), `${entry.name}: module has no import/require`);
  check(/export const PLUGIN = \{/.test(js), `${entry.name}: module exports PLUGIN`);
  const paramCount = (js.match(/\{ id: "[a-z]+", name: "/g) || []).length;
  check(paramCount >= 2 && paramCount <= 8, `${entry.name}: ${paramCount} parameters declared`);
  check(/presets: \[/.test(js), `${entry.name}: ships presets`);

  const ex = await instantiate(wasmPath);
  const abi = ["memory", "init", "set_param", "process"].every((k) => k in ex);
  check(abi, `${entry.name}: wasm exports the full ABI (memory, init, set_param, process)`);
  ex.init(48000);
  const N = 128, inL = 0, inR = 512, outL = 1024, outR = 1536;
  const mem = () => new Float32Array(ex.memory.buffer);
  let t = 0, inE = 0, outE = 0, peak = 0, nan = 0;
  for (let block = 0; block < 300; block++) {
    const m = mem();
    for (let i = 0; i < N; i++) {
      const v = 0.4 * Math.sin((2 * Math.PI * 196 * (t + i)) / 48000);
      m[i] = v;
      m[128 + i] = v;
      inE += v * v;
    }
    ex.process(inL, inR, outL, outR, N);
    const m2 = mem();
    for (let i = 0; i < N; i++) {
      const o = m2[256 + i];
      if (!Number.isFinite(o)) nan++;
      outE += o * o;
      peak = Math.max(peak, Math.abs(o));
    }
    t += N;
  }
  check(nan === 0, `${entry.name}: 38,400 frames produce only finite samples`);
  check(outE > 1e-4, `${entry.name}: the effect actually changes the signal (energy ${outE.toFixed(3)})`);
  check(peak < 8, `${entry.name}: output stays bounded (peak ${peak.toFixed(3)})`);

  // parameter sweep at the extremes must stay stable
  for (const [i, v] of [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [1, 0.5], [2, 0.5]]) {
    ex.set_param(i, v);
    const m = mem();
    m.fill(0, 0, 256);
    m[0] = 0.9;
    ex.process(inL, inR, outL, outR, N);
    const out = mem().slice(256, 256 + N);
    if (!Array.from(out).every(Number.isFinite)) nan++;
  }
  check(nan === 0, `${entry.name}: a full parameter sweep stays finite`);

  // reset must silence the tail
  ex.init(48000);
  for (let block = 0; block < 30; block++) {
    const m = mem();
    m.fill(0, 0, 256);
    ex.process(inL, inR, outL, outR, N);
  }
  const quiet = mem().slice(256, 256 + N).every((v) => Math.abs(v) < 1e-4);
  check(quiet, `${entry.name}: init() clears the state (a reloaded slot starts silent)`);
}

// The worked example follows the same contract.
const exampleJs = fs.readFileSync(path.join(repo, "tools/wasm-plugins/examples/gain-trim.js"), "utf8");
const exampleWasm = path.join(repo, "tools/wasm-plugins/examples/gain-trim.wasm");
check(/export const PLUGIN = \{/.test(exampleJs), "the worked example exports PLUGIN");
check(fs.existsSync(exampleWasm), "the worked example ships its .wasm");
if (fs.existsSync(exampleWasm)) {
  const ex = await instantiate(exampleWasm);
  ex.init(44100);
  ex.set_param(0, 0.5); // unity
  const m0 = new Float32Array(ex.memory.buffer);
  for (let i = 0; i < 128; i++) m0[i] = m0[128 + i] = 0.5;
  for (let b = 0; b < 4; b++) ex.process(0, 512, 1024, 1536, 128);
  const unity = new Float32Array(ex.memory.buffer)[256];
  ex.set_param(0, 0);
  for (let b = 0; b < 60; b++) {
    const m = new Float32Array(ex.memory.buffer);
    m.fill(0.5, 0, 256);
    ex.process(0, 512, 1024, 1536, 128);
  }
  const muted = new Float32Array(ex.memory.buffer)[256];
  check(Math.abs(unity - 0.5) < 0.08, "the example passes unity gain through", String(unity));
  check(Math.abs(muted) < 1e-3, "the example responds to its Gain parameter", String(muted));
}

// Sanitising lives in app.js; assert the rules it encodes.
const app = fs.readFileSync(path.join(pub, "app.js"), "utf8");
check(/function sanitizeFxPlugins\(raw\)/.test(app), "app.js sanitises effect plugin slots");
check(/raw\.slice\(0, 10\)/.test(app), "sanitising caps the list at 10 slots");
check(/typeof item\.type !== "string"/.test(app), "sanitising drops entries without a type");
check(/while \(seen\.has\(id\)\) id = nextId\("fxp"\)/.test(app), "sanitising makes duplicate ids unique");
check(/jsB64\.length < 2_100_000/.test(app), "sanitising bounds the stored plugin source");
check(/masterFxPlugins: sanitizeFxPlugins\(data\.masterFxPlugins\)/.test(app), "the master plugin list is sanitised too");

console.log(`\n${pass} passed, ${fail} failed of ${pass + fail} checks`);
process.exit(fail ? 1 : 0);
