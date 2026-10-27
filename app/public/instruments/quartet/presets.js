/** Quartet factory sounds. Each is a partial patch; sanitizePatch fills in the rest. */
import { sanitizePatch } from "./params.js?v=1";

const o = (wave, extra = {}) => Object.assign({ on: true, wave, octave: 0, semi: 0, fine: 0, level: 0.7, pan: 0, unison: 1, spread: 12 }, extra);
const off = { on: false };

const RAW = [
  {
    name: "Supersaw Lead",
    oscs: [o("sawtooth", { unison: 4, spread: 22, level: 0.6 }), o("sawtooth", { octave: 1, unison: 2, spread: 14, level: 0.35 }), o("square", { octave: -1, level: 0.3 }), off],
    filter: { type: "lowpass", cutoff: 4200, reso: 1.2, env: 0.35, keytrack: 0.5 },
    ampEnv: { a: 0.006, d: 0.4, s: 0.8, r: 0.3 },
    filterEnv: { a: 0.005, d: 0.5, s: 0.4, r: 0.3 },
    lfo: { target: "pitch", shape: "sine", rate: 5.5, depth: 0.08 },
    volume: -9,
  },
  {
    name: "Warm Pad",
    oscs: [o("sawtooth", { unison: 3, spread: 16, level: 0.5 }), o("triangle", { octave: -1, level: 0.5 }), o("square", { fine: 7, level: 0.25 }), off],
    filter: { type: "lowpass", cutoff: 1400, reso: 0.7, env: 0.25, keytrack: 0.3 },
    ampEnv: { a: 0.8, d: 1.2, s: 0.8, r: 1.6 },
    filterEnv: { a: 1.2, d: 1.5, s: 0.5, r: 1.6 },
    lfo: { target: "filter", shape: "sine", rate: 0.3, depth: 0.25 },
    volume: -10,
  },
  {
    name: "Sub Bass",
    oscs: [o("sine", { octave: -1, level: 0.9 }), o("triangle", { octave: -1, level: 0.35 }), o("square", { level: 0.12 }), off],
    filter: { type: "lowpass", cutoff: 900, reso: 0.6, env: 0.1, keytrack: 0.2 },
    ampEnv: { a: 0.004, d: 0.2, s: 0.9, r: 0.12 },
    filterEnv: { a: 0.002, d: 0.2, s: 0.3, r: 0.1 },
    volume: -4,
  },
  {
    name: "Pluck",
    oscs: [o("sawtooth", { level: 0.6 }), o("square", { octave: 1, level: 0.3 }), off, o("noise", { level: 0.08 })],
    filter: { type: "lowpass", cutoff: 600, reso: 2.5, env: 0.75, keytrack: 0.6 },
    ampEnv: { a: 0.002, d: 0.35, s: 0, r: 0.25 },
    filterEnv: { a: 0.001, d: 0.22, s: 0, r: 0.2 },
    volume: -6,
  },
  {
    name: "Brass Stab",
    oscs: [o("sawtooth", { unison: 2, spread: 10, level: 0.6 }), o("sawtooth", { semi: 7, level: 0.3 }), o("sawtooth", { octave: -1, level: 0.4 }), off],
    filter: { type: "lowpass", cutoff: 900, reso: 1.4, env: 0.6, keytrack: 0.5 },
    ampEnv: { a: 0.02, d: 0.35, s: 0.5, r: 0.2 },
    filterEnv: { a: 0.04, d: 0.3, s: 0.35, r: 0.2 },
    volume: -8,
  },
  {
    name: "Square Lead",
    oscs: [o("square", { level: 0.6 }), o("square", { octave: 1, fine: 6, level: 0.25 }), off, off],
    filter: { type: "lowpass", cutoff: 2600, reso: 2, env: 0.25, keytrack: 0.5 },
    ampEnv: { a: 0.005, d: 0.2, s: 0.85, r: 0.15 },
    filterEnv: { a: 0.005, d: 0.25, s: 0.5, r: 0.15 },
    lfo: { target: "pitch", shape: "triangle", rate: 6, depth: 0.1 },
    volume: -9,
  },
  {
    name: "Glass Bell",
    oscs: [o("sine", { level: 0.6 }), o("sine", { octave: 2, semi: 7, level: 0.25 }), o("triangle", { octave: 1, fine: 3, level: 0.25 }), off],
    filter: { type: "lowpass", cutoff: 9000, reso: 0.5, env: 0, keytrack: 0.3 },
    ampEnv: { a: 0.002, d: 1.4, s: 0, r: 1.2 },
    filterEnv: { a: 0.001, d: 0.5, s: 0.5, r: 0.5 },
    lfo: { target: "amp", shape: "sine", rate: 4, depth: 0.12 },
    volume: -8,
  },
  {
    name: "Organ",
    oscs: [o("sine", { level: 0.5 }), o("sine", { octave: 1, level: 0.35 }), o("sine", { octave: -1, level: 0.4 }), o("sine", { octave: 1, semi: 7, level: 0.2 })],
    filter: { type: "lowpass", cutoff: 7000, reso: 0.4, env: 0, keytrack: 0 },
    ampEnv: { a: 0.01, d: 0.1, s: 1, r: 0.08 },
    filterEnv: { a: 0.01, d: 0.1, s: 1, r: 0.1 },
    lfo: { target: "amp", shape: "sine", rate: 6.5, depth: 0.15 },
    volume: -9,
  },
  {
    name: "Acid Bass",
    oscs: [o("sawtooth", { octave: -1, level: 0.75 }), off, off, off],
    filter: { type: "lowpass", cutoff: 300, reso: 12, env: 0.8, keytrack: 0.5 },
    ampEnv: { a: 0.002, d: 0.25, s: 0.6, r: 0.1 },
    filterEnv: { a: 0.001, d: 0.18, s: 0.05, r: 0.1 },
    volume: -8,
  },
  {
    name: "Noise Riser",
    oscs: [o("noise", { level: 0.7 }), o("sawtooth", { unison: 3, spread: 30, level: 0.25 }), off, off],
    filter: { type: "bandpass", cutoff: 400, reso: 3, env: 0.9, keytrack: 0 },
    ampEnv: { a: 2.5, d: 0.5, s: 1, r: 0.6 },
    filterEnv: { a: 3, d: 1, s: 1, r: 0.6 },
    volume: -12,
  },
  { name: "Init" },
];

export const FACTORY_PRESETS = RAW.map((p) => sanitizePatch(p));
export const DEFAULT_PRESET = "Supersaw Lead";
