#!/usr/bin/env node
/**
 * Node-side tests for the plain-JavaScript built-in effects.
 *
 *   node tools/test-builtin-fx.mjs
 *
 * Each effect is imported directly, fed silence, a sine and noise at its
 * defaults and at every preset, and checked for finite, bounded output.
 * A few effect-specific checks prove the DSP does what the knob says.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(repo, "app/public");
const { BUILTIN_PLUGINS } = await import(pathToFileURL(path.join(pub, "plugins/registry.js")));

let pass = 0, fail = 0;
const check = (cond, msg, extra = "") => {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.log(`✗ ${msg}${extra ? " — " + extra : ""}`); }
};

const SR = 48000;
const BLOCK = 128;

function run(plugin, values, input, sr = SR) {
  const params = {};
  for (const p of plugin.params) params[p.id] = p.default;
  Object.assign(params, values || {});
  plugin.init && plugin.init({ sampleRate: sr, params });
  const n = input[0].length;
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let off = 0; off < n; off += BLOCK) {
    const frames = Math.min(BLOCK, n - off);
    const inL = new Float32Array(BLOCK); inL.set(input[0].subarray(off, off + frames));
    const inR = new Float32Array(BLOCK); inR.set(input[1].subarray(off, off + frames));
    const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
    plugin.process({ inL, inR, outL, outR, frames, params, sampleRate: sr });
    out[0].set(outL.subarray(0, frames), off);
    out[1].set(outR.subarray(0, frames), off);
  }
  return out;
}

const sine = (hz, n, amp = 0.5) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR); return a; };
const noise = (n) => { let s = 12345; const a = new Float32Array(n); for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; a[i] = (s / 2 ** 32) * 2 - 1; } return a; };
const rms = (a, from = 0) => { let t = 0; for (let i = from; i < a.length; i++) t += a[i] * a[i]; return Math.sqrt(t / (a.length - from)); };
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const finite = (o) => o.every((ch) => ch.every(Number.isFinite));
// dominant frequency by zero-crossing count (fine for clean tones)
const zcHz = (a, from) => { let z = 0; for (let i = from + 1; i < a.length; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) z++; return (z / 2) * (SR / (a.length - from)); };

const N = SR; // one second
const js = BUILTIN_PLUGINS.filter((p) => !p.wasm);
for (const entry of js) {
  const file = path.join(pub, entry.js.replace(/^\//, ""));
  check(fs.existsSync(file), `${entry.name}: ${entry.js} exists`);
  const src = fs.readFileSync(file, "utf8");
  check(!/(^|[^.\w])import\s*[({'"]/m.test(src) && !/\brequire\s*\(/.test(src), `${entry.name}: no import/require`);
  const { PLUGIN } = await import(pathToFileURL(file));
  check(PLUGIN && typeof PLUGIN.process === "function", `${entry.name}: exports PLUGIN.process`);
  check(PLUGIN.params.length >= 2 && PLUGIN.params.length <= 24, `${entry.name}: ${PLUGIN.params.length} params`);
  check(PLUGIN.params.every((p) => p.default >= p.min && p.default <= p.max && (p.format || "").length <= 12), `${entry.name}: defaults in range, formats ≤ 12 chars`);
  check(PLUGIN.presets.length >= 1 && PLUGIN.presets.length <= 12, `${entry.name}: ${PLUGIN.presets.length} presets`);
  const silent = run(PLUGIN, null, [new Float32Array(N), new Float32Array(N)]);
  check(finite(silent) && peak(silent[0]) < 1e-3 && peak(silent[1]) < 1e-3, `${entry.name}: silence in, silence out`);
  for (const preset of [{ name: "defaults", values: {} }, ...PLUGIN.presets]) {
    const o = run(PLUGIN, preset.values, [noise(N), sine(220, N)]);
    check(finite(o) && peak(o[0]) < 8 && peak(o[1]) < 8, `${entry.name} [${preset.name}]: finite, bounded`, `peak ${peak(o[0]).toFixed(2)}/${peak(o[1]).toFixed(2)}`);
  }
}

const load = async (f) => (await import(pathToFileURL(path.join(pub, "plugins", f)))).PLUGIN;

{
  const P = await load("pitch-shift.js");
  const o = run(P, { semitones: 12, cents: 0, mix: 1, window: 60 }, [sine(220, N), sine(220, N)]);
  const hz = zcHz(o[0], SR / 2);
  check(Math.abs(hz - 440) < 30, "Pitch Shift: +12 st moves 220 Hz to ~440 Hz", `${hz.toFixed(1)} Hz`);
  const u = run(P, { semitones: 0, cents: 0, mix: 1 }, [sine(220, N), sine(220, N)]);
  check(Math.abs(zcHz(u[0], SR / 2) - 220) < 10, "Pitch Shift: 0 st keeps the pitch");
}
{
  const P = await load("freq-shifter.js");
  // shift knob 0.5 → 2000·0.25 = +500 Hz
  const o = run(P, { shift: 0.5, spread: 0, mix: 1 }, [sine(1000, N), sine(1000, N)]);
  const hz = zcHz(o[0], SR / 2);
  check(Math.abs(hz - 1500) < 60, "Frequency Shifter: +500 Hz moves 1 kHz to ~1.5 kHz", `${hz.toFixed(1)} Hz`);
}
{
  const P = await load("stereo-tool.js");
  const o = run(P, { width: 0 }, [noise(N), sine(300, N)]);
  let diff = 0; for (let i = 0; i < N; i++) diff = Math.max(diff, Math.abs(o[0][i] - o[1][i]));
  check(diff < 1e-6, "Stereo Tool: width 0 is mono");
  const g = run(P, { gain: -6 }, [sine(300, N), sine(300, N)]);
  check(Math.abs(rms(g[0]) / rms(sine(300, N)) - 0.501) < 0.01, "Stereo Tool: −6 dB gain halves the level");
  const sw = run(P, { swap: 1 }, [sine(300, N), new Float32Array(N)]);
  check(rms(sw[0]) < 1e-6 && rms(sw[1]) > 0.3, "Stereo Tool: swap moves left to right");
}
{
  const P = await load("lofi.js");
  const o = run(P, { rate: 0, bits: 1, mix: 1 }, [sine(100, N, 0.9), sine(100, N, 0.9)]);
  const levels = new Set(Array.from(o[0]).map((v) => v.toFixed(5)));
  check(levels.size <= 40, "Lo-Fi: full crush leaves only a few levels", `${levels.size}`);
}
{
  const P = await load("drive.js");
  const o = run(P, { drive: 36, tone: 20000, mix: 1, output: 0 }, [sine(100, N, 0.9), sine(100, N, 0.9)]);
  check(peak(o[0]) <= 1.05, "Drive: compensated output stays near unity", peak(o[0]).toFixed(3));
}
{
  const P = await load("auto-pan.js");
  const o = run(P, { rate: 0.5, depth: 1, shape: 2, smooth: 0, tremolo: 0 }, [sine(500, N), sine(500, N)]);
  check(Math.abs(rms(o[0]) - rms(o[1])) < 0.05 && rms(o[0]) > 0.1, "Auto-Pan: full-depth square pans both sides equally over time");
  const st = run(P, { depth: 0, tremolo: 0 }, [sine(500, N), sine(500, N)]);
  check(Math.abs(rms(st[0]) - rms(sine(500, N))) < 0.01, "Auto-Pan: zero depth is transparent at centre");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
