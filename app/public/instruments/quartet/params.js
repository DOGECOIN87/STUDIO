/**
 * Quartet — a four-oscillator synth (STUDIO's own code).
 *
 * A patch is plain JSON so undo, project files and renders can copy it:
 *   oscs[4]   { on, wave, octave, semi, fine, level, pan, unison, spread }
 *   filter    { type, cutoff, reso, env, keytrack }
 *   ampEnv / filterEnv  { a, d, s, r }  (seconds, sustain 0..1)
 *   lfo       { target, shape, rate, depth }
 *   volume (dB), velocity (0..1: how much the key velocity changes the level)
 */

export const WAVES = [
  { id: "sine", label: "Sine" },
  { id: "triangle", label: "Triangle" },
  { id: "sawtooth", label: "Saw" },
  { id: "square", label: "Square" },
  { id: "noise", label: "Noise" },
];
export const FILTER_TYPES = [
  { id: "lowpass", label: "Low-pass" },
  { id: "highpass", label: "High-pass" },
  { id: "bandpass", label: "Band-pass" },
];
export const LFO_TARGETS = [
  { id: "off", label: "Off" },
  { id: "pitch", label: "Pitch (vibrato)" },
  { id: "filter", label: "Filter cutoff" },
  { id: "amp", label: "Level (tremolo)" },
  { id: "pan", label: "Pan" },
];
export const LFO_SHAPES = [
  { id: "sine", label: "Sine" },
  { id: "triangle", label: "Triangle" },
  { id: "square", label: "Square" },
  { id: "sawtooth", label: "Saw" },
];

export const RANGES = {
  octave: [-3, 3],
  semi: [-12, 12],
  fine: [-100, 100],
  level: [0, 1],
  pan: [-1, 1],
  unison: [1, 4],
  spread: [0, 50],
  cutoff: [30, 18000],
  reso: [0.1, 18],
  env: [-1, 1],
  keytrack: [0, 1],
  a: [0.001, 5],
  d: [0.005, 5],
  s: [0, 1],
  r: [0.005, 8],
  rate: [0.05, 20],
  depth: [0, 1],
  volume: [-36, 6],
  velocity: [0, 1],
};

const OSC_OFF = { on: false, wave: "sawtooth", octave: 0, semi: 0, fine: 0, level: 0.7, pan: 0, unison: 1, spread: 12 };

export function defaultPatch() {
  return {
    name: "Init",
    oscs: [
      Object.assign({}, OSC_OFF, { on: true }),
      Object.assign({}, OSC_OFF, { wave: "square", octave: -1 }),
      Object.assign({}, OSC_OFF, { wave: "triangle" }),
      Object.assign({}, OSC_OFF, { wave: "noise", level: 0.3 }),
    ],
    filter: { type: "lowpass", cutoff: 3200, reso: 0.9, env: 0.3, keytrack: 0.4 },
    ampEnv: { a: 0.004, d: 0.3, s: 0.75, r: 0.25 },
    filterEnv: { a: 0.004, d: 0.35, s: 0.3, r: 0.3 },
    lfo: { target: "off", shape: "sine", rate: 5, depth: 0.25 },
    volume: -6,
    velocity: 0.6,
  };
}

const num = (v, [lo, hi], d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.max(lo, Math.min(hi, Number(v))) : d);
const pick = (v, list, d) => (list.some((x) => x.id === v) ? v : d);

function cleanEnv(raw, d) {
  const e = raw && typeof raw === "object" ? raw : {};
  return { a: num(e.a, RANGES.a, d.a), d: num(e.d, RANGES.d, d.d), s: num(e.s, RANGES.s, d.s), r: num(e.r, RANGES.r, d.r) };
}

/** A complete, valid patch from anything (missing or bad values take the defaults). Never throws. */
export function sanitizePatch(raw) {
  const def = defaultPatch();
  const p = raw && typeof raw === "object" ? raw : {};
  const oscs = def.oscs.map((d, i) => {
    const o = Array.isArray(p.oscs) && p.oscs[i] && typeof p.oscs[i] === "object" ? p.oscs[i] : d;
    return {
      on: o.on == null ? d.on : !!o.on,
      wave: pick(o.wave, WAVES, d.wave),
      octave: Math.round(num(o.octave, RANGES.octave, d.octave)),
      semi: Math.round(num(o.semi, RANGES.semi, d.semi)),
      fine: num(o.fine, RANGES.fine, d.fine),
      level: num(o.level, RANGES.level, d.level),
      pan: num(o.pan, RANGES.pan, d.pan),
      unison: Math.round(num(o.unison, RANGES.unison, d.unison)),
      spread: num(o.spread, RANGES.spread, d.spread),
    };
  });
  const f = p.filter && typeof p.filter === "object" ? p.filter : {};
  const l = p.lfo && typeof p.lfo === "object" ? p.lfo : {};
  return {
    name: String(p.name || def.name).slice(0, 60),
    oscs,
    filter: {
      type: pick(f.type, FILTER_TYPES, def.filter.type),
      cutoff: num(f.cutoff, RANGES.cutoff, def.filter.cutoff),
      reso: num(f.reso, RANGES.reso, def.filter.reso),
      env: num(f.env, RANGES.env, def.filter.env),
      keytrack: num(f.keytrack, RANGES.keytrack, def.filter.keytrack),
    },
    ampEnv: cleanEnv(p.ampEnv, def.ampEnv),
    filterEnv: cleanEnv(p.filterEnv, def.filterEnv),
    lfo: {
      target: pick(l.target, LFO_TARGETS, def.lfo.target),
      shape: pick(l.shape, LFO_SHAPES, def.lfo.shape),
      rate: num(l.rate, RANGES.rate, def.lfo.rate),
      depth: num(l.depth, RANGES.depth, def.lfo.depth),
    },
    volume: num(p.volume, RANGES.volume, def.volume),
    velocity: num(p.velocity, RANGES.velocity, def.velocity),
  };
}

export function clonePatch(p) {
  return JSON.parse(JSON.stringify(sanitizePatch(p)));
}
