#!/usr/bin/env node
/**
 * Audius Studio — Mammoth synth test suite (no browser, no dependencies).
 *
 *   node tools/test-mammoth.mjs
 *
 * Imports the real AudioWorklet module (app/public/instruments/mammoth/
 * mammoth-processor.js) into Node and renders audio offline, so the DSP the
 * browser runs is exactly what is tested: wavetable band-limiting, pitch
 * accuracy, envelopes, voice allocation, every filter / insert / FX type,
 * modulation routing, sample-accurate note timing, the patch sanitizer and
 * every factory preset.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Same specifiers (with ?v=1) as the browser modules use, so Node shares one instance of each.
import * as P from "../app/public/instruments/mammoth/params.js?v=1";
import * as W from "../app/public/instruments/mammoth/wavetables.js?v=1";
import { FACTORY_PRESETS, presetFromDiff } from "../app/public/instruments/mammoth/presets.js?v=1";
import { MammothEngine } from "../app/public/instruments/mammoth/mammoth-processor.js?v=1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SR = 48000;

let pass = 0;
let fail = 0;
const ok = (m) => {
  pass++;
  console.log(`✓ ${m}`);
};
const bad = (m) => {
  fail++;
  console.log(`✗ ${m}`);
};
const check = (cond, m, extra = "") => (cond ? ok(m) : bad(`${m}${extra ? ` — ${extra}` : ""}`));

/* ---------------------------------------------------------------- loader */

const src = fs.readFileSync(path.join(root, "app/public/instruments/mammoth/mammoth-processor.js"), "utf8");
check(!/^\s*import\s/m.test(src), "processor is self-contained (no imports, loads as a worklet module)");
check(/registerProcessor\("mammoth-synth"/.test(src), "processor registers 'mammoth-synth'");
const Engine = MammothEngine;
check(typeof Engine === "function", "MammothEngine imports as a module (and the worklet guard keeps Node from registering)");

const TABLES = W.TABLE_NAMES.map((_, i) => W.buildWavetable(i));
const PARAM_TABLE = P.engineParamTable();

function makeEngine(mutate, opts = {}) {
  const patch = P.makeInitPatch();
  if (mutate) mutate(patch);
  const safe = P.sanitizePatch(patch);
  return new Engine(opts.sr || SR, { params: PARAM_TABLE, patch: safe, tables: TABLES, bpm: opts.bpm || 120 });
}

/** Renders `seconds` of audio; events are [{t, on, note, vel}] in seconds. */
function render(engine, seconds, events = [], sr = SR) {
  engine.schedule(events.map((e) => ({ frame: Math.round(e.t * sr), on: e.on, note: e.note, vel: e.vel ?? 0.9 })));
  const total = Math.round(seconds * sr);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const bl = new Float32Array(128);
  const br = new Float32Array(128);
  for (let pos = 0; pos < total; pos += 128) {
    const n = Math.min(128, total - pos);
    engine.render(bl, br, 128, engine.frame);
    L.set(bl.subarray(0, n), pos);
    R.set(br.subarray(0, n), pos);
  }
  return { L, R };
}

const note = (t, n, len, vel = 0.9) => [
  { t, on: true, note: n, vel },
  { t: t + len, on: false, note: n },
];

function stats(buf, from = 0, to = buf.length) {
  let peak = 0;
  let sum = 0;
  let finite = true;
  for (let i = from; i < to; i++) {
    const x = buf[i];
    if (!Number.isFinite(x)) finite = false;
    const a = Math.abs(x);
    if (a > peak) peak = a;
    sum += x * x;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, to - from)), finite };
}

/** Frequency by counting rising zero crossings with sub-sample interpolation. */
function zeroCrossFreq(buf, from, to, sr = SR) {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = from + 1; i < to; i++) {
    if (buf[i - 1] <= 0 && buf[i] > 0) {
      const t = i - 1 + -buf[i - 1] / (buf[i] - buf[i - 1]);
      if (first < 0) first = t;
      else count++;
      last = t;
    }
  }
  return count > 0 ? (count * sr) / (last - first) : 0;
}

/** Magnitude of one frequency (Goertzel). */
function goertzel(buf, f, from, to, sr = SR) {
  const w = (2 * Math.PI * f) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s0 = buf[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
}

/** Energy above `hz` relative to total, via a crude first-difference proxy. */
function brightness(buf, from, to) {
  let d = 0;
  let e = 0;
  for (let i = from + 1; i < to; i++) {
    const x = buf[i] - buf[i - 1];
    d += x * x;
    e += buf[i] * buf[i];
  }
  return e > 0 ? d / e : 0;
}

const sinePatch = (p) => {
  p.enums["osc1.table"] = 0; // Sine-Saw at position 0 is a pure sine
  p.params["osc1.pos"] = 0;
  p.params["filter1.cutoff"] = 1;
  p.enums["filter1.type"] = 0;
  p.params["env4.vel"] = 0;
};

/* ------------------------------------------------------ 1. wavetables */
{
  check(W.TABLE_NAMES.length === 16, "16 factory wavetables");
  check(new Set(W.TABLE_NAMES).size === W.TABLE_NAMES.length, "wavetable names are unique");
  let shapeOk = true;
  let finiteOk = true;
  let guardOk = true;
  let peakOk = true;
  const stride = W.TABLE_SIZE + 1;
  for (const t of TABLES) {
    if (t.frames !== 16 || t.size !== 2048 || t.levels !== 11 || t.data.length !== 11 * 16 * stride) shapeOk = false;
    for (let lvl = 0; lvl < t.levels; lvl++) {
      for (let f = 0; f < t.frames; f++) {
        const base = (lvl * t.frames + f) * stride;
        if (t.data[base + t.size] !== t.data[base]) guardOk = false;
        for (let s = 0; s < t.size; s++) {
          const x = t.data[base + s];
          if (!Number.isFinite(x)) finiteOk = false;
          if (lvl === 0 && Math.abs(x) > 1.0001) peakOk = false;
        }
      }
    }
  }
  check(shapeOk, "every table is 16 frames × 11 mip levels × 2049 samples");
  check(finiteOk, "every wavetable sample is finite");
  check(guardOk, "every frame has its interpolation guard sample");
  check(peakOk, "level 0 is peak-normalised to ±1");

  // The top mip level keeps only the fundamental: correlate with a sine.
  let pureOk = true;
  for (const t of TABLES) {
    const base = (10 * t.frames + 8) * stride;
    let dotS = 0;
    let dotC = 0;
    let energy = 0;
    for (let s = 0; s < t.size; s++) {
      const x = t.data[base + s];
      dotS += x * Math.sin((2 * Math.PI * s) / t.size);
      dotC += x * Math.cos((2 * Math.PI * s) / t.size);
      energy += x * x;
    }
    const fund = (dotS * dotS + dotC * dotC) / (t.size / 2);
    if (energy > 1e-6 && fund / energy < 0.999) pureOk = false;
  }
  check(pureOk, "top mip level of every table is a pure fundamental (band-limited)");
  check(W.buildWavetable(3) === W.buildWavetable(3), "wavetables are cached");
  const prev = W.framePreview(TABLES[0], 0.5, 64);
  check(prev.length === 64 && prev.every(Number.isFinite), "framePreview returns finite points for the editor");
}

/* ----------------------------------------------------- 2. spec + patch */
{
  check(P.MAMMOTH_PARAMS.length === PARAM_TABLE.length, "engine param table matches the spec");
  check(P.MAMMOTH_PARAMS.every((p) => p.def >= 0 && p.def <= 1), "every parameter default is a normalised knob position");
  check(P.MAMMOTH_ENUMS.every((e) => e.def >= 0 && e.def < e.options.length), "every enum default is in range");
  let roundOk = true;
  for (const p of P.MAMMOTH_PARAMS) {
    for (const n of [0, 0.25, 0.5, 0.9, 1]) {
      const back = P.normFor(p, P.mapValue(p, n));
      if (Math.abs(back - n) > 1e-6) roundOk = false;
    }
  }
  check(roundOk, "normFor inverts mapValue for every curve");
  check(Math.abs(P.cutoffHz(0) - 20) < 1e-9 && Math.abs(P.cutoffHz(1) - 20000) < 1e-6, "cutoff knob spans 20 Hz – 20 kHz");
  check(P.formatParam("filter1.cutoff", 0.5, { filterType: 13 }) === "I", "formant filter shows vowels");
  check(P.formatParam("mod5.rate", 9 / 15, { synced: true }) === "1/8", "synced rates display as note values");
  check(P.formatParam("master.vol", Math.sqrt(1 / 2.04)) === "+0.0 dB", "master shows 0 dB at unity");

  const init = P.makeInitPatch();
  const again = P.sanitizePatch(init);
  check(JSON.stringify(again) === JSON.stringify(init), "sanitizePatch(init) round-trips unchanged");
  const junk = P.sanitizePatch({
    name: "x".repeat(200),
    category: "Nope",
    params: { "osc1.pitch": 9, "filter1.cutoff": "NaN", "bogus.param": 1 },
    enums: { "filter1.type": 999, "voice.poly": -4, "fake.enum": 2 },
    mods: [
      { src: "env1", dst: "filter1.cutoff", amt: 5 },
      { src: "env1", dst: "filter1.cutoff", amt: 0.2 },
      { src: "nope", dst: "filter1.cutoff", amt: 0.2 },
      { src: "mod5", dst: "master.vol", amt: 0.2 },
      { src: "mod5", dst: "filter1.cutoff", amt: 0.4 },
      { src: "mod6", dst: "filter1.cutoff", amt: 0.4 },
      { src: "mod7", dst: "filter1.cutoff", amt: 0.4 },
      null,
      "str",
    ],
    seq: { mod7: { steps: [2, -1, "a"], shapes: [99, -3] } },
    macroNames: ["  Cut  ", 7, ""],
  });
  check(junk.name.length === 48 && junk.category === "User", "sanitizer bounds name and category");
  check(junk.params["osc1.pitch"] === 1 && junk.params["filter1.cutoff"] === init.params["filter1.cutoff"], "sanitizer clamps params and replaces NaN");
  check(!("bogus.param" in junk.params) && !("fake.enum" in junk.enums), "sanitizer drops unknown keys");
  check(junk.enums["filter1.type"] === 13 && junk.enums["voice.poly"] === 0, "sanitizer clamps enums");
  check(junk.mods.length === 3, "sanitizer de-duplicates, rejects bad sources / unmodulatable targets, caps 3 per param", JSON.stringify(junk.mods));
  check(junk.mods[0].amt === 1, "sanitizer clamps mod depth to ±1");
  check(junk.seq.mod7.steps[0] === 1 && junk.seq.mod7.steps[1] === 0 && junk.seq.mod7.shapes[0] === 8 && junk.seq.mod7.shapes[1] === 0, "sanitizer clamps step sequences");
  check(junk.macroNames[0] === "Cut" && junk.macroNames[1] === "Macro 2", "sanitizer trims macro names");
  check(JSON.stringify(P.sanitizePatch(null)) === JSON.stringify(init) && P.sanitizePatch("x").name === "Init", "sanitizer never throws on garbage");
  const clone = P.clonePatch(init);
  clone.params["osc1.amp"] = 0.1;
  check(init.params["osc1.amp"] !== 0.1, "clonePatch is a deep copy");
}

/* ------------------------------------------------------ 3. basic render */
{
  const eng = makeEngine();
  const { L, R } = render(eng, 1.2, note(0, 60, 0.6));
  const s = stats(L);
  check(s.finite && stats(R).finite, "init patch renders finite audio");
  check(s.peak > 0.05 && s.peak <= 1, "init patch is audible and below 0 dBFS", `peak ${s.peak.toFixed(3)}`);
  const tail = stats(L, Math.round(1.1 * SR));
  check(tail.peak < 1e-4, "voice is silent after its release", `tail ${tail.peak}`);
  check(eng.activeCount() === 0, "voice is freed after its release");
  check(eng.faults === 0, "no DSP faults on the init patch");
  const silent = stats(render(makeEngine(), 0.2).L);
  check(silent.peak === 0, "no notes → digital silence");
  // Idle fast path: after 6 s without voices the engine stops running the FX, then wakes for the next note.
  const idle = makeEngine((p) => {
    p.enums["fx1.type"] = 6;
    p.params["fx1.a"] = 0.5;
  });
  render(idle, 7, note(0, 60, 0.2));
  check(idle.idleFrames > SR * 6, "engine goes idle after its tails die away");
  const wake = render(idle, 0.3, note(7.05, 64, 0.2));
  check(stats(wake.L).peak > 0.05 && idle.idleFrames === 0, "idle engine wakes for the next note");
}

/* ------------------------------------------------------- 4. pitch */
{
  const freqAt = (noteNum, mutate) => {
    const eng = makeEngine((p) => {
      sinePatch(p);
      if (mutate) mutate(p);
    });
    const { L } = render(eng, 0.6, note(0, noteNum, 0.55));
    return zeroCrossFreq(L, Math.round(0.1 * SR), Math.round(0.5 * SR));
  };
  const a4 = freqAt(69);
  check(Math.abs(a4 / 440 - 1) < 0.002, "A4 plays 440 Hz", `${a4.toFixed(2)} Hz`);
  const a5 = freqAt(81);
  check(Math.abs(a5 / 880 - 1) < 0.002, "A5 plays 880 Hz", `${a5.toFixed(2)} Hz`);
  const c3 = freqAt(48);
  check(Math.abs(c3 / 130.8128 - 1) < 0.003, "C3 plays 130.81 Hz", `${c3.toFixed(2)} Hz`);
  const up = freqAt(69, (p) => {
    p.params["osc1.pitch"] = P.normFor("osc1.pitch", 12);
  });
  check(Math.abs(up / 880 - 1) < 0.002, "osc pitch +12 st doubles the frequency", `${up.toFixed(2)} Hz`);
  const fine = freqAt(69, (p) => {
    p.params["osc1.fine"] = P.normFor("osc1.fine", 50);
  });
  check(Math.abs(fine / (440 * Math.pow(2, 0.5 / 12)) - 1) < 0.002, "fine tune +50 ct", `${fine.toFixed(2)} Hz`);
  const tune = freqAt(69, (p) => {
    p.params["global.tune"] = P.normFor("global.tune", -12);
  });
  check(Math.abs(tune / 220 - 1) < 0.002, "global tune −12 st", `${tune.toFixed(2)} Hz`);
  const fixed = freqAt(81, (p) => {
    p.params["osc1.ktr"] = 0;
  });
  check(Math.abs(fixed / 261.6256 - 1) < 0.003, "osc key track 0% holds the C4 pitch", `${fixed.toFixed(2)} Hz`);

  // Band-limiting: a saw at a high note must not alias (energy stays at harmonics).
  const eng = makeEngine((p) => {
    p.enums["osc1.table"] = 0;
    p.params["osc1.pos"] = 1; // full saw
    p.enums["filter1.type"] = 0;
  });
  const { L } = render(eng, 0.3, note(0, 108, 0.29));
  // Goertzel at inharmonic frequencies vs the fundamental.
  const g = goertzel;
  const f0 = 440 * Math.pow(2, (108 - 69) / 12);
  const fund = g(L, f0, 2400, 14400);
  const alias = Math.max(g(L, f0 * 0.5, 2400, 14400), g(L, f0 * 1.5, 2400, 14400), g(L, f0 * 2.5, 2400, 14400), g(L, f0 * 3.5, 2400, 14400));
  check(alias / fund < 0.02, "saw at C8 is alias-free (mip-mapped)", `alias ratio ${(alias / fund).toFixed(4)}`);
}

/* --------------------------------------------------- 5. envelopes */
{
  const eng = makeEngine((p) => {
    sinePatch(p);
    p.params["env4.attack"] = P.normFor("env4.attack", 0.2);
    p.params["env4.decay"] = P.normFor("env4.decay", 0.3);
    p.params["env4.sustain"] = 0.5;
    p.params["env4.release"] = P.normFor("env4.release", 0.3);
    p.params["env4.curve"] = 0;
  });
  const { L } = render(eng, 1.6, note(0, 69, 0.8));
  const blockPeak = (t) => stats(L, Math.round(t * SR), Math.round((t + 0.01) * SR)).peak;
  const peak = Math.max(blockPeak(0.19), blockPeak(0.2), blockPeak(0.21));
  check(blockPeak(0.05) < peak * 0.4, "attack ramps up", `${blockPeak(0.05).toFixed(3)} vs ${peak.toFixed(3)}`);
  check(Math.abs(blockPeak(0.7) / peak - 0.5) < 0.06, "decay settles at 50% sustain", `${(blockPeak(0.7) / peak).toFixed(3)}`);
  check(blockPeak(0.95) < blockPeak(0.7) * 0.6, "release falls after note-off");
  check(blockPeak(1.15) < 1e-4, "release reaches silence after its time", `${blockPeak(1.15)}`);

  // Delay stage + one-shot mode ignores note-off.
  const eng2 = makeEngine((p) => {
    sinePatch(p);
    p.params["env4.delay"] = P.normFor("env4.delay", 0.1);
    p.params["env4.decay"] = P.normFor("env4.decay", 0.4);
    p.params["env4.sustain"] = 0;
    p.enums["env4.mode"] = 1;
  });
  const r2 = render(eng2, 0.6, note(0, 69, 0.05)).L;
  check(stats(r2, 0, Math.round(0.09 * SR)).peak < 1e-6, "envelope delay holds silence first");
  check(stats(r2, Math.round(0.15 * SR), Math.round(0.2 * SR)).peak > 0.05, "one-shot envelope plays past a short note-off");

  // Loop mode keeps retriggering attack/decay while held.
  const eng3 = makeEngine((p) => {
    sinePatch(p);
    p.params["env4.attack"] = P.normFor("env4.attack", 0.02);
    p.params["env4.decay"] = P.normFor("env4.decay", 0.08);
    p.params["env4.sustain"] = 0;
    p.enums["env4.mode"] = 2;
  });
  const r3 = render(eng3, 1, note(0, 69, 0.9)).L;
  check(stats(r3, Math.round(0.6 * SR), Math.round(0.7 * SR)).peak > 0.1, "loop envelope keeps cycling while the key is held");

  // Velocity sensitivity.
  const velPeak = (vel) => {
    const e = makeEngine((p) => {
      sinePatch(p);
      p.params["env4.vel"] = 1;
    });
    return stats(render(e, 0.3, note(0, 69, 0.25, vel)).L, Math.round(0.1 * SR), Math.round(0.2 * SR)).peak;
  };
  const soft = velPeak(0.25);
  const hard = velPeak(1);
  check(Math.abs(soft / hard - 0.25) < 0.03, "Env 4 velocity sensitivity scales the level", `${(soft / hard).toFixed(3)}`);
}

/* ----------------------------------------------- 6. voices & timing */
{
  const chord = [60, 64, 67, 71].flatMap((n) => note(0, n, 0.3));
  const eng = makeEngine();
  render(eng, 0.1, chord);
  check(eng.activeCount() === 4, "poly: 4 notes → 4 voices");
  const mono = makeEngine((p) => {
    p.enums["voice.mode"] = 1;
  });
  render(mono, 0.1, chord);
  check(mono.activeCount() === 1, "mono: 4 notes → 1 voice");
  const uni = makeEngine((p) => {
    p.enums["voice.unison"] = 3;
  });
  render(uni, 0.1, note(0, 60, 0.3));
  check(uni.activeCount() === 4, "unison 4 → 4 voices for one note");
  const lim = makeEngine((p) => {
    p.enums["voice.poly"] = 1;
  });
  let maxSeen = 0;
  lim.schedule([60, 62, 64, 65, 67].map((n, i) => ({ frame: i * 480, on: true, note: n, vel: 0.8 })));
  const tmpL = new Float32Array(128);
  const tmpR = new Float32Array(128);
  for (let b = 0; b < 40; b++) {
    lim.render(tmpL, tmpR, 128, lim.frame);
    maxSeen = Math.max(maxSeen, lim.activeCount());
  }
  check(maxSeen === 2, "polyphony limit 2 steals voices", `max ${maxSeen}`);

  const late = makeEngine((p) => sinePatch(p));
  const { L } = render(late, 0.1, note(1000 / SR, 69, 0.05));
  let first = -1;
  for (let i = 0; i < L.length; i++) {
    if (L[i] !== 0) {
      first = i;
      break;
    }
  }
  check(first === 1000, "note-on is sample accurate", `first sample ${first}`);

  // Mono glide moves the pitch gradually.
  const gl = makeEngine((p) => {
    sinePatch(p);
    p.enums["voice.mode"] = 1;
    p.params["voice.glide"] = P.normFor("voice.glide", 0.25);
  });
  const gr = render(gl, 0.8, [...note(0, 57, 0.8), ...note(0.3, 69, 0.5)]).L;
  const mid = zeroCrossFreq(gr, Math.round(0.33 * SR), Math.round(0.37 * SR));
  const end = zeroCrossFreq(gr, Math.round(0.7 * SR), Math.round(0.78 * SR));
  check(mid > 230 && mid < 420, "glide passes through intermediate pitches", `${mid.toFixed(1)} Hz`);
  check(Math.abs(end / 440 - 1) < 0.01, "glide arrives at the target pitch", `${end.toFixed(1)} Hz`);

  // Legato: the second overlapping note does not retrigger the envelope.
  const leg = makeEngine((p) => {
    sinePatch(p);
    p.enums["voice.mode"] = 2;
    p.params["env4.attack"] = P.normFor("env4.attack", 0.15);
  });
  const lr = render(leg, 0.5, [...note(0, 60, 0.5), ...note(0.25, 67, 0.2)]).L;
  check(stats(lr, Math.round(0.25 * SR), Math.round(0.26 * SR)).peak > 0.2, "legato keeps the envelope level on overlapping notes");

  const p2 = makeEngine();
  render(p2, 0.05, chord);
  p2.message({ type: "panic" });
  check(p2.activeCount() === 0 && stats(render(p2, 0.05).L).peak === 0, "panic silences everything immediately");
  const ao = makeEngine();
  render(ao, 0.05, [{ t: 0, on: true, note: 60 }]);
  ao.message({ type: "allOff" });
  render(ao, 1);
  check(ao.activeCount() === 0, "all-notes-off releases held voices");
}

/* -------------------------------------------- 7. oscillator modes */
{
  let allOk = true;
  let detail = "";
  for (let mode = 0; mode < P.OSC_MODES.length; mode++) {
    for (const intensity of [0, 0.5, 1]) {
      const eng = makeEngine((p) => {
        p.enums["osc1.mode"] = mode;
        p.params["osc1.int"] = intensity;
        p.params["osc1.pos"] = 0.6;
        p.enums["osc1.table"] = mode + 2;
      });
      const s = stats(render(eng, 0.3, note(0, 48, 0.25)).L);
      if (!s.finite || s.peak < 0.01 || eng.faults) {
        allOk = false;
        detail += `${P.OSC_MODES[mode]}@${intensity} peak ${s.peak} `;
      }
    }
  }
  check(allOk, "all 6 oscillator modes render at intensity 0 / 0.5 / 1", detail);
  // Spectrum intensity actually filters harmonics.
  const br = (intensity) => {
    const eng = makeEngine((p) => {
      p.enums["osc1.table"] = 0;
      p.params["osc1.pos"] = 1;
      p.params["osc1.int"] = intensity;
      p.enums["filter1.type"] = 0;
    });
    return brightness(render(eng, 0.3, note(0, 48, 0.25)).L, 2000, 12000);
  };
  check(br(0.2) < br(1) * 0.5, "Spectrum intensity darkens the oscillator");
  // Every table renders through the position range.
  let tablesOk = true;
  for (let t = 0; t < TABLES.length; t++) {
    const eng = makeEngine((p) => {
      p.enums["osc1.table"] = t;
      p.params["osc1.pos"] = 0.4;
    });
    eng.base[eng.idx["osc1.pos"]] = 0.4;
    const s = stats(render(eng, 0.15, note(0, 55, 0.1)).L);
    if (!s.finite || s.peak < 0.01) tablesOk = false;
  }
  check(tablesOk, "all 16 wavetables play");
  // Mod osc routings.
  let modOk = true;
  for (const key of ["modosc.ring", "modosc.phase", "modosc.pos", "modosc.ffm"]) {
    const eng = makeEngine((p) => {
      p.enums[key] = 1;
      p.params["modosc.rm"] = 0.7;
      p.params["modosc.pitch"] = P.normFor("modosc.pitch", 7);
      p.enums["filter1.type"] = 2;
      p.params["filter1.cutoff"] = 0.5;
    });
    const s = stats(render(eng, 0.3, note(0, 48, 0.25)).L);
    if (!s.finite || s.peak < 0.01 || eng.faults) modOk = false;
  }
  check(modOk, "modulation oscillator: ring / phase / position / filter FM render");
  const ringOff = stats(render(makeEngine((p) => sinePatch(p)), 0.3, note(0, 57, 0.25)).L);
  const ringOn = makeEngine((p) => {
    sinePatch(p);
    p.enums["modosc.ring"] = 1;
    p.params["modosc.rm"] = 1;
    p.params["modosc.pitch"] = P.normFor("modosc.pitch", 0);
  });
  const rr = render(ringOn, 0.3, note(0, 57, 0.25)).L;
  const at2f = goertzel(rr, 440, 4800, 12000);
  const at1f = goertzel(rr, 220, 4800, 12000);
  check(at2f > at1f * 20 && stats(rr).peak <= ringOff.peak * 1.01, "ring mod at unison moves a sine to 2f (sin·sin)", `${at2f.toFixed(1)} vs ${at1f.toFixed(1)}`);
  // Noise types.
  let noiseOk = true;
  for (let t = 0; t < P.NOISE_TYPES.length; t++) {
    const eng = makeEngine((p) => {
      p.params["osc1.amp"] = 0;
      p.params["noise.amp"] = 0.8;
      p.enums["noise.type"] = t;
    });
    const s = stats(render(eng, 0.3, note(0, 60, 0.25)).L);
    if (!s.finite || s.peak < 0.005) noiseOk = false;
  }
  check(noiseOk, "all 4 noise types render");
  // Feedback stays bounded at maximum.
  const fb = makeEngine((p) => {
    p.params["fb.amp"] = 1;
    p.params["filter1.res"] = 1;
    p.params["filter1.cutoff"] = 0.6;
  });
  const fs1 = stats(render(fb, 0.6, note(0, 48, 0.5)).L);
  check(fs1.finite && fs1.peak <= 1 && fb.faults === 0, "feedback at 100% with full resonance stays bounded");
}

/* ------------------------------------------------------ 8. filters */
{
  let allOk = true;
  let detail = "";
  for (let t = 1; t < P.FILTER_TYPES.length; t++) {
    for (const res of [0, 0.7, 1]) {
      const eng = makeEngine((p) => {
        p.params["osc1.pos"] = 1;
        p.params["noise.amp"] = 0.4;
        p.enums["filter1.type"] = t;
        p.params["filter1.cutoff"] = 0.55;
        p.params["filter1.b"] = 0.6;
        p.params["filter1.res"] = res;
      });
      const s = stats(render(eng, 0.4, note(0, 48, 0.35)).L);
      if (!s.finite || s.peak < 0.003 || s.peak > 1 || eng.faults) {
        allOk = false;
        detail += `${P.FILTER_TYPES[t].name}@res${res} peak ${s.peak.toFixed(4)} faults ${eng.faults}; `;
      }
    }
  }
  check(allOk, `all ${P.FILTER_TYPES.length - 1} filter types render at resonance 0 / 0.7 / 1`, detail);
  const lpBright = (cut, type = 2) => {
    const eng = makeEngine((p) => {
      p.params["osc1.pos"] = 1;
      p.enums["filter1.type"] = type;
      p.params["filter1.cutoff"] = cut;
    });
    return brightness(render(eng, 0.3, note(0, 48, 0.25)).L, 2400, 12000);
  };
  check(lpBright(0.3) < lpBright(0.95) * 0.2, "Lowpass 4 removes highs at low cutoff");
  check(lpBright(0.3, 1) < lpBright(0.95, 1) * 0.4, "Lowpass 2 removes highs at low cutoff");
  check(lpBright(0.7, 4) > lpBright(0.2, 4), "Highpass 2 removes lows at high cutoff (relatively brighter)");
  // Self-oscillation: resonant LP4 with tiny input rings near cutoff.
  const ring = makeEngine((p) => {
    sinePatch(p);
    p.enums["filter1.type"] = 2;
    p.params["filter1.res"] = 0.98;
    p.params["filter1.cutoff"] = P.normFor("filter1.cutoff", 0) + Math.log(1000 / 20) / Math.log(1000);
  });
  const rs = stats(render(ring, 0.4, note(0, 45, 0.35)).L);
  check(rs.finite && rs.peak > 0.02 && rs.peak <= 1, "resonant ladder stays stable");
  // Comb filter rings at its pitch.
  const comb = makeEngine((p) => {
    p.params["osc1.amp"] = 0;
    p.params["noise.amp"] = 0.6;
    p.enums["filter1.type"] = 10;
    p.params["filter1.cutoff"] = Math.log(440 / 20) / Math.log(1000);
    p.params["filter1.res"] = 0.97;
    p.params["filter1.b"] = 0;
  });
  const cl = render(comb, 0.5, note(0, 60, 0.45)).L;
  const gz = (f) => {
    const w = (2 * Math.PI * f) / SR;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 4800; i < 19200; i++) {
      const s0 = cl[i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
  };
  check(gz(440) > gz(660) * 3, "comb filter resonates at its pitch", `${gz(440).toFixed(1)} vs ${gz(660).toFixed(1)}`);
  // Serial routing: F1 → F2; parallel keeps them separate.
  const routeRms = (serpar, mix) => {
    const eng = makeEngine((p) => {
      p.params["osc1.pos"] = 1;
      p.enums["filter1.type"] = 2;
      p.params["filter1.cutoff"] = 0.9;
      p.enums["filter2.type"] = 1;
      p.params["filter2.cutoff"] = 0.9;
      p.params["filters.serpar"] = serpar;
      p.params["filters.mix"] = mix;
    });
    return stats(render(eng, 0.3, note(0, 48, 0.25)).L, 2400, 12000).rms;
  };
  check(routeRms(0, 1) > 0.01 && routeRms(1, 1) < 0.002, "Ser/Par fader: serial feeds F1 into F2, parallel does not");
  // Filter key tracking raises the cutoff for higher notes.
  const ktrOk = (() => {
    const eng = makeEngine((p) => {
      p.enums["filter1.type"] = 2;
      p.params["filter1.cutoff"] = 0.3;
      p.params["filter1.ktr"] = 1;
    });
    return stats(render(eng, 0.2, note(0, 84, 0.15)).L).peak > 0.02;
  })();
  check(ktrOk, "filter key tracking opens the filter for high notes");
}

/* --------------------------------------------- 9. inserts and FX */
{
  let insOk = true;
  let detail = "";
  for (let t = 1; t < P.INSERT_TYPES.length; t++) {
    for (let pos = 0; pos < 3; pos++) {
      const eng = makeEngine((p) => {
        p.enums["ins1.type"] = t;
        p.enums["ins1.pos"] = pos;
        p.params["ins1.a"] = 0.8;
        p.params["ins1.b"] = 0.7;
        p.enums["filter2.type"] = 2;
        p.params["filters.serpar"] = 0;
        p.params["filters.mix"] = 0.5;
      });
      const s = stats(render(eng, 0.3, note(0, 52, 0.25)).L);
      if (!s.finite || s.peak < 0.003 || eng.faults) {
        insOk = false;
        detail += `${P.INSERT_TYPES[t].name}/${P.INSERT_POS[pos]} `;
      }
    }
  }
  check(insOk, `all ${P.INSERT_TYPES.length - 1} insert types render at all 3 positions`, detail);
  // Frequency shifter moves a sine by the requested amount.
  const fsh = makeEngine((p) => {
    sinePatch(p);
    p.enums["ins1.type"] = 5;
    p.params["ins1.a"] = 1;
    p.params["ins1.b"] = 0.75; // +0.5 × note frequency
  });
  const fl = render(fsh, 0.5, note(0, 69, 0.45)).L;
  const shifted = zeroCrossFreq(fl, 4800, 19200);
  check(Math.abs(shifted / 660 - 1) < 0.01, "frequency shifter moves 440 Hz up by half the note frequency", `${shifted.toFixed(1)} Hz`);

  let fxOk = true;
  let fxDetail = "";
  for (let t = 1; t < P.FX_TYPES.length; t++) {
    for (const slot of [1, 2]) {
      const eng = makeEngine((p) => {
        p.enums[`fx${slot}.type`] = t;
        p.params[`fx${slot}.a`] = 0.6;
        p.params[`fx${slot}.b`] = 0.8;
        p.params[`fx${slot}.c`] = 0.8;
        p.enums["eq.on"] = 1;
        p.params["eq.low"] = 0.8;
        p.params["eq.high"] = 0.2;
      });
      const r = render(eng, 0.6, note(0, 48, 0.3));
      const s = stats(r.L);
      const sr = stats(r.R);
      if (!s.finite || !sr.finite || s.peak < 0.003 || s.peak > 1 || eng.faults) {
        fxOk = false;
        fxDetail += `${P.FX_TYPES[t].name}/FX${slot} `;
      }
    }
  }
  check(fxOk, `all ${P.FX_TYPES.length - 1} FX types render in both slots (with EQ on)`, fxDetail);
  // Delay Sync timing follows the tempo: 1/8 at 120 BPM = 250 ms.
  const dly = makeEngine(
    (p) => {
      sinePatch(p);
      p.params["env4.attack"] = 0;
      p.params["env4.decay"] = P.normFor("env4.decay", 0.01);
      p.params["env4.sustain"] = 0;
      p.params["env4.release"] = P.normFor("env4.release", 0.005);
      p.enums["fx1.type"] = 5;
      p.params["fx1.a"] = 1;
      p.params["fx1.c"] = 0;
      p.enums["fx1.ldiv"] = 5;
    },
    { bpm: 120 }
  );
  const dl = render(dly, 0.5, note(0, 69, 0.005)).L;
  let peakAt = 0;
  let pk = 0;
  for (let i = 0; i < dl.length; i++) {
    if (Math.abs(dl[i]) > pk) {
      pk = Math.abs(dl[i]);
      peakAt = i;
    }
  }
  check(Math.abs(peakAt / SR - 0.25) < 0.01, "Delay Sync 1/8 at 120 BPM echoes after 250 ms", `${((peakAt / SR) * 1000).toFixed(1)} ms`);
  dly.message({ type: "bpm", bpm: 60 });
  check(Math.abs(dly.bpm - 60) < 1e-9, "host tempo updates reach the engine");
  // Bypass routes signal around the FX.
  const byp = makeEngine((p) => {
    p.enums["fx1.type"] = 1;
    p.params["fx1.a"] = 1;
    p.params["byp.mod"] = 1;
  });
  const plain = stats(render(makeEngine(), 0.3, note(0, 60, 0.25)).L).rms;
  const bypassed = stats(render(byp, 0.3, note(0, 60, 0.25)).L).rms;
  check(Math.abs(bypassed / plain - 1) < 0.01, "Bypass at 100% skips the FX chain");
}

/* ---------------------------------------------------- 10. modulation */
{
  // LFO on cutoff makes the brightness move over time.
  const eng = makeEngine((p) => {
    p.params["osc1.pos"] = 1;
    p.enums["filter1.type"] = 2;
    p.params["filter1.cutoff"] = 0.5;
    p.enums["mod5.sync"] = 0;
    p.params["mod5.rate"] = P.normFor("mod5.rate", 4);
    p.mods.push({ src: "mod5", dst: "filter1.cutoff", amt: 0.4 });
  });
  const { L } = render(eng, 1, note(0, 48, 0.95));
  const blocks = [];
  for (let b = 0; b < 16; b++) blocks.push(brightness(L, 4800 + b * 2400, 4800 + (b + 1) * 2400));
  const spread = Math.max(...blocks) / Math.max(1e-9, Math.min(...blocks));
  check(spread > 2, "LFO → cutoff modulates the tone over time", `spread ${spread.toFixed(2)}`);
  // Macro modulation moves its targets.
  const mac = (m) =>
    stats(
      render(
        makeEngine((p) => {
          p.params["osc1.amp"] = 0;
          p.params["macro1"] = m;
          p.mods.push({ src: "macro1", dst: "osc1.amp", amt: 1 });
        }),
        0.2,
        note(0, 60, 0.15)
      ).L
    ).peak;
  check(mac(0) === 0 && mac(1) > 0.05, "macro → amp drives the parameter");
  // Envelope 1 on pitch sweeps the pitch.
  const sweep = makeEngine((p) => {
    sinePatch(p);
    p.params["osc1.pitch"] = 0.5;
    p.params["env1.decay"] = P.normFor("env1.decay", 0.4);
    p.params["env1.sustain"] = 0;
    p.mods.push({ src: "env1", dst: "osc1.pitch", amt: 0.25 });
  });
  const sw = render(sweep, 0.5, note(0, 57, 0.45)).L;
  const early = zeroCrossFreq(sw, 50, 600);
  const late = zeroCrossFreq(sw, 20160, 23000);
  check(early > late * 1.8, "envelope → pitch sweeps down", `${early.toFixed(0)} → ${late.toFixed(0)} Hz`);
  // Stepper produces discrete steps; performer draws shapes.
  for (const [type, name] of [
    [2, "stepper"],
    [1, "performer"],
  ]) {
    const e = makeEngine((p) => {
      sinePatch(p);
      p.enums["mod7.type"] = type;
      p.params["mod7.rate"] = 12 / 15;
      p.params["mod7.glide"] = 0;
      p.mods.push({ src: "mod7", dst: "osc1.amp", amt: -0.8 });
    });
    const r = render(e, 1, note(0, 60, 0.95)).L;
    const lv = [];
    for (let b = 0; b < 8; b++) lv.push(stats(r, b * 6000, (b + 1) * 6000).peak);
    const varied = Math.max(...lv) - Math.min(...lv);
    check(varied > 0.05 && lv.every(Number.isFinite), `${name} modulates over time`, lv.map((x) => x.toFixed(2)).join(" "));
  }
  // Velocity as a source, aftertouch messages, trigger random.
  const velMod = (vel) =>
    stats(
      render(
        makeEngine((p) => {
          sinePatch(p);
          p.params["osc1.amp"] = 0;
          p.mods.push({ src: "vel", dst: "osc1.amp", amt: 1 });
        }),
        0.2,
        note(0, 69, 0.15, vel)
      ).L
    ).peak;
  check(velMod(1) > velMod(0.3) * 2, "velocity source modulates its target");
  const at = makeEngine((p) => {
    sinePatch(p);
    p.params["osc1.amp"] = 0;
    p.mods.push({ src: "at", dst: "osc1.amp", amt: 1 });
  });
  render(at, 0.05, [{ t: 0, on: true, note: 69 }]);
  const before = stats(render(at, 0.05).L).peak;
  at.message({ type: "at", value: 1 });
  const after = stats(render(at, 0.1).L, 2400).peak;
  check(before < 0.001 && after > 0.05, "aftertouch source responds to channel pressure");
  // Global-param modulation (FX dry/wet by macro) works without crashing.
  const gm = makeEngine((p) => {
    p.enums["fx1.type"] = 6;
    p.params["fx1.a"] = 0;
    p.params["macro2"] = 1;
    p.mods.push({ src: "macro2", dst: "fx1.a", amt: 0.8 });
  });
  const gs = stats(render(gm, 0.4, note(0, 60, 0.2)).L);
  check(gs.finite && gm.gp[gm.idx["fx1.a"]] > 0.7, "macros modulate global FX parameters");
  // Live param / enum / mods / seq messages.
  const live = makeEngine();
  live.message({ type: "param", id: "filter1.cutoff", value: 0.2 });
  live.message({ type: "enum", id: "filter1.type", value: 10 });
  live.message({ type: "mods", mods: [{ src: "env1", dst: "osc2.amp", amt: 0.5 }] });
  live.message({ type: "seq", slot: 2, steps: new Array(16).fill(0.25), shapes: new Array(16).fill(3) });
  check(
    live.base[live.idx["filter1.cutoff"]] === 0.2 && live.fType[0] === 10 && live.modParams.length === 1 && live.seqSteps[2][5] === 0.25,
    "live param / enum / mods / seq messages apply"
  );
  live.message({ type: "param", id: "filter1.cutoff", value: NaN });
  live.message({ type: "param", id: "nope", value: 1 });
  live.message(null);
  live.message({ type: "unknown" });
  check(live.base[live.idx["filter1.cutoff"]] === 0.2, "bad messages are ignored");
  const posts = [];
  live.post = (m) => posts.push(m);
  live.message({ type: "meter", on: true });
  render(live, 0.2, note(0, 60, 0.1));
  check(posts.length >= 2 && posts[0].type === "status" && typeof posts[0].voices === "number", "status messages report voices / CPU / meters");
}

/* ------------------------------------------------- 11. sample rates */
{
  for (const sr of [44100, 96000]) {
    const eng = makeEngine((p) => sinePatch(p), { sr });
    const total = Math.round(0.4 * sr);
    eng.schedule([{ frame: 0, on: true, note: 69, vel: 0.9 }]);
    const L = new Float32Array(total);
    const bl = new Float32Array(128);
    const br = new Float32Array(128);
    for (let pos = 0; pos < total; pos += 128) {
      eng.render(bl, br, 128, eng.frame);
      L.set(bl.subarray(0, Math.min(128, total - pos)), pos);
    }
    const f = zeroCrossFreq(L, Math.round(0.05 * sr), total, sr);
    check(Math.abs(f / 440 - 1) < 0.002, `pitch is correct at ${sr} Hz`, `${f.toFixed(2)} Hz`);
  }
}

/* ----------------------------------------------------- 12. presets */
{
  check(FACTORY_PRESETS.length >= 24, `at least 24 factory presets (${FACTORY_PRESETS.length})`);
  const names = FACTORY_PRESETS.map((p) => p.name);
  check(new Set(names).size === names.length, "factory preset names are unique");
  check(
    FACTORY_PRESETS.every((p) => JSON.stringify(P.sanitizePatch(p)) === JSON.stringify(p)),
    "every factory preset survives the sanitizer unchanged"
  );
  const cats = new Set(FACTORY_PRESETS.map((p) => p.category));
  check(["Bass", "Lead", "Pad", "Pluck", "Keys"].every((c) => cats.has(c)), "presets cover bass / lead / pad / pluck / keys");
  const banned = /massive|native instruments|\bNI\b|fl studio|fruity|image-line|serum|sylenth/i;
  check(!FACTORY_PRESETS.some((p) => banned.test(`${p.name} ${p.author} ${p.notes} ${p.tags.join(" ")}`)), "preset text uses no vendor or product names");
  let allOk = true;
  let detail = "";
  let worstPeak = 0;
  const t0 = Date.now();
  for (const preset of FACTORY_PRESETS) {
    const eng = new Engine(SR, { params: PARAM_TABLE, patch: preset, tables: TABLES, bpm: 128 });
    const events = [
      ...note(0, 48, 0.7, 0.85),
      ...note(0, 55, 0.7, 0.8),
      ...note(0, 60, 0.7, 0.8),
      ...note(0.75, 64, 0.5, 1),
      ...note(0.75, 36, 0.5, 0.6),
    ];
    const r = render(eng, 2, events);
    const s = stats(r.L);
    const s2 = stats(r.R);
    worstPeak = Math.max(worstPeak, s.peak, s2.peak);
    if (!s.finite || !s2.finite || Math.max(s.peak, s2.peak) < 0.02 || eng.faults) {
      allOk = false;
      detail += `${preset.name} (peak ${Math.max(s.peak, s2.peak).toFixed(3)}, faults ${eng.faults}); `;
    }
  }
  const ms = Date.now() - t0;
  check(allOk, "every factory preset renders audible, finite audio with no DSP faults", detail);
  check(worstPeak <= 1, "no preset exceeds 0 dBFS", worstPeak.toFixed(3));
  const rt = ms / 1000 / (FACTORY_PRESETS.length * 2);
  console.log(`  · preset render speed: ${(1 / rt).toFixed(1)}× realtime (5-note chords, ${FACTORY_PRESETS.length} presets)`);
  check(rt < 1, "presets render faster than realtime in Node");
  const custom = presetFromDiff({ name: "T", category: "Lead", params: { "osc2.amp": 0.5 }, real: { "filter1.cutoff": 500 } });
  check(custom.params["osc2.amp"] === 0.5 && Math.abs(P.cutoffHz(custom.params["filter1.cutoff"]) - 500) < 0.5, "presetFromDiff merges knob and real-unit values");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
