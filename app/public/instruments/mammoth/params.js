/**
 * Mammoth — parameter specification, enumerations, mod sources and the patch
 * format. This module is the single source of truth shared by the DSP
 * (mammoth-processor.js receives the compact table built here), the host, the
 * editor window and the Node tests.
 *
 * Every continuous parameter is stored NORMALISED (0..1, the knob position).
 * Modulation is added in that same knob space (depth -1..1), then mapped to the
 * real value with the parameter's curve — so a modulation arc drawn on a knob
 * is exactly what the engine does.
 */
import { TABLE_NAMES } from "./wavetables.js?v=1";

export const MAMMOTH_FORMAT = "mammoth-patch";
export const MAMMOTH_VERSION = 1;

/* ------------------------------------------------------------------ lists */

export const OSC_MODES = ["Spectrum", "Bend +", "Bend -", "Bend ±", "Formant", "Sync"];

/** Filter types with the labels of their three knobs ("n.a." = unused). */
export const FILTER_TYPES = [
  { name: "None", knobs: ["n.a.", "n.a.", "n.a."] },
  { name: "Lowpass 2", knobs: ["Cutoff", "Drive", "Resonance"] },
  { name: "Lowpass 4", knobs: ["Cutoff", "Drive", "Resonance"] },
  { name: "Bandpass", knobs: ["Cutoff", "n.a.", "Resonance"] },
  { name: "Highpass 2", knobs: ["Cutoff", "n.a.", "Resonance"] },
  { name: "Highpass 4", knobs: ["Cutoff", "n.a.", "Resonance"] },
  { name: "Notch", knobs: ["Cutoff", "n.a.", "Width"] },
  { name: "Daft", knobs: ["Cutoff", "Drive", "Resonance"] },
  { name: "Scream", knobs: ["Cutoff", "Scream", "Resonance"] },
  { name: "Acid", knobs: ["Cutoff", "Accent", "Resonance"] },
  { name: "Comb", knobs: ["Pitch", "Damping", "Feedback"] },
  { name: "Phaser", knobs: ["Cutoff", "Spread", "Feedback"] },
  { name: "Double Notch", knobs: ["Cutoff", "Spread", "Width"] },
  { name: "Formant", knobs: ["Vowel", "Shift", "Resonance"] },
];

/** Per-voice insert effects (two knobs each). */
export const INSERT_TYPES = [
  { name: "None", knobs: ["n.a.", "n.a."] },
  { name: "Delay", knobs: ["Dry/Wet", "Time"] },
  { name: "Clipper", knobs: ["Dry/Wet", "Drive"] },
  { name: "Sine Shaper", knobs: ["Dry/Wet", "Drive"] },
  { name: "Bitcrusher", knobs: ["Dry/Wet", "Crush"] },
  { name: "Freq Shift", knobs: ["Dry/Wet", "Pitch"] },
  { name: "Ring Mod", knobs: ["Dry/Wet", "Pitch"] },
  { name: "Sample & Hold", knobs: ["Dry/Wet", "Rate"] },
  { name: "Tilt EQ", knobs: ["Dry/Wet", "Tilt"] },
];

/** Master (stereo, post-voice) effects, three knobs each. */
export const FX_TYPES = [
  { name: "None", knobs: ["n.a.", "n.a.", "n.a."] },
  { name: "Classic Tube", knobs: ["Dry/Wet", "Drive", "Tone"] },
  { name: "Chorus", knobs: ["Dry/Wet", "Depth", "Rate"] },
  { name: "Flanger", knobs: ["Dry/Wet", "Rate", "Feedback"] },
  { name: "Phaser", knobs: ["Dry/Wet", "Rate", "Feedback"] },
  { name: "Delay Sync", knobs: ["Dry/Wet", "Damp", "Feedback"] },
  { name: "Reverb", knobs: ["Dry/Wet", "Size", "Damp"] },
  { name: "Dimension", knobs: ["Dry/Wet", "Size", "Width"] },
  { name: "Compressor", knobs: ["Dry/Wet", "Amount", "Release"] },
  { name: "Bit Crush", knobs: ["Dry/Wet", "Bits", "Rate"] },
];

/** Note divisions for the synced delay (length in beats). */
export const DELAY_DIVS = [
  ["1/32", 0.125], ["1/16T", 1 / 6], ["1/16", 0.25], ["1/16D", 0.375], ["1/8T", 1 / 3], ["1/8", 0.5],
  ["1/8D", 0.75], ["1/4T", 2 / 3], ["1/4", 1], ["1/4D", 1.5], ["1/2", 2], ["1/1", 4],
];

/** Tempo-synced rates for LFO cycles / performer & stepper steps (length in beats). */
export const SYNC_RATES = [
  ["8 bars", 32], ["4 bars", 16], ["2 bars", 8], ["1 bar", 4], ["1/2", 2], ["1/4D", 1.5], ["1/4", 1],
  ["1/4T", 2 / 3], ["1/8D", 0.75], ["1/8", 0.5], ["1/8T", 1 / 3], ["1/16D", 0.375], ["1/16", 0.25],
  ["1/16T", 1 / 6], ["1/32", 0.125], ["1/64", 0.0625],
];

export const LFO_SHAPES = ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "Random", "Smooth Rnd", "Exp Down"];
export const PERF_SHAPES = ["Flat", "Ramp Up", "Ramp Down", "Triangle", "Sine", "Exp Up", "Exp Down", "Square", "Off"];
export const SLOT_TYPES = ["LFO", "Performer", "Stepper"];
export const ENV_MODES = ["Gate", "One Shot", "Loop"];
export const NOISE_TYPES = ["White", "Pink", "Digital", "Crackle"];
export const FB_TAPS = ["Post F1", "Post F2", "Post Mix"];
export const INSERT_POS = ["Pre F1", "Pre F2", "Post Filters"];
export const VOICE_MODES = ["Poly", "Mono", "Legato"];
export const QUALITY = ["Eco", "High", "Ultra"];

/* ---------------------------------------------------------- mod sources */

/**
 * Modulation sources, in the engine's index order. `slot` numbers are the
 * labels shown in a knob's mod slot (1–8 like the source tabs).
 */
export const MOD_SOURCES = [
  { id: "env1", label: "1", name: "Envelope 1", kind: "env" },
  { id: "env2", label: "2", name: "Envelope 2", kind: "env" },
  { id: "env3", label: "3", name: "Envelope 3", kind: "env" },
  { id: "env4", label: "4", name: "Envelope 4 (Amp)", kind: "env" },
  { id: "mod5", label: "5", name: "Slot 5", kind: "lfo" },
  { id: "mod6", label: "6", name: "Slot 6", kind: "lfo" },
  { id: "mod7", label: "7", name: "Slot 7", kind: "lfo" },
  { id: "mod8", label: "8", name: "Slot 8", kind: "lfo" },
  { id: "macro1", label: "M1", name: "Macro 1", kind: "macro" },
  { id: "macro2", label: "M2", name: "Macro 2", kind: "macro" },
  { id: "macro3", label: "M3", name: "Macro 3", kind: "macro" },
  { id: "macro4", label: "M4", name: "Macro 4", kind: "macro" },
  { id: "macro5", label: "M5", name: "Macro 5", kind: "macro" },
  { id: "macro6", label: "M6", name: "Macro 6", kind: "macro" },
  { id: "macro7", label: "M7", name: "Macro 7", kind: "macro" },
  { id: "macro8", label: "M8", name: "Macro 8", kind: "macro" },
  { id: "vel", label: "Vl", name: "Velocity", kind: "perf" },
  { id: "ktr", label: "Kt", name: "Key Track", kind: "perf" },
  { id: "at", label: "AT", name: "Aftertouch", kind: "perf" },
  { id: "trr", label: "TR", name: "Trigger Random", kind: "perf" },
];
export const MOD_SOURCE_INDEX = Object.fromEntries(MOD_SOURCES.map((s, i) => [s.id, i]));
export const MAX_MODS_PER_PARAM = 3;
export const MAX_MODS = 64;

/* ------------------------------------------------------------ parameters */

/**
 * Curves (the engine implements the same codes):
 *   lin  : min + n·(max-min)
 *   exp  : min·(max/min)^n        (min > 0)
 *   pow2 : min + n²·(max-min)
 *   pow3 : min + n³·(max-min)
 */
export const CURVE_CODES = { lin: 0, exp: 1, pow2: 2, pow3: 3 };

const PARAMS = [];
function add(id, label, min, max, curve, def, unit = "", opts = {}) {
  PARAMS.push({
    id,
    label,
    min,
    max,
    curve,
    def,
    unit,
    mod: opts.mod !== false,
    group: opts.group || id.split(".")[0],
  });
}

for (let i = 1; i <= 3; i++) {
  add(`osc${i}.pitch`, "Pitch", -24, 24, "lin", 0.5, "st");
  add(`osc${i}.pos`, "Position", 0, 1, "lin", 0, "%");
  add(`osc${i}.int`, "Intensity", 0, 1, "lin", 1, "%");
  add(`osc${i}.amp`, "Amp", 0, 1, "pow2", i === 1 ? 0.8 : 0, "%");
  add(`osc${i}.route`, "Route", 0, 1, "lin", 0, "route");
  add(`osc${i}.fine`, "Fine", -100, 100, "lin", 0.5, "ct");
  add(`osc${i}.phase`, "Start Phase", 0, 1, "lin", 0, "%", { mod: false });
  add(`osc${i}.ktr`, "Key Track", 0, 200, "lin", 0.5, "%", { mod: false });
}
add("modosc.pitch", "Pitch", -24, 24, "lin", 0.5, "st");
add("modosc.rm", "RM", 0, 1, "lin", 0, "%");

add("noise.color", "Color", 0, 1, "lin", 0.5, "%");
add("noise.amp", "Amp", 0, 1, "pow2", 0, "%");
add("noise.route", "Route", 0, 1, "lin", 0, "route");

add("fb.amp", "Amp", 0, 1, "lin", 0, "%");
add("fb.route", "Route", 0, 1, "lin", 0, "route");

for (let j = 1; j <= 2; j++) {
  add(`filter${j}.cutoff`, "Cutoff", 0, 1, "lin", j === 1 ? 1 : 0.6, "cutoff");
  add(`filter${j}.b`, "B", 0, 1, "lin", 0, "%");
  add(`filter${j}.res`, "Resonance", 0, 1, "lin", 0, "%");
  add(`filter${j}.ktr`, "Key Track", 0, 1, "lin", 0, "%", { mod: false });
}
add("filters.serpar", "Ser/Par", 0, 1, "lin", 1, "serpar");
add("filters.mix", "Mix", 0, 1, "lin", 0, "mix");

for (let k = 1; k <= 2; k++) {
  add(`ins${k}.a`, "Dry/Wet", 0, 1, "lin", 0.5, "%");
  add(`ins${k}.b`, "B", 0, 1, "lin", 0.5, "%");
}

add("amp.mod", "Amp Mod", 0, 1, "lin", 0.8, "%");
add("amp.pan", "Pan", -1, 1, "lin", 0.5, "pan");
add("byp.mod", "Byp Mod", 0, 1, "lin", 0, "%");
add("master.vol", "Master", 0, 1, "lin", 0.7, "master", { mod: false });

for (let m = 1; m <= 2; m++) {
  add(`fx${m}.a`, "Dry/Wet", 0, 1, "lin", 0.3, "%");
  add(`fx${m}.b`, "B", 0, 1, "lin", 0.5, "%");
  add(`fx${m}.c`, "C", 0, 1, "lin", 0.5, "%");
}

add("eq.low", "Low", -15, 15, "lin", 0.5, "dB");
add("eq.mid", "Mid", -15, 15, "lin", 0.5, "dB");
add("eq.midf", "Mid Freq", 200, 8000, "exp", 0.5, "Hz");
add("eq.high", "High", -15, 15, "lin", 0.5, "dB");

for (let e = 1; e <= 4; e++) {
  add(`env${e}.delay`, "Delay", 0, 5, "pow3", 0, "s", { group: "env" });
  add(`env${e}.attack`, "Attack", 0.0005, 20, "exp", 0, "s", { group: "env" });
  add(`env${e}.decay`, "Decay", 0.002, 20, "exp", 0, "s", { group: "env" });
  add(`env${e}.sustain`, "Sustain", 0, 1, "lin", 0, "%", { group: "env" });
  add(`env${e}.release`, "Release", 0.002, 30, "exp", 0, "s", { group: "env" });
  add(`env${e}.curve`, "Morph", 0, 1, "lin", 0.5, "%", { group: "env" });
  add(`env${e}.vel`, "Vel", 0, 1, "lin", 0, "%", { group: "env", mod: false });
  add(`env${e}.ktr`, "KTr", 0, 1, "lin", 0, "%", { group: "env", mod: false });
}

for (let s = 5; s <= 8; s++) {
  add(`mod${s}.rate`, "Rate", 0.02, 40, "exp", 0.55, "rate", { group: "slot" });
  add(`mod${s}.amp`, "Amp", 0, 1, "lin", 1, "%", { group: "slot" });
  add(`mod${s}.xfade`, "XFade", 0, 1, "lin", 0, "%", { group: "slot" });
  add(`mod${s}.phase`, "Phase", 0, 1, "lin", 0, "%", { group: "slot", mod: false });
  add(`mod${s}.glide`, "Glide", 0, 1, "lin", 0.1, "%", { group: "slot" });
  add(`mod${s}.delay`, "Fade In", 0, 5, "pow2", 0, "s", { group: "slot" });
}

for (let q = 1; q <= 8; q++) {
  add(`macro${q}`, `Macro ${q}`, 0, 1, "lin", 0, "%", { group: "macro", mod: false });
}

add("voice.glide", "Glide", 0, 2, "pow3", 0, "s", { group: "voice" });
add("voice.detune", "Unison Detune", 0, 50, "lin", 0.3, "ct", { group: "voice", mod: false });
add("voice.spread", "Pan Spread", 0, 1, "lin", 0.6, "%", { group: "voice", mod: false });
add("voice.posspread", "Wt Spread", 0, 1, "lin", 0, "%", { group: "voice", mod: false });
add("global.tune", "Global Tune", -12, 12, "lin", 0.5, "st", { group: "global", mod: false });
add("global.bpm", "Preset BPM", 40, 240, "lin", 0.4, "bpm", { group: "global", mod: false });

export const MAMMOTH_PARAMS = PARAMS;
export const PARAM_INDEX = Object.fromEntries(PARAMS.map((p, i) => [p.id, i]));

/* ---------------------------------------------------------------- enums */

const ENUMS = [];
function addEnum(id, label, options, def) {
  ENUMS.push({ id, label, options, def });
}
const onOff = ["Off", "On"];
for (let i = 1; i <= 3; i++) {
  addEnum(`osc${i}.on`, `Oscillator ${i}`, onOff, 1);
  addEnum(`osc${i}.table`, "Wavetable", TABLE_NAMES, [0, 1, 4][i - 1]);
  addEnum(`osc${i}.mode`, "Mode", OSC_MODES, 0);
  addEnum(`osc${i}.restart`, "Phase", ["Free", "Restart"], 1);
}
addEnum("modosc.on", "Modulation Osc", onOff, 1);
addEnum("modosc.ring", "Ring Mod", ["Off", "1", "2", "3"], 0);
addEnum("modosc.phase", "Phase", ["Off", "1", "2", "3"], 0);
addEnum("modosc.pos", "Position", ["Off", "1", "2", "3"], 0);
addEnum("modosc.ffm", "Filter FM", ["Off", "1", "2"], 0);
addEnum("noise.on", "Noise", onOff, 1);
addEnum("noise.type", "Noise Type", NOISE_TYPES, 0);
addEnum("fb.on", "Feedback", onOff, 1);
addEnum("fb.tap", "Feedback Tap", FB_TAPS, 0);
for (let j = 1; j <= 2; j++) {
  addEnum(`filter${j}.on`, `Filter ${j}`, onOff, 1);
  addEnum(`filter${j}.type`, "Type", FILTER_TYPES.map((f) => f.name), j === 1 ? 2 : 0);
}
for (let k = 1; k <= 2; k++) {
  addEnum(`ins${k}.on`, `Insert ${k}`, onOff, 1);
  addEnum(`ins${k}.type`, "Type", INSERT_TYPES.map((f) => f.name), 0);
  addEnum(`ins${k}.pos`, "Position", INSERT_POS, 2);
}
addEnum("amp.on", "Amp", onOff, 1);
addEnum("byp.on", "Bypass", onOff, 1);
for (let m = 1; m <= 2; m++) {
  addEnum(`fx${m}.on`, `FX ${m}`, onOff, 1);
  addEnum(`fx${m}.type`, "Type", FX_TYPES.map((f) => f.name), 0);
  addEnum(`fx${m}.ldiv`, "Left", DELAY_DIVS.map((d) => d[0]), 5);
  addEnum(`fx${m}.rdiv`, "Right", DELAY_DIVS.map((d) => d[0]), 8);
}
addEnum("eq.on", "EQ", onOff, 0);
for (let e = 1; e <= 4; e++) {
  addEnum(`env${e}.mode`, "Mode", ENV_MODES, 0);
}
for (let s = 5; s <= 8; s++) {
  addEnum(`mod${s}.type`, "Type", SLOT_TYPES, s === 5 ? 0 : s === 6 ? 1 : 2);
  addEnum(`mod${s}.sync`, "Sync", onOff, 1);
  addEnum(`mod${s}.shapeA`, "Curve A", LFO_SHAPES, 0);
  addEnum(`mod${s}.shapeB`, "Curve B", LFO_SHAPES, 1);
  addEnum(`mod${s}.restart`, "Restart", ["Retrigger", "Free"], 0);
  addEnum(`mod${s}.len`, "Steps", Array.from({ length: 16 }, (_, i) => String(i + 1)), 15);
  addEnum(`mod${s}.polarity`, "Polarity", ["Unipolar", "Bipolar"], s === 5 ? 1 : 0);
}
addEnum("voice.poly", "Voices", Array.from({ length: 16 }, (_, i) => String(i + 1)), 7);
addEnum("voice.mode", "Voice Mode", VOICE_MODES, 0);
addEnum("voice.unison", "Unison", ["1", "2", "3", "4"], 0);
addEnum("voice.glidemode", "Glide Mode", ["Always", "Legato"], 0);
addEnum("global.quality", "Quality", QUALITY, 2);
addEnum("global.bpmsrc", "Tempo", ["Host", "Preset"], 0);

export const MAMMOTH_ENUMS = ENUMS;
export const ENUM_INDEX = Object.fromEntries(ENUMS.map((e, i) => [e.id, i]));

/* -------------------------------------------------------------- mapping */

export function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Normalised knob position → real value for parameter `p` (object or id). */
export function mapValue(p, n) {
  const spec = typeof p === "string" ? PARAMS[PARAM_INDEX[p]] : p;
  const x = clamp01(n);
  switch (spec.curve) {
    case "exp":
      return spec.min * Math.pow(spec.max / spec.min, x);
    case "pow2":
      return spec.min + x * x * (spec.max - spec.min);
    case "pow3":
      return spec.min + x * x * x * (spec.max - spec.min);
    default:
      return spec.min + x * (spec.max - spec.min);
  }
}

/** Real value → normalised knob position (inverse of mapValue). */
export function normFor(p, value) {
  const spec = typeof p === "string" ? PARAMS[PARAM_INDEX[p]] : p;
  if (!spec) throw new Error(`Unknown Mammoth parameter: ${p}`);
  const v = Math.max(Math.min(spec.min, spec.max), Math.min(Math.max(spec.min, spec.max), value));
  const span = spec.max - spec.min;
  switch (spec.curve) {
    case "exp":
      return clamp01(Math.log(v / spec.min) / Math.log(spec.max / spec.min));
    case "pow2":
      return clamp01(Math.sqrt((v - spec.min) / span));
    case "pow3":
      return clamp01(Math.cbrt((v - spec.min) / span));
    default:
      return clamp01((v - spec.min) / span);
  }
}

/** Compact table for the DSP: [[id, min, max, curveCode], …] in index order. */
export function engineParamTable() {
  return PARAMS.map((p) => [p.id, p.min, p.max, CURVE_CODES[p.curve] || 0]);
}

/** Cutoff knob → Hz (shared by DSP and display): 20 Hz … 20 kHz, exponential. */
export function cutoffHz(n) {
  return 20 * Math.pow(1000, clamp01(n));
}

const VOWELS = ["A", "E", "I", "O", "U"];

/** Display text for a parameter value; `ctx` carries the filter/insert/fx type when the meaning depends on it. */
export function formatParam(id, n, ctx = {}) {
  const spec = PARAMS[PARAM_INDEX[id]];
  if (!spec) return String(n);
  const v = mapValue(spec, n);
  const pct = (x) => `${Math.round(x * 100)}%`;
  switch (spec.unit) {
    case "st":
      return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(2)}`;
    case "ct":
      return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(0)} ct`;
    case "s": {
      if (v < 0.001) return "0 ms";
      if (v < 1) return `${(v * 1000).toFixed(v < 0.01 ? 1 : 0)} ms`;
      return `${v.toFixed(2)} s`;
    }
    case "Hz":
      return v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`;
    case "dB":
      return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)} dB`;
    case "pan":
      if (Math.abs(v) < 0.02) return "C";
      return v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;
    case "route":
      if (n <= 0.02) return "F1";
      if (n >= 0.98) return "F2";
      return `F1 ${Math.round((1 - n) * 100)} · F2 ${Math.round(n * 100)}`;
    case "serpar":
      return n <= 0.02 ? "Serial" : n >= 0.98 ? "Parallel" : `Ser ${Math.round((1 - n) * 100)}%`;
    case "mix":
      return n <= 0.02 ? "Mix 1" : n >= 0.98 ? "Mix 2" : `${Math.round((1 - n) * 100)} / ${Math.round(n * 100)}`;
    case "master": {
      const g = n * n * 2.04;
      if (g <= 0.0001) return "Off";
      const db = 20 * Math.log10(g);
      return `${db >= 0 ? "+" : "-"}${Math.abs(db).toFixed(1)} dB`;
    }
    case "bpm":
      return `${v.toFixed(1)}`;
    case "rate": {
      if (ctx.synced) {
        const r = SYNC_RATES[Math.round(clamp01(n) * (SYNC_RATES.length - 1))];
        return r[0];
      }
      return v < 1 ? `${v.toFixed(2)} Hz` : `${v.toFixed(1)} Hz`;
    }
    case "cutoff": {
      if (ctx.filterType === 10) {
        // Comb pitch: shown as the frequency of the comb's fundamental.
        const hz = cutoffHz(n);
        return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
      }
      if (ctx.filterType === 13) {
        const pos = clamp01(n) * (VOWELS.length - 1);
        const a = Math.floor(pos);
        const b = Math.min(VOWELS.length - 1, a + 1);
        const f = pos - a;
        return f < 0.15 ? VOWELS[a] : f > 0.85 ? VOWELS[b] : `${VOWELS[a]}/${VOWELS[b]}`;
      }
      const hz = cutoffHz(n);
      return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
    }
    case "%":
    default:
      if (spec.min === 0 && spec.max === 1) return pct(v);
      if (spec.max === 200) return `${Math.round(v)}%`;
      return `${Math.round(v * 100) / 100}`;
  }
}

/* --------------------------------------------------------------- patches */

export const DEFAULT_MACRO_NAMES = ["Macro 1", "Macro 2", "Macro 3", "Macro 4", "Macro 5", "Macro 6", "Macro 7", "Macro 8"];

function defaultSeq() {
  const seq = {};
  for (let s = 5; s <= 8; s++) {
    seq[`mod${s}`] = {
      steps:
        s === 6
          ? [1, 0.6, 0.85, 0.4, 1, 0.5, 0.75, 0.3, 1, 0.6, 0.85, 0.4, 1, 0.5, 0.75, 0.3]
          : s === 7
            ? [1, 0.25, 0.75, 0.5, 1, 0, 0.5, 0.25, 1, 0.25, 0.75, 0.5, 0.875, 0.125, 0.625, 0.375]
            : [0.5, 1, 0.25, 0.75, 0.5, 1, 0, 0.75, 0.5, 1, 0.25, 0.75, 0.5, 1, 0.125, 0.875],
      shapes: s === 6 ? [6, 1, 2, 4, 6, 1, 2, 4, 6, 1, 2, 4, 6, 1, 3, 5] : new Array(16).fill(0),
    };
  }
  return seq;
}

/** The Init patch: one saw-ish oscillator through an open 4-pole lowpass. */
export function makeInitPatch() {
  const params = {};
  for (const p of PARAMS) params[p.id] = p.def;
  // Envelopes: 1–3 are modulation envelopes, 4 drives the amplitude.
  for (let e = 1; e <= 4; e++) {
    params[`env${e}.attack`] = normFor(`env${e}.attack`, e === 4 ? 0.002 : 0.001);
    params[`env${e}.decay`] = normFor(`env${e}.decay`, e === 4 ? 0.6 : 0.5);
    params[`env${e}.sustain`] = e === 4 ? 1 : 0;
    params[`env${e}.release`] = normFor(`env${e}.release`, e === 4 ? 0.22 : 0.3);
  }
  params["env4.vel"] = 0.5;
  params["mod5.rate"] = 9 / 15; // synced: 1/8
  params["mod6.rate"] = 12 / 15; // synced: 1/16
  params["mod7.rate"] = 12 / 15;
  params["mod8.rate"] = 12 / 15;
  params["global.bpm"] = normFor("global.bpm", 120);
  const enums = {};
  for (const e of ENUMS) enums[e.id] = e.def;
  return {
    format: MAMMOTH_FORMAT,
    version: MAMMOTH_VERSION,
    name: "Init",
    category: "Init",
    tags: [],
    author: "",
    notes: "",
    params,
    enums,
    mods: [],
    seq: defaultSeq(),
    macroNames: DEFAULT_MACRO_NAMES.slice(),
  };
}

const PATCH_CATEGORIES = ["Init", "Bass", "Lead", "Pad", "Pluck", "Keys", "Arp", "Sequence", "FX", "Drum", "Texture", "User"];
export const MAMMOTH_CATEGORIES = PATCH_CATEGORIES;

function finite(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Validates any JSON into a complete, safe patch. Unknown keys are dropped,
 * numbers clamped, enums bounded, modulation routings de-duplicated and
 * capped. Never throws.
 */
export function sanitizePatch(raw) {
  const base = makeInitPatch();
  if (!raw || typeof raw !== "object") return base;
  const out = base;
  out.name = String(raw.name || "Untitled").slice(0, 48);
  out.category = PATCH_CATEGORIES.includes(raw.category) ? raw.category : "User";
  out.tags = Array.isArray(raw.tags) ? raw.tags.slice(0, 12).map((t) => String(t).slice(0, 24)) : [];
  out.author = String(raw.author || "").slice(0, 48);
  out.notes = String(raw.notes || "").slice(0, 400);
  if (raw.params && typeof raw.params === "object") {
    for (const p of PARAMS) {
      if (p.id in raw.params) out.params[p.id] = clamp01(finite(Number(raw.params[p.id]), p.def));
    }
  }
  if (raw.enums && typeof raw.enums === "object") {
    for (const e of ENUMS) {
      if (e.id in raw.enums) {
        const v = Math.round(finite(Number(raw.enums[e.id]), e.def));
        out.enums[e.id] = Math.max(0, Math.min(e.options.length - 1, v));
      }
    }
  }
  if (Array.isArray(raw.mods)) {
    const perParam = {};
    const seen = new Set();
    for (const m of raw.mods) {
      if (!m || typeof m !== "object") continue;
      const dst = String(m.dst || "");
      const src = String(m.src || "");
      const spec = PARAMS[PARAM_INDEX[dst]];
      if (!spec || !spec.mod || !(src in MOD_SOURCE_INDEX)) continue;
      const key = `${src}>${dst}`;
      if (seen.has(key)) continue;
      perParam[dst] = (perParam[dst] || 0) + 1;
      if (perParam[dst] > MAX_MODS_PER_PARAM) continue;
      seen.add(key);
      const amt = Math.max(-1, Math.min(1, finite(Number(m.amt), 0)));
      out.mods.push({ src, dst, amt });
      if (out.mods.length >= MAX_MODS) break;
    }
  }
  if (raw.seq && typeof raw.seq === "object") {
    for (let s = 5; s <= 8; s++) {
      const r = raw.seq[`mod${s}`];
      if (!r || typeof r !== "object") continue;
      const dst = out.seq[`mod${s}`];
      if (Array.isArray(r.steps)) {
        for (let i = 0; i < 16; i++) dst.steps[i] = clamp01(finite(Number(r.steps[i]), dst.steps[i]));
      }
      if (Array.isArray(r.shapes)) {
        for (let i = 0; i < 16; i++) {
          const v = Math.round(finite(Number(r.shapes[i]), dst.shapes[i]));
          dst.shapes[i] = Math.max(0, Math.min(PERF_SHAPES.length - 1, v));
        }
      }
    }
  }
  if (Array.isArray(raw.macroNames)) {
    for (let q = 0; q < 8; q++) {
      if (typeof raw.macroNames[q] === "string" && raw.macroNames[q].trim()) {
        out.macroNames[q] = raw.macroNames[q].trim().slice(0, 14);
      }
    }
  }
  return out;
}

/** Deep copy (JSON-safe; patches hold no typed arrays). */
export function clonePatch(patch) {
  return JSON.parse(JSON.stringify(patch));
}

/** Which wavetables a patch needs (so the host only builds those). */
export function tablesUsed(patch) {
  const set = new Set();
  for (let i = 1; i <= 3; i++) set.add(patch.enums[`osc${i}.table`] | 0);
  return Array.from(set);
}
