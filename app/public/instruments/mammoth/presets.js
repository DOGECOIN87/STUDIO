/**
 * Mammoth — factory presets.
 *
 * Each preset is a small diff over the Init patch:
 *   params : knob positions (0..1) — wavetable position, amps, resonance, mixes…
 *   real   : values in real units, converted with the parameter's curve
 *            (Hz for cutoffs, seconds for envelope times, semitones, cents, Hz rates)
 *   enums  : switches and menus (wavetable index, filter type, FX type…)
 *   mods   : [source, target, depth] — depth is in knob space (−1..1)
 *   seq    : performer / stepper patterns for slots 5–8
 *   level  : master knob, used to even out loudness between presets
 * All sounds were designed for this engine; names and patches are original.
 */
import { makeInitPatch, sanitizePatch, normFor, clamp01, MAMMOTH_PARAMS, PARAM_INDEX, SYNC_RATES, DELAY_DIVS } from "./params.js?v=1";

const CUTOFF = (hz) => clamp01(Math.log(hz / 20) / Math.log(1000));
const SYNC = (label) => SYNC_RATES.findIndex((r) => r[0] === label) / (SYNC_RATES.length - 1);
const DIV = (label) => DELAY_DIVS.findIndex((d) => d[0] === label);

// Wavetable indices (see wavetables.js).
const T = {
  sineSaw: 0,
  squareSaw: 1,
  pulse: 2,
  addOdd: 3,
  addFull: 4,
  vox: 5,
  sync: 6,
  fold: 7,
  metal: 8,
  chirp: 9,
  steps: 10,
  organ: 11,
  growl: 12,
  scrap: 13,
  sawStack: 14,
  warm: 15,
};
// Filter / insert / FX indices (see params.js lists).
const F = { none: 0, lp2: 1, lp4: 2, bp: 3, hp2: 4, hp4: 5, notch: 6, daft: 7, scream: 8, acid: 9, comb: 10, phaser: 11, dnotch: 12, formant: 13 };
const INS = { none: 0, delay: 1, clip: 2, sine: 3, crush: 4, fshift: 5, ring: 6, sh: 7, tilt: 8 };
const FX = { none: 0, tube: 1, chorus: 2, flanger: 3, phaser: 4, delay: 5, reverb: 6, dimension: 7, comp: 8, crush: 9 };

/** Builds a complete, sanitized patch from a diff (exported for tests and tools). */
export function presetFromDiff(d) {
  const p = makeInitPatch();
  p.name = d.name;
  p.category = d.category;
  p.tags = d.tags || [];
  p.author = "Factory";
  p.notes = d.notes || "";
  Object.assign(p.params, d.params || {});
  if (typeof d.level === "number") p.params["master.vol"] = d.level;
  for (const id of Object.keys(d.real || {})) {
    const spec = MAMMOTH_PARAMS[PARAM_INDEX[id]];
    if (!spec) continue;
    p.params[id] = spec.unit === "cutoff" ? CUTOFF(d.real[id]) : normFor(spec, d.real[id]);
  }
  Object.assign(p.enums, d.enums || {});
  p.mods = (d.mods || []).map(([src, dst, amt]) => ({ src, dst, amt }));
  if (d.seq) {
    for (const k of Object.keys(d.seq)) {
      const r = d.seq[k];
      if (r.steps) p.seq[k].steps = r.steps.slice(0, 16);
      if (r.shapes) p.seq[k].shapes = r.shapes.slice(0, 16);
    }
  }
  if (d.macroNames) d.macroNames.forEach((n, i) => (p.macroNames[i] = n));
  return sanitizePatch(p);
}

const env = (e, a, d, r, extra = {}) => ({
  [`env${e}.attack`]: a,
  [`env${e}.decay`]: d,
  [`env${e}.release`]: r,
  ...extra,
});

const DIFFS = [
  /* ------------------------------------------------------------- bass */
  {
    name: "Mammoth Sub",
    level: 0.95,
    category: "Bass",
    tags: ["sub", "mono", "clean"],
    notes: "Round sine-weighted sub with a short filter blip. Macro 1 opens the filter.",
    enums: { "osc2.table": T.squareSaw, "voice.mode": 1, "voice.glidemode": 1, "filter1.type": F.lp4 },
    params: { "osc1.pos": 0.08, "osc1.amp": 0.85, "osc2.pos": 0.35, "osc2.amp": 0.42, "filter1.res": 0.2, "env4.sustain": 0.85, "env1.sustain": 0, "env4.vel": 0.3 },
    real: { "filter1.cutoff": 320, ...env(4, 0.002, 0.5, 0.12), ...env(1, 0.001, 0.25, 0.2), "voice.glide": 0.04 },
    mods: [["env1", "filter1.cutoff", 0.22], ["macro1", "filter1.cutoff", 0.4], ["macro2", "osc2.amp", 0.5]],
    macroNames: ["Cutoff", "Grit"],
  },
  {
    name: "Wobble Glacier",
    category: "Bass",
    tags: ["wobble", "dubstep", "lfo"],
    notes: "Tempo-synced 1/8 wobble on a driven ladder filter. Macro 1 doubles the wobble speed.",
    enums: { "osc1.table": T.squareSaw, "osc2.table": T.sync, "voice.mode": 1, "filter1.type": F.lp4, "fx1.type": FX.tube, "mod5.polarity": 0 },
    params: {
      "osc1.pos": 0.8, "osc1.amp": 0.8, "osc2.pos": 0.4, "osc2.amp": 0.55, "filter1.res": 0.55, "filter1.b": 0.3,
      "env4.sustain": 1, "mod5.rate": SYNC("1/8"), "fx1.a": 0.35, "fx1.b": 0.45, "fx1.c": 0.6,
    },
    real: { "osc2.pitch": -12, "filter1.cutoff": 160, ...env(4, 0.003, 0.4, 0.1) },
    mods: [["mod5", "filter1.cutoff", 0.5], ["mod5", "osc2.pos", 0.35], ["macro1", "mod5.rate", 0.14]],
    macroNames: ["Speed"],
  },
  {
    name: "Tusk Reese",
    level: 0.72,
    category: "Bass",
    tags: ["reese", "detuned", "dnb"],
    notes: "Two detuned saw stacks plus a sub octave, slowly drifting wavetable position.",
    enums: { "osc1.table": T.sawStack, "osc2.table": T.sawStack, "osc3.table": T.squareSaw, "voice.unison": 1, "filter1.type": F.lp4, "fx1.type": FX.chorus, "mod5.sync": 0 },
    params: {
      "osc1.pos": 0.3, "osc1.amp": 0.7, "osc2.pos": 0.45, "osc2.amp": 0.65, "osc3.pos": 0.1, "osc3.amp": 0.45,
      "filter1.res": 0.25, "env4.sustain": 1, "fx1.a": 0.25, "fx1.b": 0.4, "fx1.c": 0.2, "voice.spread": 0.4,
    },
    real: { "osc2.fine": 14, "osc3.pitch": -12, "filter1.cutoff": 900, "voice.detune": 18, ...env(4, 0.004, 0.5, 0.18), "mod5.rate": 0.25 },
    mods: [["mod5", "osc1.pos", 0.3], ["mod5", "osc2.pos", -0.3], ["macro1", "filter1.cutoff", 0.35]],
    macroNames: ["Cutoff"],
  },
  {
    name: "Growl Monster",
    level: 0.8,
    category: "Bass",
    tags: ["growl", "formant", "aggressive"],
    notes: "Formant-mode comb table swept by a 1/4 LFO into a driven Daft filter and clipper.",
    enums: {
      "osc1.table": T.growl, "osc1.mode": 4, "osc2.table": T.fold, "voice.mode": 1, "filter1.type": F.daft,
      "ins1.type": INS.clip, "fx1.type": FX.tube, "mod5.polarity": 0, "mod5.shapeA": 1,
    },
    params: {
      "osc1.pos": 0.2, "osc1.int": 0.35, "osc1.amp": 0.8, "osc2.pos": 0.5, "osc2.amp": 0.4, "filter1.res": 0.4,
      "filter1.b": 0.55, "ins1.a": 0.4, "ins1.b": 0.45, "env4.sustain": 1, "mod5.rate": SYNC("1/4"),
      "fx1.a": 0.3, "fx1.b": 0.5, "fx1.c": 0.45,
    },
    real: { "osc2.pitch": -12, "filter1.cutoff": 1200, ...env(4, 0.003, 0.3, 0.12) },
    mods: [["mod5", "osc1.pos", 0.6], ["mod5", "filter1.cutoff", 0.25], ["macro1", "osc1.int", 0.5]],
    macroNames: ["Formant"],
  },
  {
    name: "Acid Mammal",
    level: 0.85,
    category: "Bass",
    tags: ["acid", "303", "glide"],
    notes: "Saw into the Acid ladder with an accent envelope; legato notes slide.",
    enums: { "osc1.table": T.squareSaw, "voice.mode": 2, "voice.glidemode": 1, "filter1.type": F.acid, "fx1.type": FX.delay, "fx1.ldiv": DIV("1/8D"), "fx1.rdiv": DIV("1/4") },
    params: { "osc1.pos": 1, "osc1.amp": 0.8, "filter1.res": 0.82, "filter1.b": 0.6, "env4.sustain": 0.9, "env1.sustain": 0, "fx1.a": 0.18, "fx1.b": 0.4, "fx1.c": 0.35 },
    real: { "filter1.cutoff": 380, ...env(4, 0.002, 0.3, 0.08), ...env(1, 0.001, 0.18, 0.1), "voice.glide": 0.06 },
    mods: [["env1", "filter1.cutoff", 0.38], ["vel", "filter1.cutoff", 0.12], ["macro1", "filter1.res", 0.15]],
    macroNames: ["Squelch"],
  },
  {
    name: "Bone FM Bass",
    level: 0.85,
    category: "Bass",
    tags: ["fm", "punchy"],
    notes: "Phase modulation from the Mod OSC an octave up, with a decaying index.",
    enums: { "osc1.table": T.sineSaw, "modosc.phase": 1, "voice.mode": 1, "filter1.type": F.lp2, "osc2.table": T.sineSaw },
    params: { "osc1.pos": 0.04, "osc1.amp": 0.85, "osc2.pos": 0, "osc2.amp": 0.5, "modosc.rm": 0.2, "env4.sustain": 0.8, "env2.sustain": 0.1 },
    real: { "modosc.pitch": 12, "osc2.pitch": -12, "filter1.cutoff": 2400, ...env(4, 0.002, 0.6, 0.1), ...env(2, 0.001, 0.22, 0.1) },
    mods: [["env2", "modosc.rm", 0.45], ["vel", "modosc.rm", 0.2], ["macro1", "modosc.rm", 0.4]],
    macroNames: ["Bite"],
  },

  /* ------------------------------------------------------------- lead */
  {
    name: "Ice Age Lead",
    level: 0.66,
    category: "Lead",
    tags: ["supersaw", "wide", "trance"],
    notes: "Three-voice unison saw stack with a dotted delay and some air.",
    enums: { "osc1.table": T.sawStack, "osc2.table": T.squareSaw, "voice.unison": 2, "filter1.type": F.lp4, "fx1.type": FX.delay, "fx1.ldiv": DIV("1/8D"), "fx1.rdiv": DIV("1/4"), "fx2.type": FX.reverb },
    params: {
      "osc1.pos": 0.5, "osc1.amp": 0.7, "osc2.pos": 0.75, "osc2.amp": 0.5, "filter1.res": 0.2, "env4.sustain": 0.9,
      "voice.spread": 0.85, "fx1.a": 0.22, "fx1.b": 0.5, "fx1.c": 0.4, "fx2.a": 0.2, "fx2.b": 0.6, "fx2.c": 0.4,
    },
    real: { "osc2.fine": 7, "filter1.cutoff": 3800, "voice.detune": 22, ...env(4, 0.005, 0.5, 0.28) },
    mods: [["macro1", "filter1.cutoff", 0.3], ["macro2", "fx2.a", 0.5], ["vel", "filter1.cutoff", 0.08]],
    macroNames: ["Bright", "Space"],
  },
  {
    name: "Hero Lead",
    level: 0.66,
    category: "Lead",
    tags: ["supersaw", "anthem", "vibrato", "legato"],
    notes: "Four-voice saw stack with an octave layer, a filter swell on every note, vibrato that fades in, legato glide, a dotted-eighth echo and a big hall.",
    enums: {
      "osc1.table": T.sawStack, "osc2.table": T.squareSaw, "voice.unison": 3, "voice.mode": 2, "filter1.type": F.lp4,
      "fx1.type": FX.delay, "fx1.ldiv": DIV("1/8D"), "fx1.rdiv": DIV("1/4"), "fx2.type": FX.reverb, "mod5.sync": 0, "mod5.shapeA": 0,
    },
    params: {
      "osc1.pos": 0.55, "osc1.amp": 0.75, "osc2.pos": 0.8, "osc2.amp": 0.32, "filter1.res": 0.24, "env4.sustain": 0.92, "env1.sustain": 0.42,
      "voice.spread": 0.9, "fx1.a": 0.24, "fx1.b": 0.45, "fx1.c": 0.45, "fx2.a": 0.26, "fx2.b": 0.75, "fx2.c": 0.45,
    },
    real: {
      "osc2.pitch": 12, "osc2.fine": 6, "filter1.cutoff": 2400, "voice.detune": 26, "voice.glide": 0.05,
      "mod5.rate": 5.5, "mod5.delay": 0.35, ...env(4, 0.012, 0.6, 0.45), ...env(1, 0.015, 0.9, 0.4),
    },
    mods: [
      ["env1", "filter1.cutoff", 0.3], ["vel", "filter1.cutoff", 0.1], ["macro1", "filter1.cutoff", 0.25],
      ["mod5", "osc1.pitch", 0.004], ["mod5", "osc2.pitch", 0.004], ["macro2", "fx2.a", 0.5],
    ],
    macroNames: ["Bright", "Space"],
  },
  {
    name: "Formant Shout",
    level: 0.8,
    category: "Lead",
    tags: ["vocal", "formant", "talking"],
    notes: "The vowel table sweeps A→U on a synced triangle LFO.",
    enums: { "osc1.table": T.vox, "osc2.table": T.squareSaw, "filter1.type": F.lp2, "fx1.type": FX.chorus, "mod5.shapeA": 1, "mod5.polarity": 0 },
    params: { "osc1.pos": 0.1, "osc1.amp": 0.85, "osc2.pos": 1, "osc2.amp": 0.3, "env4.sustain": 0.9, "mod5.rate": SYNC("1/4"), "fx1.a": 0.3, "fx1.b": 0.5, "fx1.c": 0.3 },
    real: { "osc2.pitch": -12, "filter1.cutoff": 6500, ...env(4, 0.01, 0.4, 0.2) },
    mods: [["mod5", "osc1.pos", 0.8], ["macro1", "mod5.rate", 0.2]],
    macroNames: ["Talk Rate"],
  },
  {
    name: "Sync Screamer",
    level: 0.78,
    category: "Lead",
    tags: ["sync", "mono", "aggressive"],
    notes: "Hard-sync sweep driven by Env 1 into the Scream filter; mono with glide.",
    enums: { "osc1.table": T.sync, "osc2.table": T.squareSaw, "voice.mode": 2, "filter1.type": F.scream, "fx1.type": FX.delay, "fx2.type": FX.reverb },
    params: {
      "osc1.pos": 0.15, "osc1.amp": 0.8, "osc2.pos": 0.9, "osc2.amp": 0.35, "filter1.b": 0.3, "filter1.res": 0.3,
      "env4.sustain": 0.95, "env1.sustain": 0.25, "fx1.a": 0.15, "fx1.c": 0.3, "fx2.a": 0.15,
    },
    real: { "osc2.pitch": 7, "filter1.cutoff": 2200, ...env(4, 0.003, 0.4, 0.2), ...env(1, 0.01, 0.6, 0.3), "voice.glide": 0.08 },
    mods: [["env1", "osc1.pos", 0.7], ["macro1", "filter1.b", 0.6], ["at", "osc1.pos", 0.4]],
    macroNames: ["Scream"],
  },
  {
    name: "Glass Whistle",
    level: 0.8,
    category: "Lead",
    tags: ["soft", "vibrato", "breathy"],
    notes: "Near-sine additive tone with delayed vibrato and a breath of pink noise.",
    enums: { "osc1.table": T.addOdd, "osc2.table": T.sineSaw, "noise.type": 1, "voice.mode": 2, "filter1.type": F.lp2, "fx2.type": FX.reverb, "mod5.sync": 0 },
    params: { "osc1.pos": 0.12, "osc1.amp": 0.85, "osc2.pos": 0, "osc2.amp": 0.25, "noise.amp": 0.22, "noise.color": 0.65, "env4.sustain": 1, "fx2.a": 0.3, "fx2.b": 0.7, "fx2.c": 0.5 },
    real: { "osc2.pitch": 12, "filter1.cutoff": 5200, ...env(4, 0.04, 0.4, 0.3), "mod5.rate": 5.5, "mod5.delay": 0.45, "voice.glide": 0.05 },
    mods: [["mod5", "osc1.pitch", 0.006], ["mod5", "osc2.pitch", 0.006], ["macro1", "noise.amp", 0.4]],
    macroNames: ["Breath"],
  },
  {
    name: "Chip Tusk",
    level: 0.85,
    category: "Lead",
    tags: ["8bit", "chiptune", "square"],
    notes: "Pulse table with a stepper on width and a bitcrusher insert.",
    enums: { "osc1.table": T.pulse, "ins1.type": INS.crush, "filter1.type": F.none, "fx1.type": FX.delay, "mod7.type": 2 },
    params: { "osc1.pos": 0.2, "osc1.amp": 0.6, "ins1.a": 0.45, "ins1.b": 0.45, "env4.sustain": 0.8, "mod7.rate": SYNC("1/16"), "mod7.glide": 0, "fx1.a": 0.2, "fx1.c": 0.3 },
    real: { ...env(4, 0.001, 0.25, 0.08) },
    seq: { mod7: { steps: [0, 0.6, 0.3, 0.9, 0, 0.6, 0.3, 0.9, 0.15, 0.75, 0.45, 1, 0.15, 0.75, 0.45, 0.6] } },
    mods: [["mod7", "osc1.pos", 0.5], ["macro1", "ins1.b", 0.5]],
    macroNames: ["Crunch"],
  },

  /* -------------------------------------------------------------- pad */
  {
    name: "Tundra Pad",
    level: 0.58,
    category: "Pad",
    tags: ["warm", "evolving", "wide"],
    notes: "Three layered tables drifting under a slow free-running LFO, chorus and long reverb.",
    enums: { "osc1.table": T.addFull, "osc2.table": T.warm, "osc3.table": T.sawStack, "voice.unison": 1, "filter1.type": F.lp4, "fx1.type": FX.chorus, "fx2.type": FX.reverb, "mod5.sync": 0, "mod5.restart": 1 },
    params: {
      "osc1.pos": 0.3, "osc1.amp": 0.6, "osc2.pos": 0.6, "osc2.amp": 0.5, "osc3.pos": 0.2, "osc3.amp": 0.35, "filter1.res": 0.15,
      "env4.sustain": 0.8, "fx1.a": 0.35, "fx1.b": 0.5, "fx1.c": 0.2, "fx2.a": 0.4, "fx2.b": 0.85, "fx2.c": 0.45,
    },
    real: { "osc2.fine": -8, "osc3.fine": 8, "filter1.cutoff": 1600, "voice.detune": 12, ...env(4, 0.9, 1.5, 1.8), "mod5.rate": 0.15 },
    mods: [["mod5", "osc1.pos", 0.4], ["mod5", "filter1.cutoff", 0.08], ["macro1", "filter1.cutoff", 0.35]],
    macroNames: ["Open"],
  },
  {
    name: "Aurora Choir",
    level: 0.88,
    category: "Pad",
    tags: ["choir", "vocal", "airy"],
    notes: "Two vowel tables wandering on smooth random LFOs through Dimension and reverb.",
    enums: { "osc1.table": T.vox, "osc2.table": T.vox, "filter1.type": F.lp2, "fx1.type": FX.dimension, "fx2.type": FX.reverb, "mod5.sync": 0, "mod5.shapeA": 6, "mod6.type": 0, "mod6.sync": 0, "mod6.shapeA": 6 },
    params: {
      "osc1.pos": 0.2, "osc1.amp": 0.7, "osc2.pos": 0.7, "osc2.amp": 0.6, "env4.sustain": 0.9, "fx1.a": 0.4, "fx1.b": 0.5, "fx1.c": 0.8,
      "fx2.a": 0.45, "fx2.b": 0.9, "fx2.c": 0.5, "mod6.amp": 1,
    },
    real: { "osc2.fine": 10, "filter1.cutoff": 4200, ...env(4, 0.6, 1, 2), "mod5.rate": 0.3, "mod6.rate": 0.23 },
    mods: [["mod5", "osc1.pos", 0.3], ["mod6", "osc2.pos", 0.3], ["macro1", "fx2.a", 0.4]],
    macroNames: ["Space"],
  },
  {
    name: "Frozen Strings",
    level: 0.82,
    category: "Pad",
    tags: ["strings", "ensemble"],
    notes: "Saw ensemble with a slow filter swell and lush chorus.",
    enums: { "osc1.table": T.squareSaw, "osc2.table": T.squareSaw, "osc3.table": T.pulse, "filter1.type": F.lp2, "fx1.type": FX.chorus, "fx2.type": FX.reverb },
    params: {
      "osc1.pos": 1, "osc1.amp": 0.65, "osc2.pos": 1, "osc2.amp": 0.6, "osc3.pos": 0.5, "osc3.amp": 0.3, "filter1.res": 0.1,
      "env4.sustain": 0.85, "env1.sustain": 0.6, "fx1.a": 0.45, "fx1.b": 0.6, "fx1.c": 0.25, "fx2.a": 0.35, "fx2.b": 0.75,
    },
    real: { "osc2.fine": 12, "osc3.pitch": 12, "filter1.cutoff": 1400, ...env(4, 0.35, 1, 0.9), ...env(1, 0.8, 1.2, 1) },
    mods: [["env1", "filter1.cutoff", 0.2], ["macro1", "filter1.cutoff", 0.3], ["vel", "filter1.cutoff", 0.06]],
    macroNames: ["Bright"],
  },
  {
    name: "Mammoth Breath",
    level: 0.85,
    category: "Pad",
    tags: ["noise", "breath", "ambient"],
    notes: "Pink noise through a slowly morphing formant filter over a sine bed.",
    enums: { "osc1.table": T.sineSaw, "noise.type": 1, "filter1.type": F.formant, "fx2.type": FX.reverb, "mod5.sync": 0, "mod5.shapeA": 6, "mod5.polarity": 0 },
    params: { "osc1.pos": 0, "osc1.amp": 0.35, "noise.amp": 0.75, "noise.color": 0.5, "filter1.cutoff": 0.2, "filter1.b": 0.5, "filter1.res": 0.75, "env4.sustain": 1, "fx2.a": 0.5, "fx2.b": 0.9, "fx2.c": 0.3 },
    real: { ...env(4, 1.2, 1, 2.5), "mod5.rate": 0.12 },
    mods: [["mod5", "filter1.cutoff", 0.6], ["macro1", "filter1.b", 0.4]],
    macroNames: ["Shift"],
  },
  {
    name: "Velvet Horizon",
    level: 0.52,
    category: "Pad",
    tags: ["soft", "warm", "slow"],
    notes: "Warm harmonics table with a gentle phaser and long attack.",
    enums: { "osc1.table": T.warm, "osc2.table": T.addFull, "filter1.type": F.lp4, "fx1.type": FX.phaser, "fx2.type": FX.reverb, "voice.unison": 1 },
    params: { "osc1.pos": 0.7, "osc1.amp": 0.7, "osc2.pos": 0.45, "osc2.amp": 0.45, "filter1.res": 0.1, "env4.sustain": 0.9, "fx1.a": 0.35, "fx1.b": 0.1, "fx1.c": 0.5, "fx2.a": 0.35, "fx2.b": 0.8 },
    real: { "osc2.pitch": 12, "filter1.cutoff": 2200, "voice.detune": 9, ...env(4, 1.4, 1, 2.2) },
    mods: [["macro1", "filter1.cutoff", 0.3], ["trr", "osc1.pos", 0.15]],
    macroNames: ["Open"],
  },

  /* ------------------------------------------------------------ pluck */
  {
    name: "Permafrost Pluck",
    level: 0.95,
    category: "Pluck",
    tags: ["pluck", "house", "delay"],
    notes: "Classic filter-envelope pluck with a dotted-eighth delay.",
    enums: { "osc1.table": T.squareSaw, "osc2.table": T.pulse, "filter1.type": F.lp4, "fx1.type": FX.delay, "fx1.ldiv": DIV("1/8D"), "fx1.rdiv": DIV("1/4"), "fx2.type": FX.reverb },
    params: { "osc1.pos": 0.6, "osc1.amp": 0.75, "osc2.pos": 0.4, "osc2.amp": 0.35, "filter1.res": 0.35, "env4.sustain": 0, "env1.sustain": 0, "env4.vel": 0.4, "fx1.a": 0.25, "fx1.b": 0.5, "fx1.c": 0.4, "fx2.a": 0.2 },
    real: { "osc2.pitch": 12, "filter1.cutoff": 300, ...env(4, 0.001, 0.5, 0.3), ...env(1, 0.001, 0.22, 0.2) },
    mods: [["env1", "filter1.cutoff", 0.55], ["vel", "filter1.cutoff", 0.1], ["macro1", "env1.decay", 0.3]],
    macroNames: ["Length"],
  },
  {
    name: "Crystal Harp",
    category: "Pluck",
    tags: ["harp", "bright", "glassy"],
    notes: "Odd-harmonic table plus a metallic overtone, decaying through a soft lowpass.",
    enums: { "osc1.table": T.addOdd, "osc2.table": T.metal, "filter1.type": F.lp2, "fx2.type": FX.reverb },
    params: { "osc1.pos": 0.4, "osc1.amp": 0.75, "osc2.pos": 0.2, "osc2.amp": 0.25, "env4.sustain": 0, "env1.sustain": 0, "fx2.a": 0.35, "fx2.b": 0.75, "fx2.c": 0.4 },
    real: { "osc2.pitch": 12, "filter1.cutoff": 2000, ...env(4, 0.001, 1.2, 0.8), ...env(1, 0.001, 0.4, 0.4) },
    mods: [["env1", "filter1.cutoff", 0.3], ["macro1", "osc2.amp", 0.5]],
    macroNames: ["Shimmer"],
  },
  {
    name: "Comb String",
    category: "Pluck",
    tags: ["physical", "string", "comb"],
    notes: "A noise burst excites a key-tracked comb filter, like a plucked string.",
    enums: { "noise.type": 0, "filter1.type": F.comb, "fx2.type": FX.reverb },
    params: { "osc1.amp": 0, "noise.amp": 0, "noise.color": 0.6, "filter1.res": 0.96, "filter1.b": 0.35, "filter1.ktr": 1, "env4.sustain": 0, "env2.sustain": 0, "fx2.a": 0.2 },
    real: { "filter1.cutoff": 261.63, ...env(4, 0.001, 1.6, 0.6), ...env(2, 0.001, 0.025, 0.02) },
    mods: [["env2", "noise.amp", 0.95], ["macro1", "filter1.b", 0.5], ["vel", "filter1.res", 0.03]],
    macroNames: ["Damping"],
  },
  {
    name: "Ice Mallet",
    category: "Pluck",
    tags: ["mallet", "fm", "percussive"],
    notes: "FM mallet: a fast-decaying phase-mod index over a sine.",
    enums: { "osc1.table": T.sineSaw, "modosc.phase": 1, "filter1.type": F.none, "fx2.type": FX.reverb },
    params: { "osc1.pos": 0, "osc1.amp": 0.85, "modosc.rm": 0, "env4.sustain": 0, "env2.sustain": 0, "fx2.a": 0.3, "fx2.b": 0.7 },
    real: { "modosc.pitch": 19, ...env(4, 0.001, 0.8, 0.5), ...env(2, 0.001, 0.15, 0.1) },
    mods: [["env2", "modosc.rm", 0.5], ["vel", "modosc.rm", 0.2], ["macro1", "modosc.rm", 0.3]],
    macroNames: ["Hardness"],
  },

  /* ------------------------------------------------------------- keys */
  {
    name: "Electric Tusk",
    level: 0.78,
    category: "Keys",
    tags: ["ep", "electric piano", "fm"],
    notes: "Electric-piano style: velocity-driven phase modulation and a slow phaser.",
    enums: { "osc1.table": T.sineSaw, "osc2.table": T.warm, "modosc.phase": 1, "filter1.type": F.lp2, "fx1.type": FX.phaser, "fx2.type": FX.reverb },
    params: {
      "osc1.pos": 0.03, "osc1.amp": 0.85, "osc2.pos": 0.3, "osc2.amp": 0.3, "modosc.rm": 0.1, "env4.sustain": 0, "env2.sustain": 0.1,
      "env4.vel": 0.6, "fx1.a": 0.3, "fx1.b": 0.1, "fx1.c": 0.3, "fx2.a": 0.15,
    },
    real: { "filter1.cutoff": 5000, ...env(4, 0.002, 2.5, 0.4), ...env(2, 0.001, 0.4, 0.3) },
    mods: [["env2", "modosc.rm", 0.3], ["vel", "modosc.rm", 0.25], ["macro1", "fx1.a", 0.5]],
    macroNames: ["Phase"],
  },
  {
    name: "Polar Organ",
    level: 0.78,
    category: "Keys",
    tags: ["organ", "drawbar"],
    notes: "Drawbar-style table with vibrato chorus and a touch of clip.",
    enums: { "osc1.table": T.organ, "osc2.table": T.organ, "filter1.type": F.none, "ins1.type": INS.clip, "fx1.type": FX.chorus, "fx2.type": FX.reverb, "mod5.sync": 0 },
    params: { "osc1.pos": 0.45, "osc1.amp": 0.7, "osc2.pos": 0.95, "osc2.amp": 0.3, "ins1.a": 0.25, "ins1.b": 0.2, "env4.sustain": 1, "fx1.a": 0.4, "fx1.b": 0.3, "fx1.c": 0.85, "fx2.a": 0.2 },
    real: { "osc2.pitch": 12, ...env(4, 0.005, 0.3, 0.08), "mod5.rate": 6.2 },
    mods: [["mod5", "osc1.pitch", 0.002], ["macro1", "osc1.pos", 0.5], ["macro2", "ins1.b", 0.6]],
    macroNames: ["Drawbars", "Drive"],
  },
  {
    name: "Bell Chimes",
    level: 0.82,
    category: "Keys",
    tags: ["bell", "metallic", "long"],
    notes: "Prime-harmonic table with a high sine partial and long ring.",
    enums: { "osc1.table": T.metal, "osc2.table": T.sineSaw, "filter1.type": F.lp2, "fx2.type": FX.reverb },
    params: { "osc1.pos": 0.5, "osc1.amp": 0.7, "osc2.pos": 0, "osc2.amp": 0.3, "env4.sustain": 0, "fx2.a": 0.4, "fx2.b": 0.85 },
    real: { "osc2.pitch": 24, "filter1.cutoff": 6500, ...env(4, 0.001, 2.5, 1.5) },
    mods: [["macro1", "osc1.pos", 0.4], ["vel", "osc2.amp", 0.3]],
    macroNames: ["Color"],
  },

  /* ------------------------------------------------ arp and sequence */
  {
    name: "Step Hunter",
    category: "Sequence",
    tags: ["stepper", "sequence", "filter"],
    notes: "A 16-step stepper plays the filter at 1/16 — hold a chord.",
    enums: { "osc1.table": T.squareSaw, "filter1.type": F.lp4, "fx1.type": FX.delay, "fx1.ldiv": DIV("1/8D"), "fx1.rdiv": DIV("1/8"), "mod7.type": 2 },
    params: { "osc1.pos": 0.8, "osc1.amp": 0.75, "filter1.res": 0.5, "env4.sustain": 1, "mod7.rate": SYNC("1/16"), "mod7.glide": 0.15, "fx1.a": 0.22, "fx1.c": 0.4 },
    real: { "filter1.cutoff": 380, ...env(4, 0.003, 0.4, 0.15) },
    seq: { mod7: { steps: [1, 0.2, 0.7, 0.3, 0.9, 0.1, 0.5, 0.8, 1, 0.3, 0.6, 0.2, 0.85, 0.4, 0.65, 0.15] } },
    mods: [["mod7", "filter1.cutoff", 0.45], ["macro1", "filter1.res", 0.4]],
    macroNames: ["Reso"],
  },
  {
    name: "Gated Glacier",
    level: 0.8,
    category: "Sequence",
    tags: ["gate", "trance", "performer"],
    notes: "A pad chopped by the performer's 1/16 shapes.",
    enums: { "osc1.table": T.sawStack, "osc2.table": T.addFull, "voice.unison": 1, "filter1.type": F.lp4, "fx1.type": FX.delay, "fx2.type": FX.reverb, "mod6.type": 1 },
    params: {
      "osc1.pos": 0.4, "osc1.amp": 0.7, "osc2.pos": 0.6, "osc2.amp": 0.5, "filter1.res": 0.2, "amp.mod": 0.1, "env4.sustain": 1,
      "mod6.rate": SYNC("1/16"), "fx1.a": 0.2, "fx1.c": 0.3, "fx2.a": 0.25,
    },
    real: { "filter1.cutoff": 2500, "voice.detune": 14, ...env(4, 0.01, 0.4, 0.3) },
    seq: { mod6: { steps: [1, 0.7, 1, 0.5, 1, 0.7, 0.9, 0, 1, 0.7, 1, 0.5, 1, 0.8, 0.6, 0.4], shapes: [6, 6, 6, 6, 6, 6, 6, 8, 6, 6, 6, 6, 6, 2, 2, 2] } },
    mods: [["mod6", "amp.mod", 0.85], ["macro1", "filter1.cutoff", 0.3]],
    macroNames: ["Bright"],
  },
  {
    name: "Pulse Runner",
    level: 0.8,
    category: "Arp",
    tags: ["arp", "pulse", "bouncy"],
    notes: "Short pulse notes with a synced stepper on pitch for octave jumps.",
    enums: { "osc1.table": T.pulse, "filter1.type": F.lp2, "fx1.type": FX.delay, "fx1.ldiv": DIV("1/16"), "fx1.rdiv": DIV("1/8"), "mod8.type": 2 },
    params: { "osc1.pos": 0.35, "osc1.amp": 0.75, "filter1.res": 0.3, "env4.sustain": 0.6, "mod8.rate": SYNC("1/16"), "mod8.glide": 0, "fx1.a": 0.25, "fx1.c": 0.35 },
    real: { "filter1.cutoff": 3000, ...env(4, 0.001, 0.2, 0.12) },
    seq: { mod8: { steps: [0, 0, 0.5, 0, 0, 0.5, 0, 1, 0, 0, 0.5, 0, 0.5, 0, 1, 0.5] } },
    mods: [["mod8", "osc1.pitch", 0.5], ["macro1", "osc1.pos", 0.5]],
    macroNames: ["Width"],
  },

  /* --------------------------------------------------------------- fx */
  {
    name: "Riser Storm",
    level: 0.85,
    category: "FX",
    tags: ["riser", "sweep", "build"],
    notes: "Hold for four seconds: noise and a sync sweep rise together through a flanger.",
    enums: { "osc1.table": T.sync, "noise.type": 0, "filter1.type": F.bp, "fx1.type": FX.flanger, "fx2.type": FX.reverb },
    params: { "osc1.pos": 0.2, "osc1.amp": 0.5, "noise.amp": 0.6, "filter1.res": 0.45, "env4.sustain": 1, "env1.sustain": 1, "fx1.a": 0.4, "fx1.b": 0.4, "fx1.c": 0.6, "fx2.a": 0.4, "fx2.b": 0.85 },
    real: { "filter1.cutoff": 200, ...env(4, 0.5, 1, 1.5), ...env(1, 4, 1, 1) },
    mods: [["env1", "filter1.cutoff", 0.7], ["env1", "osc1.pitch", 0.25], ["env1", "osc1.pos", 0.7]],
  },
  {
    name: "Laser Zap",
    level: 0.85,
    category: "FX",
    tags: ["zap", "laser", "sweep"],
    notes: "Fast downward pitch sweep with an echo.",
    enums: { "osc1.table": T.sineSaw, "filter1.type": F.none, "fx1.type": FX.delay, "fx1.ldiv": DIV("1/16"), "fx1.rdiv": DIV("1/8T") },
    params: { "osc1.pos": 0.2, "osc1.amp": 0.8, "env4.sustain": 0, "env1.sustain": 0, "fx1.a": 0.25, "fx1.c": 0.45 },
    real: { ...env(4, 0.001, 0.3, 0.1), ...env(1, 0.001, 0.15, 0.1) },
    mods: [["env1", "osc1.pitch", 0.5]],
  },
  {
    name: "Metal Shimmer",
    level: 1.0,
    category: "Texture",
    tags: ["metallic", "shimmer", "ambient"],
    notes: "Metallic table scanned by a slow LFO, slightly frequency-shifted, through a phaser filter.",
    enums: { "osc1.table": T.metal, "osc2.table": T.scrap, "ins1.type": INS.fshift, "filter1.type": F.phaser, "fx2.type": FX.reverb, "mod5.sync": 0, "mod5.polarity": 0 },
    params: {
      "osc1.pos": 0.1, "osc1.amp": 0.9, "osc2.pos": 0.5, "osc2.amp": 0.4, "ins1.a": 0.35, "ins1.b": 0.53, "filter1.cutoff": 0.55,
      "filter1.b": 0.6, "filter1.res": 0.6, "env4.sustain": 0.9, "fx2.a": 0.5, "fx2.b": 0.9,
    },
    real: { ...env(4, 0.8, 1, 2.5), "mod5.rate": 0.08 },
    mods: [["mod5", "osc1.pos", 0.8], ["mod5", "filter1.cutoff", 0.2], ["macro1", "ins1.b", 0.2]],
    macroNames: ["Shift"],
  },
  {
    name: "Scrap Yard",
    level: 1.0,
    category: "Texture",
    tags: ["noise", "random", "glitch"],
    notes: "Random-spectrum table jumping on a sample-and-hold LFO, crushed and delayed.",
    enums: { "osc1.table": T.scrap, "osc1.mode": 3, "filter1.type": F.dnotch, "ins1.type": INS.sh, "fx1.type": FX.crush, "fx2.type": FX.delay, "mod5.shapeA": 5, "mod5.polarity": 0 },
    params: {
      "osc1.pos": 0.5, "osc1.int": 0.8, "osc1.amp": 0.95, "filter1.cutoff": 0.6, "filter1.b": 0.5, "filter1.res": 0.3, "ins1.a": 0.3, "ins1.b": 0.6,
      "env4.sustain": 0.8, "mod5.rate": SYNC("1/16"), "fx1.a": 0.3, "fx1.b": 0.4, "fx2.a": 0.25, "fx2.c": 0.45,
    },
    real: { ...env(4, 0.01, 0.4, 0.4) },
    mods: [["mod5", "osc1.pos", 0.5], ["mod5", "filter1.cutoff", 0.15]],
  },

  /* ------------------------------------------------------------- drum */
  {
    name: "Sub Kick",
    level: 0.85,
    category: "Drum",
    tags: ["kick", "808", "drum"],
    notes: "Play around C3: a sine with a fast pitch drop and a touch of clip.",
    enums: { "osc1.table": T.sineSaw, "filter1.type": F.none, "ins1.type": INS.clip, "osc1.restart": 1 },
    params: { "osc1.pos": 0, "osc1.amp": 0.9, "osc1.phase": 0.25, "ins1.a": 0.35, "ins1.b": 0.3, "env4.sustain": 0, "env1.sustain": 0 },
    real: { "osc1.pitch": -12, ...env(4, 0.0005, 0.45, 0.05), ...env(1, 0.0005, 0.06, 0.05) },
    mods: [["env1", "osc1.pitch", 0.45], ["macro1", "env4.decay", 0.3]],
    macroNames: ["Length"],
  },
  {
    name: "Noise Snare",
    level: 1.0,
    category: "Drum",
    tags: ["snare", "drum", "noise"],
    notes: "Bandpassed noise burst over a pitched triangle body.",
    enums: { "osc1.table": T.sineSaw, "noise.type": 0, "filter1.type": F.bp, "filter2.type": F.hp2, "osc1.restart": 1 },
    params: {
      "osc1.pos": 0.5, "osc1.amp": 0.7, "osc1.route": 1, "noise.amp": 1, "filter1.res": 0.12, "filter2.res": 0, "filters.serpar": 1, "filters.mix": 0.5,
      "env4.sustain": 0, "env1.sustain": 0,
    },
    real: { "osc1.pitch": 7, "filter1.cutoff": 1800, "filter2.cutoff": 120, ...env(4, 0.0005, 0.2, 0.08), ...env(1, 0.0005, 0.05, 0.05) },
    mods: [["env1", "osc1.pitch", 0.15], ["macro1", "filter1.cutoff", 0.3]],
    macroNames: ["Tone"],
  },
];

/** Complete, sanitized factory patches (Init first). */
export const FACTORY_PRESETS = [sanitizePatch(Object.assign(makeInitPatch(), { name: "Init", category: "Init", author: "Factory" }))].concat(
  DIFFS.map(presetFromDiff)
);
