/**
 * Gate Shaper — a per-track rhythmic insert with two sections:
 *
 *   VOLUME  16-step gate / ramp pattern (attack, release and depth shape it).
 *   TIME    16-step repeat / stutter pattern. Each step can replay an earlier
 *           step of the same 16-step cycle, implemented as an automated delay line.
 *
 * Everything here is either pure data or plain Web Audio scheduling, so the same
 * code drives real-time playback and the offline (export) renderer.
 *
 * Signal path of one insert:  input -> (dry | delay -> wet) -> sum -> volume -> output
 */

export const GS_STEPS = 16;
// Longest stutter reach. DelayNode buffers are allocated once with this maximum.
export const GS_MAX_DELAY_SEC = 10;

export const GS_RATES = [
  { id: "1/16", beats: 0.25 },
  { id: "1/12", beats: 1 / 3 },
  { id: "1/8", beats: 0.5 },
  { id: "1/6", beats: 2 / 3 },
  { id: "1/4", beats: 1 },
];

export const GS_SYNC_OPTIONS = [0, 1, 2, 4, 8, 16]; // beats; 0 = off

/** Deterministic PRNG so "Random" / "Chaos" presets are stable across reloads. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rep = (pattern, times) => Array.from({ length: times }, () => pattern).flat();

/* ---------- VOLUME presets: 16 levels, 0 = closed, 1 = open ---------- */
export const GS_VOLUME_PRESETS = {
  Empty: Array(16).fill(1),
  "2 Beat Gate": rep([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0], 1),
  "1 Beat Gate": rep([1, 1, 1, 1, 0, 0, 0, 0], 2),
  "1/2 Bt Gate": rep([1, 1, 0, 0], 4),
  "Off Beat": rep([0, 0, 1, 0], 4),
  "Trance Gate": [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
  "Saw Gate": rep([1, 0.75, 0.5, 0.25], 4),
  "Saw Up": rep([0.25, 0.5, 0.75, 1], 4),
  Sidechain: rep([0.1, 0.4, 0.7, 1], 4),
  Tremolo: Array.from({ length: 16 }, (_, i) => 0.5 + 0.5 * Math.cos((2 * Math.PI * i) / 8)),
  "Fade In": Array.from({ length: 16 }, (_, i) => (i + 1) / 16),
  "Fade Out": Array.from({ length: 16 }, (_, i) => 1 - i / 16),
  "Spd Up Gate": [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1],
  "Pulse 1/4": rep([1, 0, 0, 0], 4),
  Random: (() => {
    const r = mulberry32(7);
    return Array.from({ length: 16 }, () => (r() < 0.25 ? 0 : Math.round(r() * 4) / 4 || 0.25));
  })(),
  Mute: Array(16).fill(0),
};

/* ---------- TIME presets: 16 source indices (each <= its own step) ---------- */
function chaosSources(seed) {
  const r = mulberry32(seed * 977);
  return Array.from({ length: 16 }, (_, i) => {
    if (r() < 0.45) return i; // play through
    return i - Math.floor(r() * (i + 1)); // replay an earlier step
  });
}

export const GS_TIME_PRESETS = {
  Empty: Array.from({ length: 16 }, (_, i) => i),
  "Basic 1": [0, 0, 0, 0, 4, 4, 4, 4, 8, 8, 8, 8, 12, 12, 12, 12],
  "Basic 2": [0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 8, 8, 8, 8],
  "Basic 3": [0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14],
  Echo: Array.from({ length: 16 }, (_, i) => Math.max(0, i - 1)),
  Hold: Array(16).fill(0),
  Ratchet: [0, 0, 0, 0, 4, 4, 5, 5, 8, 8, 8, 8, 12, 12, 13, 13],
  "Complex 1": [0, 1, 2, 2, 2, 5, 6, 6, 8, 9, 10, 11, 11, 11, 14, 15],
  "Complex 2": [0, 0, 2, 3, 4, 4, 4, 7, 8, 9, 8, 8, 12, 13, 14, 14],
  "Complex 3": [0, 1, 1, 3, 4, 5, 5, 5, 8, 8, 10, 11, 12, 13, 13, 15],
  "Complex 4": [0, 0, 0, 3, 4, 4, 6, 7, 8, 8, 8, 11, 12, 12, 12, 15],
  "Chaos 1": chaosSources(1),
  "Chaos 2": chaosSources(2),
  "Chaos 3": chaosSources(3),
  "Chaos 4": chaosSources(4),
  "Chaos 5": chaosSources(5),
};

export const GS_VOLUME_NAMES = Object.keys(GS_VOLUME_PRESETS);
export const GS_TIME_NAMES = Object.keys(GS_TIME_PRESETS);

export function defaultGateFx() {
  return {
    volOn: false,
    volPreset: "2 Beat Gate",
    volLevels: GS_VOLUME_PRESETS["2 Beat Gate"].slice(),
    timeOn: false,
    timePreset: "Basic 1",
    hold: false,
    rate: "1/16",
    att: 5, // ms
    rel: 80, // ms
    ins: 100, // depth in percent
    trigSync: 0, // beats
    posSync: 0, // beats
  };
}

const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Fill in any missing / invalid fields so older projects keep working. */
export function normalizeGateFx(raw) {
  const d = defaultGateFx();
  const fx = { ...d, ...(raw && typeof raw === "object" ? raw : {}) };
  fx.volOn = !!fx.volOn;
  fx.timeOn = !!fx.timeOn;
  fx.hold = !!fx.hold;
  if (!GS_RATES.some((r) => r.id === fx.rate)) fx.rate = d.rate;
  if (!GS_TIME_PRESETS[fx.timePreset]) fx.timePreset = d.timePreset;
  if (!Array.isArray(fx.volLevels) || fx.volLevels.length !== GS_STEPS) {
    fx.volLevels = GS_VOLUME_PRESETS[fx.volPreset]
      ? GS_VOLUME_PRESETS[fx.volPreset].slice()
      : d.volLevels.slice();
  }
  fx.volLevels = fx.volLevels.map((v) => clampNum(v, 0, 1, 1));
  fx.att = clampNum(fx.att, 0, 250, d.att);
  fx.rel = clampNum(fx.rel, 0, 1000, d.rel);
  fx.ins = clampNum(fx.ins, 0, 100, d.ins);
  fx.trigSync = GS_SYNC_OPTIONS.includes(Number(fx.trigSync)) ? Number(fx.trigSync) : 0;
  fx.posSync = GS_SYNC_OPTIONS.includes(Number(fx.posSync)) ? Number(fx.posSync) : 0;
  return fx;
}

export function rateBeats(rateId) {
  const r = GS_RATES.find((x) => x.id === rateId) || GS_RATES[0];
  return r.beats;
}

/** True when the time section is doing anything (hold forces it on). */
export function timeSectionActive(fx) {
  return fx.timeOn || fx.hold;
}

/** Source index for a step within its cycle (Hold repeats the cycle's first step). */
export function timeSourceFor(fx, stepInCycle) {
  if (fx.hold) return 0;
  const table = GS_TIME_PRESETS[fx.timePreset] || GS_TIME_PRESETS.Empty;
  return table[stepInCycle];
}

/**
 * Index of the pattern restart origin, in beats, for a given beat.
 *  - Trigger sync: restart every N beats counted from the start of playback.
 *  - Position sync: restart every N beats counted from song position zero.
 *  - Otherwise the pattern is locked to song position zero.
 */
export function patternOriginBeat(fx, beat, passStartBeat, stepBeats) {
  let origin = 0;
  if (fx.trigSync > 0) {
    origin = passStartBeat + Math.floor((beat - passStartBeat) / fx.trigSync + 1e-9) * fx.trigSync;
  } else if (fx.posSync > 0) {
    origin = Math.floor(beat / fx.posSync + 1e-9) * fx.posSync;
  }
  // Snap to the step grid so every step lands on an exact integer index.
  return Math.round(origin / stepBeats) * stepBeats;
}

/** Step index (0..15) inside the pattern cycle that contains `beat`. */
export function gateStepIndexAt(fx, beat, passStartBeat = 0) {
  const sb = rateBeats(fx.rate);
  const n = Math.floor(beat / sb + 1e-9);
  const o = Math.round(patternOriginBeat(fx, beat, passStartBeat, sb) / sb);
  return (((n - o) % GS_STEPS) + GS_STEPS) % GS_STEPS;
}

export function effectiveVolume(level, insPct) {
  const depth = Math.min(1, Math.max(0, insPct / 100));
  return 1 - depth * (1 - level);
}

/* ---------- Web Audio graph ---------- */

/**
 * Builds the insert. `ctx` may be an AudioContext or OfflineAudioContext.
 * Returns the node set; connect `input` and `output` into the track chain.
 */
export function createGateNodes(ctx) {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const delay = ctx.createDelay(GS_MAX_DELAY_SEC);
  const wet = ctx.createGain();
  const sum = ctx.createGain();
  const volume = ctx.createGain();
  const output = ctx.createGain();

  dry.gain.value = 1;
  wet.gain.value = 0;
  delay.delayTime.value = 0;

  input.connect(dry);
  input.connect(delay);
  delay.connect(wet);
  dry.connect(sum);
  wet.connect(sum);
  sum.connect(volume);
  volume.connect(output);

  return { input, dry, delay, wet, sum, volume, output };
}

/** Instant (non-scheduled) settings: routing between dry and time-section path. */
export function applyGateRouting(nodes, rawFx, ctx, { immediate = false } = {}) {
  const fx = normalizeGateFx(rawFx);
  const active = timeSectionActive(fx);
  const dryTarget = active ? 0 : 1;
  const wetTarget = active ? 1 : 0;
  if (immediate) {
    nodes.dry.gain.value = dryTarget;
    nodes.wet.gain.value = wetTarget;
    return;
  }
  const t = ctx.currentTime;
  nodes.dry.gain.setTargetAtTime(dryTarget, t, 0.004);
  nodes.wet.gain.setTargetAtTime(wetTarget, t, 0.004);
}

/**
 * Schedules the gate automation for the pass [startBeat, endBeat), with beat
 * `startBeat` occurring at context time `t0`. Replaces earlier automation from t0.
 */
export function scheduleGateFx(nodes, rawFx, { bpm, startBeat, endBeat, t0 }) {
  const fx = normalizeGateFx(rawFx);
  const spb = 60 / bpm;
  const sb = rateBeats(fx.rate);
  const stepSec = sb * spb;
  const volParam = nodes.volume.gain;
  const delayParam = nodes.delay.delayTime;

  volParam.cancelScheduledValues(t0);
  delayParam.cancelScheduledValues(t0);

  const volOn = fx.volOn;
  const timeOn = timeSectionActive(fx);
  const levelFor = (i) => effectiveVolume(fx.volLevels[i], fx.ins);

  // Step state at a boundary `beatOfStep` (exact multiple of sb).
  const stateAt = (beatOfStep) => {
    const o = Math.round(patternOriginBeat(fx, beatOfStep, startBeat, sb) / sb);
    const n = Math.round(beatOfStep / sb);
    const i = (((n - o) % GS_STEPS) + GS_STEPS) % GS_STEPS;
    const src = timeSourceFor(fx, i);
    const delaySec = Math.min(GS_MAX_DELAY_SEC - 0.02, Math.max(0, (i - src) * stepSec));
    return { i, vol: levelFor(i), delaySec };
  };

  const n0 = Math.floor(startBeat / sb + 1e-9);
  const first = stateAt(n0 * sb);

  volParam.setValueAtTime(volOn ? first.vol : 1, t0);
  delayParam.setValueAtTime(timeOn ? first.delaySec : 0, t0);

  let lastVol = volOn ? first.vol : 1;
  let lastDelay = timeOn ? first.delaySec : 0;
  const rampSec = Math.min(0.002, stepSec * 0.5);
  const attTau = Math.max(0.002, fx.att / 1000);
  const relTau = Math.max(0.002, fx.rel / 1000);

  for (let n = n0 + 1; ; n++) {
    const beat = n * sb;
    if (beat >= endBeat) break;
    const t = t0 + (beat - startBeat) * spb;
    const st = stateAt(beat);

    if (volOn) {
      const tau = st.vol > lastVol ? attTau : relTau;
      volParam.setTargetAtTime(st.vol, t, tau);
      lastVol = st.vol;
    }
    if (timeOn) {
      delayParam.setValueAtTime(lastDelay, t);
      delayParam.linearRampToValueAtTime(st.delaySec, t + rampSec);
      lastDelay = st.delaySec;
    }
  }
}

/** Schedules every insert in a pass. `trackNodes` maps trackId -> { gate }. */
export function scheduleAllGates({ project, trackNodes, masterGate, bpm, startBeat, endBeat, t0 }) {
  for (const track of project.tracks) {
    const nodes = trackNodes.get(track.id);
    if (!nodes || !nodes.gate) continue;
    scheduleGateFx(nodes.gate, track.gateFx, { bpm, startBeat, endBeat, t0 });
  }
  if (masterGate) {
    scheduleGateFx(masterGate, project.masterGateFx, { bpm, startBeat, endBeat, t0 });
  }
}
