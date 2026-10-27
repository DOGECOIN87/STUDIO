/**
 * STUDIO — built-in effect registry (WASM and plain-JavaScript effects).
 *
 * Each entry is a *user-loadable* plugin that ships with the app: an
 * AudioWorklet module (the .js adapter, which exports PLUGIN) plus a
 * WebAssembly DSP core (the .wasm). They go through exactly the same host
 * path as a plugin you load from your own disk, so they prove the full
 * chain: parameter automation, bypass, save/restore and error isolation.
 *
 * What this is NOT: VST/VST3. `.vst`, `.vst3` and `.dll` files are native
 * binaries for a desktop host; no browser can load them. Anything compiled to
 * WebAssembly (including a VST3 built with a WASM target) can be wrapped in a
 * plugin module and loaded here.
 */
export const BUILTIN_PLUGINS = [
  {
    type: "aurora-reverb",
    name: "Aurora Reverb",
    category: "Reverb",
    description: "Damped stereo reverb — four combs and two allpasses per channel, with width.",
    js: "/plugins/aurora-reverb.js",
    wasm: "/plugins/aurora-reverb.wasm",
    version: "1.0.0",
  },
  {
    type: "echo-line",
    name: "Echo Line",
    category: "Delay",
    description: "Tape-style stereo delay with damped feedback and a smoothed Time control.",
    js: "/plugins/echo-line.js",
    wasm: "/plugins/echo-line.wasm",
    version: "1.0.0",
  },
  // Plain-JavaScript effects (no .wasm): track effects after LMN-3's set, STUDIO's own DSP.
  {
    type: "punch-comp",
    name: "Punch Compressor",
    category: "Dynamics",
    description: "Stereo-linked compressor with a soft knee, attack, release, makeup and a parallel mix.",
    js: "/plugins/punch-comp.js",
    version: "1.0.0",
  },
  {
    type: "sweep-filter",
    name: "Sweep Filter",
    category: "Filter",
    description: "24 dB/oct low-pass with resonance and drive; smooth to sweep for build-ups.",
    js: "/plugins/sweep-filter.js",
    version: "1.0.0",
  },
  {
    type: "silk-chorus",
    name: "Silk Chorus",
    category: "Modulation",
    description: "Two-voice stereo chorus with rate, depth and width.",
    js: "/plugins/silk-chorus.js",
    version: "1.0.0",
  },
  {
    type: "orbit-phaser",
    name: "Orbit Phaser",
    category: "Modulation",
    description: "Six-stage stereo phaser with feedback.",
    js: "/plugins/orbit-phaser.js",
    version: "1.0.0",
  },
];

export function findBuiltin(type) {
  return BUILTIN_PLUGINS.find((p) => p.type === type) || null;
}
