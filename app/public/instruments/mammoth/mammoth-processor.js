/**
 * Mammoth — wavetable synthesizer DSP (AudioWorklet).
 *
 * Self-contained on purpose: no imports, so the same file runs as an
 * AudioWorklet module (realtime and OfflineAudioContext), as a main-thread
 * module (the offline fallback renderer) and inside the Node tests.
 *
 * Signal flow per voice (one voice per note, unison adds voices):
 *   OSC1–3 (wavetable, 6 modes) ┐                       ┌──────────────┐
 *   Noise                       ├─ F1 route ─▶ Filter 1 ─┤ Ser/Par      │
 *   Feedback (tap)              ┘  F2 route ─▶ Filter 2 ◀┘ (F1 → F2)    │
 *   Modulation OSC → ring / phase / position / filter FM                │
 *   Mix (F1 ↔ F2) → inserts → Amp (Env 4 × Amp Mod, pan) ───────────────┘
 * Global (stereo): Bypass split → FX1 → FX2 → EQ → Master → soft clip.
 *
 * Modulation: 4 envelopes, 4 slots (LFO / Performer / Stepper), 8 macros,
 * velocity, key track, aftertouch, trigger-random. Depth is added in knob
 * space (0..1) and then mapped through each parameter's curve.
 */

const TAU = Math.PI * 2;
const LN2 = Math.LN2;
const SIN_SIZE = 4096;
const SIN = new Float64Array(SIN_SIZE + 1);
for (let i = 0; i <= SIN_SIZE; i++) SIN[i] = Math.sin((i / SIN_SIZE) * TAU);

/** Sine of x cycles (table lookup, linear interpolation). */
function fsin(x) {
  x -= Math.floor(x);
  const p = x * SIN_SIZE;
  const i = p | 0;
  const f = p - i;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * f;
}
/** Fast tanh (Padé 3/2), exact at the clamp points. */
function ftanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const NSRC = 20;
const S_VEL = 16;
const S_KTR = 17;
const S_AT = 18;
const S_TRR = 19;
const MAX_VOICES = 32;
const COMB_SIZE = 8192;
const COMB_MASK = COMB_SIZE - 1;
const SYNC_BEATS = [32, 16, 8, 4, 2, 1.5, 1, 2 / 3, 0.75, 0.5, 1 / 3, 0.375, 0.25, 1 / 6, 0.125, 0.0625];
const DELAY_BEATS = [0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2, 4];
const QUALITY_CB = [32, 16, 8];
const VOWELS = [
  [800, 1150, 2900],
  [400, 1700, 2600],
  [300, 2200, 3000],
  [450, 800, 2830],
  [325, 700, 2530],
];
// Niemitalo's 90° phase-difference allpass network (two chains of four).
const HILBERT_A = [0.6923878, 0.9360654322959, 0.988229522686, 0.9987488452737].map((a) => a * a);
const HILBERT_B = [0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278].map((a) => a * a);

/* ------------------------------------------------------------------ voice */

class Voice {
  constructor(np, seed) {
    this.active = false;
    this.gate = false;
    this.note = 60;
    this.vel = 1;
    this.trr = 0;
    this.age = 0;
    this.curNote = 60;
    this.targetNote = 60;
    this.detuneSemis = 0;
    this.panOff = 0;
    this.posOff = 0;
    this.time = 0;
    this.envStage = new Int8Array(4);
    this.envLevel = new Float64Array(4);
    this.envT = new Float64Array(4);
    this.envFrom = new Float64Array(4);
    this.slotPhase = new Float64Array(4);
    this.slotVal = new Float64Array(4);
    this.slotOut = new Float64Array(4);
    this.rnd0 = new Float64Array(4);
    this.rnd1 = new Float64Array(4);
    this.src = new Float64Array(NSRC);
    this.p = new Float64Array(np);
    this.norm = new Float64Array(np);
    this.oscPhase = new Float64Array(3);
    this.modPhase = 0;
    this.fs = [new Float64Array(16), new Float64Array(16)];
    this.comb = [new Float32Array(COMB_SIZE), new Float32Array(COMB_SIZE)];
    this.combIdx = new Int32Array(2);
    this.is = [new Float64Array(48), new Float64Array(48)];
    this.ibuf = [new Float32Array(COMB_SIZE), new Float32Array(COMB_SIZE)];
    this.iIdx = new Int32Array(2);
    this.fbBuf = new Float32Array(64);
    this.noise = new Float64Array(12);
    this.rng = (seed * 2654435761) >>> 0 || 1;
    this.ampPrev = 0;
    this.glPrev = 0.7071;
    this.grPrev = 0.7071;
  }

  resetDsp() {
    this.fs[0].fill(0);
    this.fs[1].fill(0);
    this.comb[0].fill(0);
    this.comb[1].fill(0);
    this.is[0].fill(0);
    this.is[1].fill(0);
    this.ibuf[0].fill(0);
    this.ibuf[1].fill(0);
    this.fbBuf.fill(0);
    this.noise.fill(0);
    this.modPhase = 0;
    this.ampPrev = 0;
  }

  random() {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }
}

/* ----------------------------------------------------------------- engine */

class MammothEngine {
  /**
   * @param {number} sr sample rate
   * @param {{params?: Array, patch?: object, tables?: Array, events?: Array, bpm?: number}} opts
   */
  constructor(sr, opts = {}) {
    this.sr = sr;
    this.invSr = 1 / sr;
    this.aliasCeil = Math.max(sr * 0.5, sr - 18000);
    const table = Array.isArray(opts.params) ? opts.params : [];
    const NP = table.length;
    this.NP = NP;
    this.idx = Object.create(null);
    this.pMin = new Float64Array(NP);
    this.pMax = new Float64Array(NP);
    this.pCurve = new Int8Array(NP);
    this.pLog = new Float64Array(NP);
    this.isGlobal = new Uint8Array(NP);
    for (let i = 0; i < NP; i++) {
      const [id, min, max, curve] = table[i];
      this.idx[id] = i;
      this.pMin[i] = min;
      this.pMax[i] = max;
      this.pCurve[i] = curve | 0;
      this.pLog[i] = curve === 1 && min > 0 ? Math.log(max / min) : 0;
      if (/^(fx\d|eq|byp|master)\./.test(id)) this.isGlobal[i] = 1;
    }
    this.base = new Float64Array(NP);
    this.mapped = new Float64Array(NP);
    this.gp = new Float64Array(NP);
    this.gnorm = new Float64Array(NP);
    this.enums = Object.create(null);
    this.modStart = new Int32Array(NP).fill(-1);
    this.modEnd = new Int32Array(NP).fill(-1);
    this.modSrc = new Int32Array(64);
    this.modAmt = new Float64Array(64);
    this.modParams = new Int32Array(0);
    this.gModParams = new Int32Array(0);
    this.seqSteps = [new Float64Array(16), new Float64Array(16), new Float64Array(16), new Float64Array(16)];
    this.seqShapes = [new Int8Array(16), new Int8Array(16), new Int8Array(16), new Int8Array(16)];
    this.cacheIndices();

    this.tables = [];
    this.fallback = MammothEngine.sineTable();
    if (Array.isArray(opts.tables)) for (const t of opts.tables) this.addTable(t);

    this.voices = [];
    for (let v = 0; v < MAX_VOICES; v++) this.voices.push(new Voice(NP, v + 1));
    this.events = [];
    this.frame = 0;
    this.hostBpm = opts.bpm > 0 ? opts.bpm : 120;
    this.bpm = this.hostBpm;
    this.at = 0;
    this.noteCounter = 0;
    this.lastNote = 60;
    this.lastVoice = null;
    this.monoStack = [];
    this.rng = 0x9e3779b9;

    // Free-running (global) slot state.
    this.gPhase = new Float64Array(4);
    this.gVal = new Float64Array(4);
    this.gOut = new Float64Array(4);
    this.gRnd0 = new Float64Array(4);
    this.gRnd1 = new Float64Array(4);
    this.zeroSrc = new Float64Array(NSRC);

    const MAXB = 64;
    this.modBuf = new Float32Array(MAXB);
    this.oscBuf = new Float32Array(MAXB);
    this.noiseBuf = new Float32Array(MAXB);
    this.in1 = new Float32Array(MAXB);
    this.in2 = new Float32Array(MAXB);
    this.out1 = new Float32Array(MAXB);
    this.out2 = new Float32Array(MAXB);
    this.mixBuf = new Float32Array(MAXB);
    this.ensureBus(512);

    this.fxState = [this.newFxState(), this.newFxState()];
    this.eqState = new Float64Array(24);
    this.eqCoef = new Float64Array(15);
    this.eqKey = "";

    this.post = null;
    this.meter = false;
    this.statusEvery = Math.round(sr * 0.05);
    this.statusCount = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.cpuBusy = 0;
    this.cpuFrames = 0;
    this.cpu = 0;
    this.faults = 0;

    this.applyPatch(opts.patch || null);
    if (Array.isArray(opts.events)) this.schedule(opts.events);
  }

  static sineTable() {
    const size = 2048;
    const data = new Float32Array(size + 1);
    for (let i = 0; i <= size; i++) data[i] = Math.sin((i / size) * TAU);
    return { frames: 1, size, levels: 1, data };
  }

  ensureBus(n) {
    if (!this.busL || this.busL.length < n) {
      this.busL = new Float32Array(n);
      this.busR = new Float32Array(n);
      this.fxL = new Float32Array(n);
      this.fxR = new Float32Array(n);
    }
  }

  /* ----------------------------------------------------------- indices */

  cacheIndices() {
    const ix = (id) => (id in this.idx ? this.idx[id] : -1);
    const tri = (f) => [ix(f(1)), ix(f(2)), ix(f(3))];
    const two = (f) => [ix(f(1)), ix(f(2))];
    const four = (f, start = 1) => [ix(f(start)), ix(f(start + 1)), ix(f(start + 2)), ix(f(start + 3))];
    this.I = {
      oPitch: tri((i) => `osc${i}.pitch`),
      oPos: tri((i) => `osc${i}.pos`),
      oInt: tri((i) => `osc${i}.int`),
      oAmp: tri((i) => `osc${i}.amp`),
      oRoute: tri((i) => `osc${i}.route`),
      oFine: tri((i) => `osc${i}.fine`),
      oPhase: tri((i) => `osc${i}.phase`),
      oKtr: tri((i) => `osc${i}.ktr`),
      mPitch: ix("modosc.pitch"),
      mRm: ix("modosc.rm"),
      nColor: ix("noise.color"),
      nAmp: ix("noise.amp"),
      nRoute: ix("noise.route"),
      fbAmp: ix("fb.amp"),
      fbRoute: ix("fb.route"),
      fCut: two((j) => `filter${j}.cutoff`),
      fB: two((j) => `filter${j}.b`),
      fRes: two((j) => `filter${j}.res`),
      fKtr: two((j) => `filter${j}.ktr`),
      serpar: ix("filters.serpar"),
      mix: ix("filters.mix"),
      insA: two((k) => `ins${k}.a`),
      insB: two((k) => `ins${k}.b`),
      ampMod: ix("amp.mod"),
      pan: ix("amp.pan"),
      byp: ix("byp.mod"),
      master: ix("master.vol"),
      fxA: two((m) => `fx${m}.a`),
      fxB: two((m) => `fx${m}.b`),
      fxC: two((m) => `fx${m}.c`),
      eqLow: ix("eq.low"),
      eqMid: ix("eq.mid"),
      eqMidF: ix("eq.midf"),
      eqHigh: ix("eq.high"),
      eDelay: four((e) => `env${e}.delay`),
      eAtt: four((e) => `env${e}.attack`),
      eDec: four((e) => `env${e}.decay`),
      eSus: four((e) => `env${e}.sustain`),
      eRel: four((e) => `env${e}.release`),
      eCurve: four((e) => `env${e}.curve`),
      eVel: four((e) => `env${e}.vel`),
      eKtr: four((e) => `env${e}.ktr`),
      sRate: four((s) => `mod${s}.rate`, 5),
      sAmp: four((s) => `mod${s}.amp`, 5),
      sXfade: four((s) => `mod${s}.xfade`, 5),
      sPhase: four((s) => `mod${s}.phase`, 5),
      sGlide: four((s) => `mod${s}.glide`, 5),
      sDelay: four((s) => `mod${s}.delay`, 5),
      macro: [1, 2, 3, 4, 5, 6, 7, 8].map((q) => ix(`macro${q}`)),
      glide: ix("voice.glide"),
      detune: ix("voice.detune"),
      spread: ix("voice.spread"),
      posSpread: ix("voice.posspread"),
      tune: ix("global.tune"),
      bpm: ix("global.bpm"),
    };
  }

  mapIndex(i, n) {
    const min = this.pMin[i];
    const max = this.pMax[i];
    switch (this.pCurve[i]) {
      case 1:
        return min * Math.exp(n * this.pLog[i]);
      case 2:
        return min + n * n * (max - min);
      case 3:
        return min + n * n * n * (max - min);
      default:
        return min + n * (max - min);
    }
  }

  /* ------------------------------------------------------------- patch */

  applyPatch(patch) {
    const params = (patch && patch.params) || {};
    for (const id in this.idx) {
      const i = this.idx[id];
      const v = Number(params[id]);
      this.base[i] = Number.isFinite(v) ? clamp01(v) : this.base[i] || 0;
      this.mapped[i] = this.mapIndex(i, this.base[i]);
    }
    const enums = (patch && patch.enums) || {};
    for (const id in enums) this.enums[id] = enums[id] | 0;
    this.deriveEnums();
    this.setMods((patch && patch.mods) || []);
    if (patch && patch.seq) {
      for (let s = 0; s < 4; s++) {
        const r = patch.seq[`mod${s + 5}`];
        if (r) this.setSeq(s, r.steps, r.shapes);
      }
    }
    this.updateBpm();
  }

  e(id, def = 0) {
    const v = this.enums[id];
    return v === undefined ? def : v;
  }

  deriveEnums() {
    const e = (id, d) => this.e(id, d);
    this.oscOn = [e("osc1.on", 1), e("osc2.on", 1), e("osc3.on", 1)];
    this.oscTable = [e("osc1.table", 0), e("osc2.table", 1), e("osc3.table", 4)];
    this.oscMode = [e("osc1.mode", 0), e("osc2.mode", 0), e("osc3.mode", 0)];
    this.oscRestart = [e("osc1.restart", 1), e("osc2.restart", 1), e("osc3.restart", 1)];
    this.modOscOn = e("modosc.on", 1);
    this.ringT = e("modosc.ring", 0);
    this.phaseT = e("modosc.phase", 0);
    this.posT = e("modosc.pos", 0);
    this.ffmT = e("modosc.ffm", 0);
    this.noiseOn = e("noise.on", 1);
    this.noiseType = e("noise.type", 0);
    this.fbOn = e("fb.on", 1);
    this.fbTap = e("fb.tap", 0);
    this.fOn = [e("filter1.on", 1), e("filter2.on", 1)];
    this.fType = [e("filter1.type", 2), e("filter2.type", 0)];
    this.insOn = [e("ins1.on", 1), e("ins2.on", 1)];
    this.insType = [e("ins1.type", 0), e("ins2.type", 0)];
    this.insPos = [e("ins1.pos", 2), e("ins2.pos", 2)];
    this.bypOn = e("byp.on", 1);
    this.fxOn = [e("fx1.on", 1), e("fx2.on", 1)];
    const prevFx = this.fxType || [0, 0];
    this.fxType = [e("fx1.type", 0), e("fx2.type", 0)];
    this.fxDivL = [e("fx1.ldiv", 5), e("fx2.ldiv", 5)];
    this.fxDivR = [e("fx1.rdiv", 8), e("fx2.rdiv", 8)];
    this.eqOn = e("eq.on", 0);
    this.envMode = [e("env1.mode", 0), e("env2.mode", 0), e("env3.mode", 0), e("env4.mode", 0)];
    this.slotType = [5, 6, 7, 8].map((s, i) => e(`mod${s}.type`, i === 0 ? 0 : i === 1 ? 1 : 2));
    this.slotSync = [5, 6, 7, 8].map((s) => e(`mod${s}.sync`, 1));
    this.shapeA = [5, 6, 7, 8].map((s) => e(`mod${s}.shapeA`, 0));
    this.shapeB = [5, 6, 7, 8].map((s) => e(`mod${s}.shapeB`, 1));
    this.slotFree = [5, 6, 7, 8].map((s) => e(`mod${s}.restart`, 0));
    this.slotLen = [5, 6, 7, 8].map((s) => e(`mod${s}.len`, 15) + 1);
    this.slotBi = [5, 6, 7, 8].map((s, i) => e(`mod${s}.polarity`, i === 0 ? 1 : 0));
    this.poly = e("voice.poly", 7) + 1;
    this.voiceMode = e("voice.mode", 0);
    this.unison = Math.max(1, Math.min(4, e("voice.unison", 0) + 1));
    this.glideMode = e("voice.glidemode", 0);
    this.CB = QUALITY_CB[Math.max(0, Math.min(2, e("global.quality", 2)))];
    this.bpmSrc = e("global.bpmsrc", 0);
    for (let m = 0; m < 2; m++) {
      if (prevFx[m] !== this.fxType[m] && this.fxState) this.resetFx(m);
    }
  }

  setMods(list) {
    const items = [];
    const srcIndex = {
      env1: 0, env2: 1, env3: 2, env4: 3, mod5: 4, mod6: 5, mod7: 6, mod8: 7,
      macro1: 8, macro2: 9, macro3: 10, macro4: 11, macro5: 12, macro6: 13, macro7: 14, macro8: 15,
      vel: 16, ktr: 17, at: 18, trr: 19,
    };
    for (const m of Array.isArray(list) ? list : []) {
      if (!m) continue;
      const dst = this.idx[m.dst];
      const src = srcIndex[m.src];
      const amt = Number(m.amt);
      if (dst === undefined || src === undefined || !Number.isFinite(amt) || amt === 0) continue;
      items.push([dst, src, Math.max(-1, Math.min(1, amt))]);
      if (items.length >= 64) break;
    }
    items.sort((a, b) => a[0] - b[0]);
    this.modStart.fill(-1);
    this.modEnd.fill(-1);
    const params = [];
    const gparams = [];
    for (let k = 0; k < items.length; k++) {
      const [dst, src, amt] = items[k];
      this.modSrc[k] = src;
      this.modAmt[k] = amt;
      if (this.modStart[dst] < 0) {
        this.modStart[dst] = k;
        if (this.isGlobal[dst]) gparams.push(dst);
        else params.push(dst);
      }
      this.modEnd[dst] = k + 1;
    }
    this.modParams = Int32Array.from(params);
    this.gModParams = Int32Array.from(gparams);
  }

  setSeq(s, steps, shapes) {
    if (s < 0 || s > 3) return;
    if (steps) for (let i = 0; i < 16; i++) this.seqSteps[s][i] = clamp01(Number(steps[i]) || 0);
    if (shapes) for (let i = 0; i < 16; i++) this.seqShapes[s][i] = Math.max(0, Math.min(8, shapes[i] | 0));
  }

  setParam(id, n) {
    const i = this.idx[id];
    if (i === undefined) return;
    const v = clamp01(Number(n));
    if (!Number.isFinite(v)) return;
    this.base[i] = v;
    this.mapped[i] = this.mapIndex(i, v);
    if (i === this.I.bpm) this.updateBpm();
  }

  setEnum(id, v) {
    this.enums[id] = v | 0;
    this.deriveEnums();
    if (id === "global.bpmsrc") this.updateBpm();
  }

  updateBpm() {
    this.bpm = this.bpmSrc === 1 && this.I.bpm >= 0 ? this.mapped[this.I.bpm] : this.hostBpm;
    if (!(this.bpm > 0)) this.bpm = 120;
  }

  addTable(t) {
    if (!t || !t.data || !(t.frames > 0)) return;
    const data = t.data instanceof Float32Array ? t.data : new Float32Array(t.data);
    this.tables[t.index | 0] = { frames: t.frames, size: t.size, levels: t.levels, data };
  }

  /* ------------------------------------------------------------ events */

  schedule(list) {
    for (const ev of list) {
      if (!ev) continue;
      const item = {
        frame: Math.max(0, Math.round(Number(ev.frame) || 0)),
        on: !!ev.on,
        note: Math.max(0, Math.min(127, Math.round(Number(ev.note) || 0))),
        vel: Math.max(0.001, Math.min(1, Number(ev.vel) || 0.8)),
      };
      // Keep the queue sorted; note-offs sort before note-ons at the same frame.
      let k = this.events.length;
      while (k > 0) {
        const prev = this.events[k - 1];
        if (prev.frame < item.frame || (prev.frame === item.frame && (!prev.on || item.on))) break;
        k--;
      }
      this.events.splice(k, 0, item);
    }
  }

  message(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "patch":
        this.applyPatch(msg.patch);
        break;
      case "param":
        this.setParam(msg.id, msg.value);
        break;
      case "enum":
        this.setEnum(msg.id, msg.value);
        break;
      case "mods":
        this.setMods(msg.mods);
        break;
      case "seq":
        this.setSeq(msg.slot | 0, msg.steps, msg.shapes);
        break;
      case "table":
        this.addTable(msg.table);
        break;
      case "note": {
        const frame = msg.time > 0 ? Math.round(msg.time * this.sr) : 0;
        this.schedule([{ frame, on: msg.on, note: msg.note, vel: msg.vel }]);
        break;
      }
      case "notes":
        if (Array.isArray(msg.list)) {
          this.schedule(
            msg.list.map((ev) => ({ frame: ev.time > 0 ? Math.round(ev.time * this.sr) : 0, on: ev.on, note: ev.note, vel: ev.vel }))
          );
        }
        break;
      case "allOff":
        this.events.length = 0;
        this.allNotesOff();
        break;
      case "panic":
        this.events.length = 0;
        this.panic();
        break;
      case "bpm":
        if (msg.bpm > 0) {
          this.hostBpm = Number(msg.bpm);
          this.updateBpm();
        }
        break;
      case "at":
        this.at = clamp01(Number(msg.value) || 0);
        break;
      case "meter":
        this.meter = !!msg.on;
        break;
      default:
        break;
    }
  }

  applyEvent(ev) {
    if (ev.on) this.noteOn(ev.note, ev.vel);
    else this.noteOff(ev.note);
  }

  /* ------------------------------------------------------------- notes */

  random() {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }

  activeCount() {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    return n;
  }

  allocVoice(limit) {
    let count = 0;
    let free = null;
    for (const v of this.voices) {
      if (v.active) count++;
      else if (!free) free = v;
    }
    if (free && count < limit) return free;
    // Steal: released voices first (quietest), then the oldest held one.
    let best = null;
    let bestScore = Infinity;
    for (const v of this.voices) {
      if (!v.active) continue;
      const score = (v.gate ? 1e9 : 0) + (v.gate ? v.age : v.envLevel[3] * 1e6);
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best || this.voices[0];
  }

  startVoice(v, note, vel, u, U, glideFrom) {
    const wasActive = v.active && v.envLevel[3] > 0.0005;
    v.active = true;
    v.gate = true;
    v.note = note;
    v.vel = vel;
    v.trr = this.random();
    v.age = this.noteCounter;
    v.targetNote = note;
    const glideT = this.mapped[this.I.glide];
    v.curNote = glideT > 0.0005 && glideFrom !== null && glideFrom !== undefined ? glideFrom : note;
    if (U > 1) {
      const sp = (u / (U - 1)) * 2 - 1;
      v.detuneSemis = (sp * this.mapped[this.I.detune]) / 100;
      v.panOff = sp * this.mapped[this.I.spread];
      v.posOff = sp * this.mapped[this.I.posSpread] * 0.5;
    } else {
      v.detuneSemis = 0;
      v.panOff = 0;
      v.posOff = 0;
    }
    for (let e = 0; e < 4; e++) {
      v.envFrom[e] = wasActive ? v.envLevel[e] : 0;
      if (!wasActive) v.envLevel[e] = 0;
      v.envT[e] = 0;
      v.envStage[e] = this.mapped[this.I.eDelay[e]] > 0.0005 ? 1 : 2;
    }
    for (let s = 0; s < 4; s++) {
      if (this.slotFree[s]) continue;
      const ph = this.base[this.I.sPhase[s]];
      v.slotPhase[s] = this.slotType[s] === 0 ? ph : ph * this.slotLen[s];
      v.rnd0[s] = v.random();
      v.rnd1[s] = v.random();
      const step = Math.floor(v.slotPhase[s]) % this.slotLen[s];
      v.slotVal[s] = this.seqSteps[s][step];
    }
    if (!wasActive) {
      v.resetDsp();
      for (let i = 0; i < 3; i++) {
        v.oscPhase[i] = this.oscRestart[i] ? this.mapped[this.I.oPhase[i]] : v.random();
      }
      v.glPrev = 0.7071;
      v.grPrev = 0.7071;
    }
    // The first control tick steps envelopes with these, so they must hold this patch's values.
    v.p.set(this.mapped);
    v.norm.set(this.base);
    v.time = 0;
    this.lastVoice = v;
  }

  noteOn(note, vel) {
    this.noteCounter++;
    const U = this.unison;
    const glideFrom = this.lastNote;
    if (this.voiceMode === 0) {
      for (const v of this.voices) if (v.active && v.gate && v.note === note) this.releaseVoice(v);
      const limit = Math.min(MAX_VOICES, Math.max(U, this.poly * U));
      const legatoOnly = this.glideMode === 1;
      const anyHeld = this.voices.some((v) => v.active && v.gate);
      const from = legatoOnly && !anyHeld ? null : glideFrom;
      for (let u = 0; u < U; u++) {
        const v = this.allocVoice(limit);
        this.startVoice(v, note, vel, u, U, from);
      }
    } else {
      const idx = this.monoStack.indexOf(note);
      if (idx >= 0) this.monoStack.splice(idx, 1);
      this.monoStack.push(note);
      if (this.monoStack.length > 32) this.monoStack.shift();
      let wasHeld = false;
      for (let u = 0; u < U; u++) if (this.voices[u].active && this.voices[u].gate) wasHeld = true;
      for (let u = 0; u < U; u++) {
        const v = this.voices[u];
        if (this.voiceMode === 2 && wasHeld && v.active) {
          v.note = note;
          v.targetNote = note;
          if (this.mapped[this.I.glide] <= 0.0005) v.curNote = note;
          v.gate = true;
          this.lastVoice = v;
        } else {
          const from = this.glideMode === 1 && !wasHeld ? null : glideFrom;
          this.startVoice(v, note, vel, u, U, from);
        }
      }
      // Any other voice left over from poly mode is released.
      for (let k = U; k < MAX_VOICES; k++) if (this.voices[k].active && this.voices[k].gate) this.releaseVoice(this.voices[k]);
    }
    this.lastNote = note;
  }

  releaseVoice(v) {
    v.gate = false;
    for (let e = 0; e < 4; e++) {
      if (this.envMode[e] === 1) continue; // one shot ignores note-off
      const st = v.envStage[e];
      if (st >= 1 && st <= 4) {
        v.envFrom[e] = v.envLevel[e];
        v.envT[e] = 0;
        v.envStage[e] = 5;
      }
    }
  }

  noteOff(note) {
    if (this.voiceMode === 0) {
      for (const v of this.voices) if (v.active && v.gate && v.note === note) this.releaseVoice(v);
      return;
    }
    const idx = this.monoStack.indexOf(note);
    if (idx >= 0) this.monoStack.splice(idx, 1);
    const U = this.unison;
    if (this.monoStack.length > 0) {
      const prev = this.monoStack[this.monoStack.length - 1];
      for (let u = 0; u < U; u++) {
        const v = this.voices[u];
        if (!v.active || !v.gate || v.note !== note) continue;
        v.note = prev;
        v.targetNote = prev;
        if (this.mapped[this.I.glide] <= 0.0005) v.curNote = prev;
      }
      this.lastNote = prev;
    } else {
      for (let u = 0; u < MAX_VOICES; u++) {
        const v = this.voices[u];
        if (v.active && v.gate) this.releaseVoice(v);
      }
    }
  }

  allNotesOff() {
    this.monoStack.length = 0;
    for (const v of this.voices) if (v.active && v.gate) this.releaseVoice(v);
  }

  panic() {
    this.monoStack.length = 0;
    for (const v of this.voices) {
      v.active = false;
      v.gate = false;
      v.envStage.fill(0);
      v.envLevel.fill(0);
      v.resetDsp();
    }
    for (let m = 0; m < 2; m++) this.resetFx(m);
    this.eqState.fill(0);
  }

  /* ----------------------------------------------------------- control */

  stepEnv(v, e, dt) {
    const st = v.envStage[e];
    if (st === 0) return;
    const p = v.p;
    const I = this.I;
    const ktr = p[I.eKtr[e]];
    const scale = ktr > 0 ? Math.pow(2, (-(v.note - 60) / 12) * ktr) : 1;
    const curve = p[I.eCurve[e]];
    let t = v.envT[e] + dt;
    let level = v.envLevel[e];
    const sus = p[I.eSus[e]];
    switch (st) {
      case 1: {
        if (t >= p[I.eDelay[e]] * scale) {
          v.envStage[e] = 2;
          v.envFrom[e] = level;
          t = 0;
        }
        break;
      }
      case 2: {
        const A = p[I.eAtt[e]] * scale;
        const u = t / A;
        const from = v.envFrom[e];
        if (u >= 1) {
          level = 1;
          v.envStage[e] = 3;
          v.envFrom[e] = 1;
          t = 0;
        } else {
          level = from + (1 - from) * (1 - Math.pow(1 - u, 1 + curve * 3));
        }
        break;
      }
      case 3: {
        const D = p[I.eDec[e]] * scale;
        const u = t / D;
        if (u >= 1) {
          level = sus;
          t = 0;
          const mode = this.envMode[e];
          if (mode === 2 && v.gate) {
            v.envStage[e] = 2;
            v.envFrom[e] = level;
          } else if (mode === 1) {
            v.envStage[e] = 5;
            v.envFrom[e] = level;
          } else {
            v.envStage[e] = 4;
          }
        } else {
          level = sus + (v.envFrom[e] - sus) * Math.pow(1 - u, 1 + curve * 4);
        }
        break;
      }
      case 4:
        level = sus;
        break;
      case 5: {
        const R = p[I.eRel[e]] * scale;
        const u = t / R;
        if (u >= 1) {
          level = 0;
          v.envStage[e] = 0;
        } else {
          level = v.envFrom[e] * Math.pow(1 - u, 1 + curve * 4);
        }
        break;
      }
      default:
        break;
    }
    v.envT[e] = t;
    v.envLevel[e] = level;
  }

  slotFreq(s, rateNorm, rateHz) {
    if (this.slotSync[s]) {
      const beats = SYNC_BEATS[Math.round(clamp01(rateNorm) * (SYNC_BEATS.length - 1))];
      return this.bpm / 60 / beats;
    }
    return rateHz;
  }

  lfoShape(shape, ph, r0, r1) {
    switch (shape) {
      case 0:
        return fsin(ph);
      case 1:
        return ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
      case 2:
        return 2 * ph - 1;
      case 3:
        return 1 - 2 * ph;
      case 4:
        return ph < 0.5 ? 1 : -1;
      case 5:
        return r1 * 2 - 1;
      case 6: {
        const w = 0.5 - 0.5 * Math.cos(Math.PI * ph);
        return (r0 + (r1 - r0) * w) * 2 - 1;
      }
      case 7: {
        const q = 1 - ph;
        return 2 * q * q * q - 1;
      }
      default:
        return 0;
    }
  }

  perfShape(shape, u) {
    switch (shape) {
      case 0:
        return 1;
      case 1:
        return u;
      case 2:
        return 1 - u;
      case 3:
        return 1 - Math.abs(2 * u - 1);
      case 4:
        return 0.5 - 0.5 * Math.cos(TAU * u);
      case 5:
        return u * u * u;
      case 6: {
        const q = 1 - u;
        return q * q * q;
      }
      case 7:
        return u < 0.5 ? 1 : 0;
      default:
        return 0;
    }
  }

  /**
   * Advances one slot (state arrays passed in so voices and the free-running
   * global copy share the code) and returns its output.
   */
  stepSlot(s, dt, phaseArr, valArr, r0Arr, r1Arr, p, norm, time, rand) {
    const I = this.I;
    const rateI = I.sRate[s];
    const freq = this.slotFreq(s, norm ? norm[rateI] : this.base[rateI], p[rateI]);
    const type = this.slotType[s];
    const len = this.slotLen[s];
    let out;
    if (type === 0) {
      let ph = phaseArr[s] + freq * dt;
      if (ph >= 1) {
        ph -= Math.floor(ph);
        r0Arr[s] = r1Arr[s];
        r1Arr[s] = rand();
      }
      phaseArr[s] = ph;
      const a = this.lfoShape(this.shapeA[s], ph, r0Arr[s], r1Arr[s]);
      const xf = p[I.sXfade[s]];
      const b = xf > 0 ? this.lfoShape(this.shapeB[s], ph, r0Arr[s], r1Arr[s]) : 0;
      out = a + (b - a) * xf;
      if (!this.slotBi[s]) out = 0.5 + 0.5 * out;
    } else {
      let pos = phaseArr[s] + freq * dt;
      if (pos >= len) pos -= Math.floor(pos / len) * len;
      phaseArr[s] = pos;
      const step = Math.floor(pos);
      const u = pos - step;
      const level = this.seqSteps[s][step];
      if (type === 1) {
        out = level * this.perfShape(this.seqShapes[s][step], u);
      } else {
        const g = p[I.sGlide[s]];
        if (g <= 0.001) valArr[s] = level;
        else {
          const tau = Math.max(0.0005, (g / Math.max(0.01, freq)) * 0.5);
          valArr[s] += (level - valArr[s]) * (1 - Math.exp(-dt / tau));
        }
        out = valArr[s];
      }
      if (this.slotBi[s]) out = out * 2 - 1;
    }
    out *= p[I.sAmp[s]];
    const fade = p[I.sDelay[s]];
    if (fade > 0.001 && time < fade) out *= time / fade;
    return out;
  }

  advanceGlobalSlots(dt) {
    const randFn = () => this.random();
    for (let s = 0; s < 4; s++) {
      if (!this.slotFree[s]) continue;
      this.gOut[s] = this.stepSlot(s, dt, this.gPhase, this.gVal, this.gRnd0, this.gRnd1, this.mapped, null, 1e9, randFn);
    }
  }

  controlVoice(v, len) {
    const dt = len * this.invSr;
    const I = this.I;
    if (v.curNote !== v.targetNote) {
      const gt = this.mapped[I.glide];
      if (gt <= 0.0005) v.curNote = v.targetNote;
      else {
        v.curNote += (v.targetNote - v.curNote) * (1 - Math.exp(-dt / (gt * 0.4)));
        if (Math.abs(v.targetNote - v.curNote) < 0.001) v.curNote = v.targetNote;
      }
    }
    // Envelopes and slots read their own (possibly modulated) params from the
    // previous control tick, which keeps the dependency loop one tick deep.
    for (let e = 0; e < 4; e++) this.stepEnv(v, e, dt);
    const src = v.src;
    for (let e = 0; e < 4; e++) {
      const vs = v.p[I.eVel[e]];
      src[e] = v.envLevel[e] * (1 - vs + vs * v.vel);
    }
    const voiceRand = () => v.random();
    for (let s = 0; s < 4; s++) {
      src[4 + s] = this.slotFree[s]
        ? this.gOut[s]
        : this.stepSlot(s, dt, v.slotPhase, v.slotVal, v.rnd0, v.rnd1, v.p, v.norm, v.time, voiceRand);
    }
    for (let q = 0; q < 8; q++) src[8 + q] = this.mapped[I.macro[q]];
    src[S_VEL] = v.vel;
    const kt = (v.note - 60) / 48;
    src[S_KTR] = kt < -1 ? -1 : kt > 1 ? 1 : kt;
    src[S_AT] = this.at;
    src[S_TRR] = v.trr;
    const p = v.p;
    p.set(this.mapped);
    const mp = this.modParams;
    for (let k = 0; k < mp.length; k++) {
      const i = mp[k];
      let n = this.base[i];
      for (let m = this.modStart[i]; m < this.modEnd[i]; m++) n += this.modAmt[m] * src[this.modSrc[m]];
      n = n < 0 ? 0 : n > 1 ? 1 : n;
      v.norm[i] = n;
      p[i] = this.mapIndex(i, n);
    }
    v.time += dt;
  }

  updateGlobalParams() {
    const gp = this.gp;
    gp.set(this.mapped);
    const list = this.gModParams;
    if (list.length === 0) return;
    const lv = this.lastVoice && this.lastVoice.active ? this.lastVoice : null;
    const src = lv ? lv.src : this.zeroSrc;
    if (!lv) for (let q = 0; q < 8; q++) src[8 + q] = this.mapped[this.I.macro[q]];
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      let n = this.base[i];
      for (let m = this.modStart[i]; m < this.modEnd[i]; m++) n += this.modAmt[m] * src[this.modSrc[m]];
      n = n < 0 ? 0 : n > 1 ? 1 : n;
      this.gnorm[i] = n;
      gp[i] = this.mapIndex(i, n);
    }
  }

  /* ------------------------------------------------------------- audio */

  renderOsc(v, i, out, N, modOn) {
    const tbl = this.tables[this.oscTable[i]] || this.fallback;
    const d = tbl.data;
    const F = tbl.frames;
    const S = tbl.size;
    const stride = S + 1;
    const Lv = tbl.levels;
    const p = v.p;
    const I = this.I;
    const ktr = p[I.oKtr[i]] / 100;
    const semis = (v.curNote - 60) * ktr + 60 - 69 + p[I.oPitch[i]] + p[I.oFine[i]] / 100 + p[I.tune] + v.detuneSemis;
    const freq = 440 * Math.pow(2, semis / 12);
    let inc = freq * this.invSr;
    if (inc > 0.49) inc = 0.49;
    const mode = this.oscMode[i];
    const intensity = p[I.oInt[i]];
    const R = mode >= 4 ? 1 + intensity * 7 : 1;
    const effF = freq * R;
    const maxH = this.aliasCeil / Math.max(1, effF);
    let lvl = maxH >= 1024 ? 0 : Math.min(Lv - 1, Math.ceil(Math.log2(1024 / maxH)));
    let lvl2 = lvl;
    let lfrac = 0;
    if (mode === 0 && intensity < 0.999 && Lv > 1) {
      const sl = (1 - intensity) * (Lv - 1);
      const s0 = Math.floor(sl);
      if (s0 >= lvl) {
        lvl = s0;
        lvl2 = Math.min(Lv - 1, s0 + 1);
        lfrac = sl - s0;
      }
    }
    const pos = clamp01(p[I.oPos[i]] + v.posOff);
    const fp = pos * (F - 1);
    const f0 = Math.floor(fp);
    const ff = fp - f0;
    const f1 = f0 < F - 1 ? f0 + 1 : f0;
    const b00 = (lvl * F + f0) * stride;
    const b01 = (lvl * F + f1) * stride;
    const b10 = (lvl2 * F + f0) * stride;
    const b11 = (lvl2 * F + f1) * stride;
    const rmAmt = p[I.mRm];
    const own = i + 1;
    const pm = modOn && this.phaseT === own ? rmAmt * 0.35 : 0;
    const ring = modOn && this.ringT === own ? rmAmt : 0;
    const posMod = modOn && this.posT === own && rmAmt > 0;
    let bend = 0;
    let bendK = 1;
    if (mode === 1) bend = (intensity * 0.95) / TAU;
    else if (mode === 2) bend = (-intensity * 0.95) / TAU;
    else if (mode === 3) {
      bend = ((intensity - 0.5) * 2 * 0.95) / (2 * TAU);
      bendK = 2;
    }
    const modBuf = this.modBuf;
    let ph = v.oscPhase[i];
    for (let k = 0; k < N; k++) {
      let x = ph;
      if (pm !== 0) x += pm * modBuf[k];
      if (bend !== 0) x -= bend * fsin(x * bendK);
      x -= Math.floor(x);
      let w = 1;
      if (R !== 1) {
        if (mode === 4) w = 1.55 * (0.5 - 0.5 * fsin(x + 0.25));
        else if (x > 0.96) w = (1 - x) * 25;
        x *= R;
        x -= Math.floor(x);
      }
      let B0 = b00;
      let B1 = b01;
      let FF = ff;
      if (posMod) {
        const pp = clamp01(pos + rmAmt * 0.5 * modBuf[k]) * (F - 1);
        const g0 = pp | 0;
        FF = pp - g0;
        B0 = (lvl * F + g0) * stride;
        B1 = (lvl * F + (g0 < F - 1 ? g0 + 1 : g0)) * stride;
      }
      const ix = x * S;
      const j = ix | 0;
      const fr = ix - j;
      let a = d[B0 + j];
      const s0 = a + (d[B0 + j + 1] - a) * fr;
      a = d[B1 + j];
      const s1 = a + (d[B1 + j + 1] - a) * fr;
      let s = s0 + (s1 - s0) * FF;
      if (lfrac > 0) {
        a = d[b10 + j];
        const t0 = a + (d[b10 + j + 1] - a) * fr;
        a = d[b11 + j];
        const t1 = a + (d[b11 + j + 1] - a) * fr;
        s += (t0 + (t1 - t0) * ff - s) * lfrac;
      }
      s *= w;
      if (ring !== 0) s *= 1 - ring + ring * modBuf[k];
      out[k] = s;
      ph += inc;
      if (ph >= 1) ph -= 1;
    }
    v.oscPhase[i] = ph;
  }

  renderNoise(v, out, N) {
    const color = v.p[this.I.nColor];
    const st = v.noise;
    const type = this.noiseType;
    let rng = v.rng;
    for (let k = 0; k < N; k++) {
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      rng >>>= 0;
      const w = (rng / 4294967296) * 2 - 1;
      let x;
      if (type === 1) {
        st[0] = 0.99765 * st[0] + w * 0.099046;
        st[1] = 0.963 * st[1] + w * 0.2965164;
        st[2] = 0.57 * st[2] + w * 1.0526913;
        x = (st[0] + st[1] + st[2] + w * 0.1848) * 0.22;
      } else if (type === 2) {
        if (st[3] <= 0) {
          st[4] = w > 0 ? 0.8 : -0.8;
          st[3] = 1 + Math.floor((1 - color) * 63);
        }
        st[3]--;
        x = st[4];
      } else if (type === 3) {
        const density = 0.0005 + color * color * 0.06;
        if (Math.abs(w) < density) st[5] = w > 0 ? 1 : -1;
        st[5] *= 0.86;
        x = st[5];
      } else {
        x = w;
      }
      out[k] = x;
    }
    v.rng = rng;
    if (type <= 1) {
      // Colour: below centre a lowpass darkens, above it a highpass thins.
      if (color < 0.48) {
        const fc = 200 * Math.pow(100, color * 2);
        const c = 1 - Math.exp((-TAU * fc) / this.sr);
        let z = st[6];
        for (let k = 0; k < N; k++) {
          z += (out[k] - z) * c;
          out[k] = z;
        }
        st[6] = z;
      } else if (color > 0.52) {
        const fc = 20 * Math.pow(400, (color - 0.5) * 2);
        const c = 1 - Math.exp((-TAU * fc) / this.sr);
        let z = st[7];
        for (let k = 0; k < N; k++) {
          z += (out[k] - z) * c;
          out[k] = (out[k] - z) * 1.3;
        }
        st[7] = z;
      }
    }
  }

  processFilter(v, j, buf, N, modOn) {
    if (!this.fOn[j]) return;
    const type = this.fType[j];
    if (type === 0) return;
    const p = v.p;
    const I = this.I;
    const st = v.fs[j];
    const cutN = p[I.fCut[j]];
    const bk = p[I.fB[j]];
    const res = p[I.fRes[j]];
    const ktr = p[I.fKtr[j]];
    let fc = 20 * Math.pow(1000, cutN);
    if (ktr > 0) fc *= Math.pow(2, ((v.curNote - 60) / 12) * ktr);
    const fmax = this.sr * 0.47;
    if (fc > fmax) fc = fmax;
    if (fc < 8) fc = 8;
    const ffm = modOn && this.ffmT === j + 1 ? p[I.mRm] * 3 * LN2 : 0;
    const modBuf = this.modBuf;
    const sr = this.sr;
    switch (type) {
      case 1:
      case 3:
      case 4:
      case 6:
      case 7:
      case 8: {
        const g0 = Math.tan((Math.PI * fc) / sr);
        let k = 2 - 1.97 * res;
        if (type === 6) k = 0.12 + res * 2.8;
        let a1 = 1 / (1 + g0 * (g0 + k));
        let a2 = g0 * a1;
        let a3 = g0 * a2;
        let ic1 = st[0];
        let ic2 = st[1];
        const drive = type === 1 ? 1 + bk * 6 : type === 7 ? 1 + bk * 12 : 1;
        const dcomp = drive > 1 ? 1 / Math.pow(drive, 0.35) : 1;
        const scream = type === 8 ? bk : 0;
        const bpGain = Math.sqrt(k);
        let last = st[2];
        for (let n = 0; n < N; n++) {
          if (ffm !== 0) {
            const g = g0 * Math.exp(ffm * modBuf[n]);
            a1 = 1 / (1 + g * (g + k));
            a2 = g * a1;
            a3 = g * a2;
          }
          let x = buf[n];
          if (drive > 1) x = ftanh(x * drive) * dcomp;
          if (scream > 0) x += scream * 2.5 * ftanh(last * (1 + scream * 6));
          const v3 = x - ic2;
          const v1 = a1 * ic1 + a2 * v3;
          const v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1;
          ic2 = 2 * v2 - ic2;
          if (type === 7) ic1 = ftanh(ic1 * 0.8) * 1.25;
          let y;
          if (type === 1 || type === 7) y = v2;
          else if (type === 3 || type === 8) y = v1 * bpGain;
          else if (type === 4) y = x - k * v1 - v2;
          else y = x - k * v1;
          last = v1;
          buf[n] = y;
        }
        st[0] = ic1;
        st[1] = ic2;
        st[2] = last;
        break;
      }
      case 5: {
        // Highpass 4: a fixed Butterworth-ish stage, then a resonant stage.
        const g0 = Math.tan((Math.PI * fc) / sr);
        const kA = 1.848;
        const kB = 2 - 1.97 * res;
        let a1 = 1 / (1 + g0 * (g0 + kA));
        let a2 = g0 * a1;
        let a3 = g0 * a2;
        let b1 = 1 / (1 + g0 * (g0 + kB));
        let b2 = g0 * b1;
        let b3 = g0 * b2;
        let s0 = st[0];
        let s1 = st[1];
        let s2 = st[2];
        let s3 = st[3];
        for (let n = 0; n < N; n++) {
          if (ffm !== 0) {
            const g = g0 * Math.exp(ffm * modBuf[n]);
            a1 = 1 / (1 + g * (g + kA));
            a2 = g * a1;
            a3 = g * a2;
            b1 = 1 / (1 + g * (g + kB));
            b2 = g * b1;
            b3 = g * b2;
          }
          const x = buf[n];
          let v3 = x - s1;
          let v1 = a1 * s0 + a2 * v3;
          let v2 = s1 + a2 * s0 + a3 * v3;
          s0 = 2 * v1 - s0;
          s1 = 2 * v2 - s1;
          const h = x - kA * v1 - v2;
          v3 = h - s3;
          v1 = b1 * s2 + b2 * v3;
          v2 = s3 + b2 * s2 + b3 * v3;
          s2 = 2 * v1 - s2;
          s3 = 2 * v2 - s3;
          buf[n] = h - kB * v1 - v2;
        }
        st[0] = s0;
        st[1] = s1;
        st[2] = s2;
        st[3] = s3;
        break;
      }
      case 2:
      case 9: {
        // Zero-delay-feedback 4-pole ladder (Lowpass 4 / Acid).
        const g0 = Math.tan((Math.PI * fc) / sr);
        let G = g0 / (1 + g0);
        const acid = type === 9;
        const kq = res * (acid ? 4.4 : 4.1);
        const drive = acid ? 1 + bk * 4 : 1 + bk * 6;
        const comp = (1 + kq * 0.45) / Math.sqrt(drive);
        const bias = acid ? 0.18 * bk : 0;
        const biasOff = acid ? ftanh(bias) : 0;
        let s1 = st[0];
        let s2 = st[1];
        let s3 = st[2];
        let s4 = st[3];
        for (let n = 0; n < N; n++) {
          if (ffm !== 0) {
            const g = g0 * Math.exp(ffm * modBuf[n]);
            G = g / (1 + g);
          }
          const G2 = G * G;
          const G3 = G2 * G;
          const G4 = G3 * G;
          const omG = 1 - G;
          const S = omG * (G3 * s1 + G2 * s2 + G * s3 + s4);
          const xin = buf[n] * drive * 0.5;
          let y4 = (G4 * xin + S) / (1 + kq * G4);
          const u = acid ? ftanh(xin - kq * y4 + bias) - biasOff : ftanh(xin - kq * y4);
          let t = (u - s1) * G;
          const y1 = t + s1;
          s1 = y1 + t;
          t = (y1 - s2) * G;
          const y2 = t + s2;
          s2 = y2 + t;
          t = (y2 - s3) * G;
          const y3 = t + s3;
          s3 = y3 + t;
          t = (y3 - s4) * G;
          y4 = t + s4;
          s4 = y4 + t;
          buf[n] = y4 * comp * 2;
        }
        st[0] = s1;
        st[1] = s2;
        st[2] = s3;
        st[3] = s4;
        break;
      }
      case 10: {
        // Comb: the delay is one period of the "Pitch" frequency.
        const cbuf = v.comb[j];
        let w = v.combIdx[j];
        const fb = res * 0.985;
        const lpC = 1 - bk * 0.92;
        let lp = st[0];
        const D0 = sr / fc;
        const gain = 1 - fb * 0.5;
        for (let n = 0; n < N; n++) {
          let D = ffm !== 0 ? D0 * Math.exp(-ffm * modBuf[n]) : D0;
          if (D < 2) D = 2;
          else if (D > COMB_SIZE - 4) D = COMB_SIZE - 4;
          const rp = w - D;
          const ri = Math.floor(rp);
          const fr = rp - ri;
          const a = cbuf[ri & COMB_MASK];
          const dl = a + (cbuf[(ri + 1) & COMB_MASK] - a) * fr;
          lp += (dl - lp) * lpC;
          let y = buf[n] + fb * lp;
          if (y > 4) y = 4;
          else if (y < -4) y = -4;
          cbuf[w & COMB_MASK] = y;
          w = (w + 1) & COMB_MASK;
          buf[n] = y * gain;
        }
        v.combIdx[j] = w;
        st[0] = lp;
        break;
      }
      case 11: {
        // Phaser: four first-order allpasses spread around the cutoff, with feedback.
        const fb = res * 0.92;
        const a = [0, 0, 0, 0];
        for (let s = 0; s < 4; s++) {
          let f = fc * Math.pow(2, (s - 1.5) * bk * 1.5);
          if (f > fmax) f = fmax;
          const t = Math.tan((Math.PI * f) / sr);
          a[s] = (t - 1) / (t + 1);
        }
        let z0 = st[0];
        let z1 = st[1];
        let z2 = st[2];
        let z3 = st[3];
        let last = st[4];
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          let xin = x + fb * last;
          let y = a[0] * xin + z0;
          z0 = xin - a[0] * y;
          xin = y;
          y = a[1] * xin + z1;
          z1 = xin - a[1] * y;
          xin = y;
          y = a[2] * xin + z2;
          z2 = xin - a[2] * y;
          xin = y;
          y = a[3] * xin + z3;
          z3 = xin - a[3] * y;
          last = ftanh(y);
          buf[n] = 0.5 * (x + y);
        }
        st[0] = z0;
        st[1] = z1;
        st[2] = z2;
        st[3] = z3;
        st[4] = last;
        break;
      }
      case 12: {
        // Double notch: two notches spread around the cutoff.
        const spread = bk * 1.5;
        let f1 = fc * Math.pow(2, -spread);
        let f2 = fc * Math.pow(2, spread);
        if (f2 > fmax) f2 = fmax;
        if (f1 < 8) f1 = 8;
        const k = 0.1 + res * 2.5;
        const gA = Math.tan((Math.PI * f1) / sr);
        const gB = Math.tan((Math.PI * f2) / sr);
        const a1 = 1 / (1 + gA * (gA + k));
        const a2 = gA * a1;
        const a3 = gA * a2;
        const b1 = 1 / (1 + gB * (gB + k));
        const b2 = gB * b1;
        const b3 = gB * b2;
        let s0 = st[0];
        let s1 = st[1];
        let s2 = st[2];
        let s3 = st[3];
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          let v3 = x - s1;
          let v1 = a1 * s0 + a2 * v3;
          let v2 = s1 + a2 * s0 + a3 * v3;
          s0 = 2 * v1 - s0;
          s1 = 2 * v2 - s1;
          const y1 = x - k * v1;
          v3 = y1 - s3;
          v1 = b1 * s2 + b2 * v3;
          v2 = s3 + b2 * s2 + b3 * v3;
          s2 = 2 * v1 - s2;
          s3 = 2 * v2 - s3;
          buf[n] = y1 - k * v1;
        }
        st[0] = s0;
        st[1] = s1;
        st[2] = s2;
        st[3] = s3;
        break;
      }
      case 13: {
        // Formant: three parallel bandpasses tuned to a morphing vowel.
        const pos = cutN * (VOWELS.length - 1);
        const ia = Math.floor(pos);
        const ib = Math.min(VOWELS.length - 1, ia + 1);
        const fr = pos - ia;
        const shift = Math.pow(2, (bk - 0.5) * 2);
        const k = Math.max(0.04, 0.32 - res * 0.27);
        const gains = [1, 0.7, 0.45];
        const coef = [];
        for (let q = 0; q < 3; q++) {
          let f = (VOWELS[ia][q] + (VOWELS[ib][q] - VOWELS[ia][q]) * fr) * shift;
          if (f > fmax) f = fmax;
          const g = Math.tan((Math.PI * f) / sr);
          const c1 = 1 / (1 + g * (g + k));
          coef.push(c1, g * c1, g * g * c1);
        }
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          let y = 0;
          for (let q = 0; q < 3; q++) {
            const c1 = coef[q * 3];
            const c2 = coef[q * 3 + 1];
            const c3 = coef[q * 3 + 2];
            const i1 = st[q * 2];
            const i2 = st[q * 2 + 1];
            const v3 = x - i2;
            const v1 = c1 * i1 + c2 * v3;
            const v2 = i2 + c2 * i1 + c3 * v3;
            st[q * 2] = 2 * v1 - i1;
            st[q * 2 + 1] = 2 * v2 - i2;
            y += v1 * k * gains[q];
          }
          buf[n] = y * 2.2;
        }
        break;
      }
      default:
        break;
    }
  }

  processInsert(v, k, buf, N, noteHz) {
    const type = this.insType[k];
    if (!type || !this.insOn[k]) return;
    const p = v.p;
    const wet = p[this.I.insA[k]];
    const b = p[this.I.insB[k]];
    const dry = 1 - wet;
    const st = v.is[k];
    const sr = this.sr;
    switch (type) {
      case 1: {
        const dbuf = v.ibuf[k];
        let w = v.iIdx[k];
        let D = 0.0002 * Math.pow(250, b) * sr;
        if (D < 2) D = 2;
        if (D > COMB_SIZE - 4) D = COMB_SIZE - 4;
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          const rp = w - D;
          const ri = Math.floor(rp);
          const fr = rp - ri;
          const a = dbuf[ri & COMB_MASK];
          const dl = a + (dbuf[(ri + 1) & COMB_MASK] - a) * fr;
          dbuf[w & COMB_MASK] = x + dl * 0.4;
          w = (w + 1) & COMB_MASK;
          buf[n] = dry * x + wet * dl;
        }
        v.iIdx[k] = w;
        break;
      }
      case 2: {
        const drive = 1 + b * 24;
        const comp = 1 / Math.pow(drive, 0.3);
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          let c = x * drive;
          c = c > 1 ? 1 : c < -1 ? -1 : c;
          buf[n] = dry * x + wet * c * comp;
        }
        break;
      }
      case 3: {
        const drive = 0.5 + b * 5;
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          buf[n] = dry * x + wet * fsin(0.25 * x * drive);
        }
        break;
      }
      case 4: {
        const bits = 16 - b * 14;
        const q = Math.pow(2, bits - 1);
        const hold = 1 + Math.floor(b * b * 24);
        let cnt = st[0];
        let held = st[1];
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          if (cnt <= 0) {
            held = Math.round(x * q) / q;
            cnt = hold;
          }
          cnt--;
          buf[n] = dry * x + wet * held;
        }
        st[0] = cnt;
        st[1] = held;
        break;
      }
      case 5: {
        // Frequency shifter: Hilbert pair, then single-sideband shift relative to the note.
        const shift = (b - 0.5) * 2 * noteHz;
        const inc = shift / sr;
        let ph = st[40];
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          let ya = x;
          for (let s = 0; s < 4; s++) {
            const o = s * 4;
            const y = HILBERT_A[s] * (ya + st[o + 3]) - st[o + 1];
            st[o + 1] = st[o];
            st[o] = ya;
            st[o + 3] = st[o + 2];
            st[o + 2] = y;
            ya = y;
          }
          let yb = x;
          for (let s = 0; s < 4; s++) {
            const o = 16 + s * 4;
            const y = HILBERT_B[s] * (yb + st[o + 3]) - st[o + 1];
            st[o + 1] = st[o];
            st[o] = yb;
            st[o + 3] = st[o + 2];
            st[o + 2] = y;
            yb = y;
          }
          const im = st[32];
          st[32] = yb;
          const out = ya * fsin(ph + 0.25) + im * fsin(ph);
          ph += inc;
          ph -= Math.floor(ph);
          buf[n] = dry * x + wet * out;
        }
        st[40] = ph;
        break;
      }
      case 6: {
        const inc = (noteHz * Math.pow(2, (b - 0.5) * 4)) / sr;
        let ph = st[0];
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          buf[n] = dry * x + wet * x * fsin(ph);
          ph += inc;
          ph -= Math.floor(ph);
        }
        st[0] = ph;
        break;
      }
      case 7: {
        const rate = noteHz * Math.pow(2, (b - 0.5) * 6);
        const period = Math.max(1, sr / Math.max(1, rate));
        let cnt = st[0];
        let held = st[1];
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          cnt -= 1;
          if (cnt <= 0) {
            held = x;
            cnt += period;
          }
          buf[n] = dry * x + wet * held;
        }
        st[0] = cnt;
        st[1] = held;
        break;
      }
      case 8: {
        const c = 1 - Math.exp((-TAU * 800) / sr);
        const t = (b - 0.5) * 1.8;
        let z = st[0];
        for (let n = 0; n < N; n++) {
          const x = buf[n];
          z += (x - z) * c;
          const y = z * (1 - t) + (x - z) * (1 + t);
          buf[n] = dry * x + wet * y;
        }
        st[0] = z;
        break;
      }
      default:
        break;
    }
  }

  audioVoice(v, off, N) {
    const p = v.p;
    const I = this.I;
    const busL = this.busL;
    const busR = this.busR;
    const noteHz = 440 * Math.pow(2, (v.curNote - 69 + p[I.tune]) / 12);
    const modOn = this.modOscOn && (this.ringT || this.phaseT || this.posT || this.ffmT) && p[I.mRm] > 0;
    if (modOn) {
      const incM = (noteHz * Math.pow(2, p[I.mPitch] / 12)) / this.sr;
      let mp = v.modPhase;
      const mb = this.modBuf;
      for (let k = 0; k < N; k++) {
        mb[k] = fsin(mp);
        mp += incM;
        if (mp >= 1) mp -= Math.floor(mp);
      }
      v.modPhase = mp;
    }
    const in1 = this.in1;
    const in2 = this.in2;
    in1.fill(0, 0, N);
    in2.fill(0, 0, N);
    const ob = this.oscBuf;
    for (let i = 0; i < 3; i++) {
      if (!this.oscOn[i]) continue;
      const amp = p[I.oAmp[i]];
      if (amp < 0.00001) {
        // Keep phase moving so a later fade-in stays coherent.
        continue;
      }
      this.renderOsc(v, i, ob, N, modOn);
      const r = p[I.oRoute[i]];
      const g1 = amp * (1 - r);
      const g2 = amp * r;
      for (let k = 0; k < N; k++) {
        const s = ob[k];
        in1[k] += s * g1;
        in2[k] += s * g2;
      }
    }
    if (this.noiseOn && p[I.nAmp] > 0.00001) {
      const nb = this.noiseBuf;
      this.renderNoise(v, nb, N);
      const amp = p[I.nAmp];
      const r = p[I.nRoute];
      const g1 = amp * (1 - r);
      const g2 = amp * r;
      for (let k = 0; k < N; k++) {
        in1[k] += nb[k] * g1;
        in2[k] += nb[k] * g2;
      }
    }
    if (this.fbOn && p[I.fbAmp] > 0.0001) {
      const fa = p[I.fbAmp] * 1.4;
      const r = p[I.fbRoute];
      const fbb = v.fbBuf;
      for (let k = 0; k < N; k++) {
        const f = fbb[k] * fa;
        in1[k] += f * (1 - r);
        in2[k] += f * r;
      }
    }
    for (let q = 0; q < 2; q++) if (this.insPos[q] === 0) this.processInsert(v, q, in1, N, noteHz);
    const out1 = this.out1;
    const out2 = this.out2;
    for (let k = 0; k < N; k++) out1[k] = in1[k];
    this.processFilter(v, 0, out1, N, modOn);
    const ser = 1 - p[I.serpar];
    if (ser > 0.0001) for (let k = 0; k < N; k++) in2[k] += out1[k] * ser;
    for (let q = 0; q < 2; q++) if (this.insPos[q] === 1) this.processInsert(v, q, in2, N, noteHz);
    for (let k = 0; k < N; k++) out2[k] = in2[k];
    this.processFilter(v, 1, out2, N, modOn);
    const mix = p[I.mix];
    const mb = this.mixBuf;
    for (let k = 0; k < N; k++) mb[k] = out1[k] * (1 - mix) + out2[k] * mix;
    for (let q = 0; q < 2; q++) if (this.insPos[q] === 2) this.processInsert(v, q, mb, N, noteHz);
    if (this.fbOn) {
      const tap = this.fbTap === 0 ? out1 : this.fbTap === 1 ? out2 : mb;
      const fbb = v.fbBuf;
      for (let k = 0; k < N; k++) fbb[k] = ftanh(tap[k]);
    }
    // Amp: Env 4 (with its velocity sensitivity) × Amp Mod, interpolated per sample.
    const vs = p[I.eVel[3]];
    const env4 = v.envLevel[3] * (1 - vs + vs * v.vel);
    const target = env4 * p[I.ampMod] * 0.5;
    let pan = p[I.pan] + v.panOff;
    pan = pan < -1 ? -1 : pan > 1 ? 1 : pan;
    const th = (pan + 1) * (Math.PI / 4);
    const gl = Math.cos(th) * 1.4142;
    const gr = Math.sin(th) * 1.4142;
    const a0 = v.ampPrev;
    const da = (target - a0) / N;
    const l0 = v.glPrev;
    const r0 = v.grPrev;
    const dl = (gl - l0) / N;
    const dr = (gr - r0) / N;
    for (let k = 0; k < N; k++) {
      const a = a0 + da * (k + 1);
      const s = mb[k] * a;
      busL[off + k] += s * (l0 + dl * (k + 1));
      busR[off + k] += s * (r0 + dr * (k + 1));
    }
    v.ampPrev = target;
    v.glPrev = gl;
    v.grPrev = gr;
    if (!Number.isFinite(mb[N - 1]) || !Number.isFinite(v.fs[0][0]) || !Number.isFinite(v.fs[1][0])) {
      // A filter blew up (extreme settings): silence this voice instead of the whole synth.
      for (let k = 0; k < N; k++) {
        busL[off + k] = Number.isFinite(busL[off + k]) ? busL[off + k] : 0;
        busR[off + k] = Number.isFinite(busR[off + k]) ? busR[off + k] : 0;
      }
      v.resetDsp();
      v.active = false;
      this.faults++;
      return;
    }
    if (v.envStage[3] === 0) {
      v.active = false;
      v.gate = false;
    }
  }

  renderVoices(off, len) {
    const dt = len * this.invSr;
    this.advanceGlobalSlots(dt);
    const voices = this.voices;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (!v.active) continue;
      this.controlVoice(v, len);
      this.audioVoice(v, off, len);
    }
  }

  /* ------------------------------------------------------- master FX */

  newFxState() {
    return {
      z: new Float64Array(64),
      bufL: null,
      bufR: null,
      size: 0,
      w: 0,
      lfo: 0,
      env: 0,
      combs: null,
      aps: null,
    };
  }

  resetFx(m) {
    const s = this.fxState[m];
    s.z.fill(0);
    s.w = 0;
    s.lfo = 0;
    s.env = 0;
    if (s.bufL) s.bufL.fill(0);
    if (s.bufR) s.bufR.fill(0);
    if (s.combs) for (const c of s.combs) c.buf.fill(0);
    if (s.aps) for (const c of s.aps) c.buf.fill(0);
  }

  ensureFxBuffer(s, seconds) {
    let size = 1;
    const need = Math.ceil(seconds * this.sr) + 4;
    while (size < need) size <<= 1;
    if (!s.bufL || s.size < size) {
      s.bufL = new Float32Array(size);
      s.bufR = new Float32Array(size);
      s.size = size;
      s.w = 0;
    }
  }

  ensureReverb(s) {
    if (s.combs) return;
    const scale = this.sr / 44100;
    const combLens = [1116, 1188, 1277, 1356];
    const apLens = [556, 441];
    s.combs = [];
    s.aps = [];
    for (let ch = 0; ch < 2; ch++) {
      for (const l of combLens) {
        const n = Math.max(8, Math.round((l + ch * 23) * scale));
        s.combs.push({ buf: new Float32Array(n), i: 0, lp: 0 });
      }
      for (const l of apLens) {
        const n = Math.max(8, Math.round((l + ch * 23) * scale));
        s.aps.push({ buf: new Float32Array(n), i: 0 });
      }
    }
  }

  processFx(m, L, R, n) {
    const type = this.fxType[m];
    if (!type || !this.fxOn[m]) return;
    const gp = this.gp;
    const I = this.I;
    const wet = gp[I.fxA[m]];
    const dry = 1 - wet;
    const b = gp[I.fxB[m]];
    const c = gp[I.fxC[m]];
    const s = this.fxState[m];
    const z = s.z;
    const sr = this.sr;
    switch (type) {
      case 1: {
        const drive = 1 + b * 18;
        const bias = 0.12;
        const off = ftanh(bias);
        const comp = 1 / (1 + drive * 0.12);
        const tc = 1 - Math.exp((-TAU * (1000 * Math.pow(18, c))) / sr);
        for (let k = 0; k < n; k++) {
          const yl = (ftanh(L[k] * drive + bias) - off) * comp;
          const yr = (ftanh(R[k] * drive + bias) - off) * comp;
          z[0] += (yl - z[0]) * tc;
          z[1] += (yr - z[1]) * tc;
          L[k] = dry * L[k] + wet * z[0] * 1.6;
          R[k] = dry * R[k] + wet * z[1] * 1.6;
        }
        break;
      }
      case 2:
      case 3:
      case 7: {
        this.ensureFxBuffer(s, 0.06);
        const bl = s.bufL;
        const br = s.bufR;
        const mask = s.size - 1;
        let w = s.w;
        let lfo = s.lfo;
        let base;
        let depth;
        let rate;
        let fb = 0;
        if (type === 2) {
          base = 0.012;
          depth = 0.0015 + b * 0.006;
          rate = 0.08 + c * 2.5;
        } else if (type === 3) {
          base = 0.0012;
          depth = 0.0035;
          rate = 0.03 + b * 1.6;
          fb = c * 0.88;
        } else {
          base = 0.006 + b * 0.022;
          depth = 0.0008;
          rate = 0.18;
        }
        const width = type === 7 ? c : 1;
        const inc = rate / sr;
        for (let k = 0; k < n; k++) {
          const xl = L[k];
          const xr = R[k];
          const m1 = fsin(lfo);
          const m2 = fsin(lfo + 0.25);
          const dL = (base + depth * (0.5 + 0.5 * m1)) * sr;
          const dR = (base * (type === 7 ? 1.37 : 1) + depth * (0.5 + 0.5 * m2)) * sr;
          let rp = w - dL;
          let ri = Math.floor(rp);
          let fr = rp - ri;
          let a = bl[ri & mask];
          const tl = a + (bl[(ri + 1) & mask] - a) * fr;
          rp = w - dR;
          ri = Math.floor(rp);
          fr = rp - ri;
          a = br[ri & mask];
          const tr = a + (br[(ri + 1) & mask] - a) * fr;
          bl[w] = xl + tl * fb;
          br[w] = xr + tr * fb;
          w = (w + 1) & mask;
          lfo += inc;
          if (lfo >= 1) lfo -= 1;
          if (type === 7) {
            L[k] = dry * xl + wet * (xl + (tr - xl) * width * 0.8);
            R[k] = dry * xr + wet * (xr + (tl - xr) * width * 0.8);
          } else {
            L[k] = dry * xl + wet * tl;
            R[k] = dry * xr + wet * tr;
          }
        }
        s.w = w;
        s.lfo = lfo;
        break;
      }
      case 4: {
        // Phaser: six allpasses per side swept by a slow LFO, with feedback.
        const rate = 0.02 + b * 3;
        const fb = c * 0.85;
        const inc = rate / sr;
        let lfo = s.lfo;
        for (let k0 = 0; k0 < n; k0 += 16) {
          const k1 = Math.min(n, k0 + 16);
          const sweepL = 0.5 + 0.5 * fsin(lfo);
          const sweepR = 0.5 + 0.5 * fsin(lfo + 0.2);
          const fl = Math.min(sr * 0.45, 180 * Math.pow(2, sweepL * 4.5));
          const fr = Math.min(sr * 0.45, 180 * Math.pow(2, sweepR * 4.5));
          const tL = Math.tan((Math.PI * fl) / sr);
          const tR = Math.tan((Math.PI * fr) / sr);
          const aL = (tL - 1) / (tL + 1);
          const aR = (tR - 1) / (tR + 1);
          for (let k = k0; k < k1; k++) {
            let xl = L[k] + fb * z[12];
            let xr = R[k] + fb * z[13];
            for (let q = 0; q < 6; q++) {
              const yl = aL * xl + z[q];
              z[q] = xl - aL * yl;
              xl = yl;
              const yr = aR * xr + z[6 + q];
              z[6 + q] = xr - aR * yr;
              xr = yr;
            }
            z[12] = ftanh(xl);
            z[13] = ftanh(xr);
            L[k] = dry * L[k] + wet * 0.5 * (L[k] + xl);
            R[k] = dry * R[k] + wet * 0.5 * (R[k] + xr);
          }
          lfo += inc * (k1 - k0);
          lfo -= Math.floor(lfo);
        }
        s.lfo = lfo;
        break;
      }
      case 5: {
        this.ensureFxBuffer(s, 4.2);
        const bl = s.bufL;
        const br = s.bufR;
        const mask = s.size - 1;
        const spb = 60 / this.bpm;
        const dL = Math.min(s.size - 4, DELAY_BEATS[this.fxDivL[m]] * spb * sr);
        const dR = Math.min(s.size - 4, DELAY_BEATS[this.fxDivR[m]] * spb * sr);
        const fb = c * 0.95;
        const lpc = 1 - b * 0.9;
        let w = s.w;
        for (let k = 0; k < n; k++) {
          let rp = w - dL;
          let ri = Math.floor(rp);
          let fr = rp - ri;
          let a = bl[ri & mask];
          const tl = a + (bl[(ri + 1) & mask] - a) * fr;
          rp = w - dR;
          ri = Math.floor(rp);
          fr = rp - ri;
          a = br[ri & mask];
          const tr = a + (br[(ri + 1) & mask] - a) * fr;
          z[0] += (tl - z[0]) * lpc;
          z[1] += (tr - z[1]) * lpc;
          bl[w] = L[k] + z[0] * fb;
          br[w] = R[k] + z[1] * fb;
          w = (w + 1) & mask;
          L[k] = dry * L[k] + wet * tl;
          R[k] = dry * R[k] + wet * tr;
        }
        s.w = w;
        break;
      }
      case 6: {
        this.ensureReverb(s);
        const room = 0.7 + b * 0.28;
        const damp = c * 0.6;
        const combs = s.combs;
        const aps = s.aps;
        for (let k = 0; k < n; k++) {
          const input = (L[k] + R[k]) * 0.12;
          for (let ch = 0; ch < 2; ch++) {
            let acc = 0;
            for (let q = 0; q < 4; q++) {
              const cb = combs[ch * 4 + q];
              const y = cb.buf[cb.i];
              cb.lp = y * (1 - damp) + cb.lp * damp;
              cb.buf[cb.i] = input + cb.lp * room;
              cb.i = cb.i + 1 >= cb.buf.length ? 0 : cb.i + 1;
              acc += y;
            }
            for (let q = 0; q < 2; q++) {
              const ap = aps[ch * 2 + q];
              const bo = ap.buf[ap.i];
              const y = bo - acc;
              ap.buf[ap.i] = acc + bo * 0.5;
              ap.i = ap.i + 1 >= ap.buf.length ? 0 : ap.i + 1;
              acc = y;
            }
            if (ch === 0) L[k] = dry * L[k] + wet * acc;
            else R[k] = dry * R[k] + wet * acc;
          }
        }
        break;
      }
      case 8: {
        const thr = Math.pow(10, (-b * 36) / 20);
        const ratio = 4;
        const att = 1 - Math.exp(-1 / (0.004 * sr));
        const rel = 1 - Math.exp(-1 / ((0.02 + c * 0.8) * sr));
        const makeup = Math.pow(10, ((b * 36 * (1 - 1 / ratio)) / 20) * 0.6);
        let env = s.env;
        for (let k = 0; k < n; k++) {
          const lvl = Math.max(Math.abs(L[k]), Math.abs(R[k]));
          env += (lvl - env) * (lvl > env ? att : rel);
          let g = 1;
          if (env > thr) g = Math.pow(env / thr, 1 / ratio - 1);
          g *= makeup;
          L[k] = dry * L[k] + wet * L[k] * g;
          R[k] = dry * R[k] + wet * R[k] * g;
        }
        s.env = env;
        break;
      }
      case 9: {
        const q = Math.pow(2, 15 - b * 13);
        const hold = 1 + Math.floor(c * c * 31);
        let cnt = z[0];
        for (let k = 0; k < n; k++) {
          if (cnt <= 0) {
            z[1] = Math.round(L[k] * q) / q;
            z[2] = Math.round(R[k] * q) / q;
            cnt = hold;
          }
          cnt--;
          L[k] = dry * L[k] + wet * z[1];
          R[k] = dry * R[k] + wet * z[2];
        }
        z[0] = cnt;
        break;
      }
      default:
        break;
    }
  }

  updateEq() {
    const gp = this.gp;
    const I = this.I;
    const lo = gp[I.eqLow];
    const mid = gp[I.eqMid];
    const mf = gp[I.eqMidF];
    const hi = gp[I.eqHigh];
    const key = `${lo.toFixed(2)}|${mid.toFixed(2)}|${mf.toFixed(0)}|${hi.toFixed(2)}`;
    if (key === this.eqKey) return;
    this.eqKey = key;
    const sr = this.sr;
    const c = this.eqCoef;
    const shelf = (f, db, high, o) => {
      const A = Math.pow(10, db / 40);
      const w0 = (TAU * f) / sr;
      const cs = Math.cos(w0);
      const sn = Math.sin(w0);
      const alpha = (sn / 2) * Math.SQRT2;
      const sq = 2 * Math.sqrt(A) * alpha;
      let b0;
      let b1;
      let b2;
      let a0;
      let a1;
      let a2;
      if (!high) {
        b0 = A * (A + 1 - (A - 1) * cs + sq);
        b1 = 2 * A * (A - 1 - (A + 1) * cs);
        b2 = A * (A + 1 - (A - 1) * cs - sq);
        a0 = A + 1 + (A - 1) * cs + sq;
        a1 = -2 * (A - 1 + (A + 1) * cs);
        a2 = A + 1 + (A - 1) * cs - sq;
      } else {
        b0 = A * (A + 1 + (A - 1) * cs + sq);
        b1 = -2 * A * (A - 1 + (A + 1) * cs);
        b2 = A * (A + 1 + (A - 1) * cs - sq);
        a0 = A + 1 - (A - 1) * cs + sq;
        a1 = 2 * (A - 1 - (A + 1) * cs);
        a2 = A + 1 - (A - 1) * cs - sq;
      }
      c[o] = b0 / a0;
      c[o + 1] = b1 / a0;
      c[o + 2] = b2 / a0;
      c[o + 3] = a1 / a0;
      c[o + 4] = a2 / a0;
    };
    shelf(120, lo, false, 0);
    {
      const A = Math.pow(10, mid / 40);
      const w0 = (TAU * Math.min(mf, sr * 0.45)) / sr;
      const cs = Math.cos(w0);
      const alpha = Math.sin(w0) / (2 * 0.9);
      const a0 = 1 + alpha / A;
      c[5] = (1 + alpha * A) / a0;
      c[6] = (-2 * cs) / a0;
      c[7] = (1 - alpha * A) / a0;
      c[8] = (-2 * cs) / a0;
      c[9] = (1 - alpha / A) / a0;
    }
    shelf(Math.min(6000, sr * 0.4), hi, true, 10);
  }

  processEq(L, R, n) {
    this.updateEq();
    const c = this.eqCoef;
    const z = this.eqState;
    for (let band = 0; band < 3; band++) {
      const o = band * 5;
      const b0 = c[o];
      const b1 = c[o + 1];
      const b2 = c[o + 2];
      const a1 = c[o + 3];
      const a2 = c[o + 4];
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch === 0 ? L : R;
        const zo = band * 8 + ch * 4;
        let x1 = z[zo];
        let x2 = z[zo + 1];
        let y1 = z[zo + 2];
        let y2 = z[zo + 3];
        for (let k = 0; k < n; k++) {
          const x = buf[k];
          const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1;
          x1 = x;
          y2 = y1;
          y1 = y;
          buf[k] = y;
        }
        z[zo] = x1;
        z[zo + 1] = x2;
        z[zo + 2] = y1;
        z[zo + 3] = y2;
      }
    }
  }

  processMaster(outL, outR, n) {
    this.updateGlobalParams();
    const gp = this.gp;
    const I = this.I;
    const busL = this.busL;
    const busR = this.busR;
    const fxL = this.fxL;
    const fxR = this.fxR;
    const byp = this.bypOn ? gp[I.byp] : 0;
    const keep = 1 - byp;
    for (let k = 0; k < n; k++) {
      fxL[k] = busL[k] * keep;
      fxR[k] = busR[k] * keep;
    }
    this.processFx(0, fxL, fxR, n);
    this.processFx(1, fxL, fxR, n);
    for (let k = 0; k < n; k++) {
      fxL[k] += busL[k] * byp;
      fxR[k] += busR[k] * byp;
    }
    if (this.eqOn) this.processEq(fxL, fxR, n);
    const mv = this.base[I.master];
    const g = mv * mv * 2.04;
    let pl = this.peakL;
    let pr = this.peakR;
    for (let k = 0; k < n; k++) {
      let l = fxL[k] * g;
      let r = fxR[k] * g;
      if (!(l === l) || !(r === r)) {
        // NaN anywhere: reset the FX and output silence for this sample.
        l = 0;
        r = 0;
        this.faults++;
        this.resetFx(0);
        this.resetFx(1);
        this.eqState.fill(0);
      }
      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > 0.9) l = (l > 0 ? 1 : -1) * (0.9 + 0.1 * ftanh((al - 0.9) * 10));
      if (ar > 0.9) r = (r > 0 ? 1 : -1) * (0.9 + 0.1 * ftanh((ar - 0.9) * 10));
      outL[k] = l;
      outR[k] = r;
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
    }
    this.peakL = pl;
    this.peakR = pr;
  }

  /* ------------------------------------------------------------ render */

  render(outL, outR, n, frame) {
    const t0 = Date.now();
    if (typeof frame === "number") this.frame = frame;
    // Idle fast path: no voices and nothing scheduled for 6 s (longer than any
    // FX tail) → write silence without running the voice loop or the effects.
    let busy = this.events.length > 0 && this.events[0].frame < this.frame + n + this.sr;
    if (!busy) for (let i = 0; i < this.voices.length && !busy; i++) busy = this.voices[i].active;
    this.idleFrames = busy ? 0 : (this.idleFrames || 0) + n;
    if (this.idleFrames > this.sr * 6) {
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      this.frame += n;
      this.tickStatus(n, Date.now() - t0);
      return;
    }
    this.ensureBus(n);
    this.busL.fill(0, 0, n);
    this.busR.fill(0, 0, n);
    let pos = 0;
    while (pos < n) {
      const abs = this.frame + pos;
      while (this.events.length && this.events[0].frame <= abs) this.applyEvent(this.events.shift());
      let segEnd = n;
      if (this.events.length) {
        const nf = this.events[0].frame - this.frame;
        if (nf < segEnd) segEnd = Math.max(pos + 1, nf);
      }
      while (pos < segEnd) {
        const len = Math.min(this.CB, segEnd - pos);
        this.renderVoices(pos, len);
        pos += len;
      }
    }
    this.processMaster(outL, outR, n);
    this.frame += n;
    this.tickStatus(n, Date.now() - t0);
  }

  tickStatus(n, busyMs) {
    this.cpuBusy += busyMs;
    this.cpuFrames += n;
    this.statusCount += n;
    if (this.statusCount >= this.statusEvery) {
      this.statusCount = 0;
      const wallMs = (this.cpuFrames / this.sr) * 1000;
      if (wallMs >= 400) {
        this.cpu = Math.min(1, this.cpuBusy / wallMs);
        this.cpuBusy = 0;
        this.cpuFrames = 0;
      }
      if (this.meter && this.post) this.post(this.status());
      this.peakL *= 0.5;
      this.peakR *= 0.5;
    }
  }

  status() {
    const lv = this.lastVoice && this.lastVoice.active ? this.lastVoice : null;
    const mod = [];
    if (lv) for (let k = 0; k < this.modParams.length; k++) mod.push(this.modParams[k], lv.norm[this.modParams[k]]);
    for (let k = 0; k < this.gModParams.length; k++) mod.push(this.gModParams[k], this.gnorm[this.gModParams[k]]);
    return {
      type: "status",
      voices: this.activeCount(),
      cpu: this.cpu,
      peakL: this.peakL,
      peakR: this.peakR,
      faults: this.faults,
      mod,
      env: lv ? Array.from(lv.envLevel) : [0, 0, 0, 0],
      slots: lv ? Array.from(lv.src.subarray(4, 8)) : Array.from(this.gOut),
    };
  }
}

/* -------------------------------------------------------- worklet glue */

if (typeof AudioWorkletProcessor === "function" && typeof registerProcessor === "function") {
  class MammothProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const o = (options && options.processorOptions) || {};
      this.engine = new MammothEngine(sampleRate, o);
      this.alive = true;
      this.engine.post = (msg) => this.port.postMessage(msg);
      this.port.onmessage = (event) => {
        const msg = event.data;
        if (msg && msg.type === "dispose") {
          this.alive = false;
          return;
        }
        this.engine.message(msg);
      };
      this.port.postMessage({ type: "ready" });
    }

    process(inputs, outputs) {
      const out = outputs[0];
      if (!out || out.length === 0) return this.alive;
      const L = out[0];
      const R = out.length > 1 ? out[1] : null;
      if (R) this.engine.render(L, R, L.length, currentFrame);
      else {
        const tmp = this.tmpR && this.tmpR.length === L.length ? this.tmpR : (this.tmpR = new Float32Array(L.length));
        this.engine.render(L, tmp, L.length, currentFrame);
        for (let k = 0; k < L.length; k++) L[k] = 0.5 * (L[k] + tmp[k]);
      }
      return this.alive;
    }
  }
  registerProcessor("mammoth-synth", MammothProcessor);
}

// Worklet scripts are ES modules, so the engine can also be imported on the main
// thread (offline fallback renderer) and by the Node tests.
export { MammothEngine };
