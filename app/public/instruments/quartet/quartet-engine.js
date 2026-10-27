/**
 * Quartet's sound: built from the browser's own audio nodes, so it plays live on
 * every browser the studio supports (no AudioWorklet needed) and renders offline
 * with exactly the same graph.
 *
 * One note (a voice):
 *   4 oscillators (each with 1–4 detuned unison copies, panned) → mix
 *   → filter (cutoff follows the key and its own envelope) → amp envelope
 *   → tremolo → pan → instrument output
 * The LFO restarts with every note and moves pitch, cutoff, level or pan.
 *
 * Envelopes: a straight attack, then an exponential fall to the sustain level, and an
 * exponential release. Releases are worked out from the envelope's known shape, so they
 * glide from wherever the note is (older Safari has no cancelAndHoldAtTime).
 */
import { sanitizePatch } from "./params.js?v=1";

const noiseBuffers = new WeakMap();

/** Two seconds of white noise from a fixed seed: renders come out the same every time. */
function noiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const len = Math.round(ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
const dbGain = (db) => Math.pow(10, db / 20);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Envelope level at time t (seconds) for a note that started at t0. */
function envAt(e, floor, peak, sus, t0, t) {
  const A = Math.max(0.001, e.a);
  if (t <= t0) return floor;
  if (t < t0 + A) return floor + (peak - floor) * ((t - t0) / A);
  return sus + (peak - sus) * Math.exp(-(t - t0 - A) / (Math.max(0.005, e.d) / 4));
}

function envStart(param, e, floor, peak, sus, t0) {
  const A = Math.max(0.001, e.a);
  param.setValueAtTime(floor, t0);
  param.linearRampToValueAtTime(peak, t0 + A);
  param.setTargetAtTime(sus, t0 + A, Math.max(0.005, e.d) / 4);
}

function envRelease(param, e, floor, peak, sus, t0, tOff) {
  const v = envAt(e, floor, peak, sus, t0, tOff);
  param.cancelScheduledValues(tOff);
  // Let go during the attack: the ramp is cut short where it is; afterwards: hold, then fall.
  if (tOff < t0 + Math.max(0.001, e.a)) param.linearRampToValueAtTime(v, tOff);
  else param.setValueAtTime(v, tOff);
  param.setTargetAtTime(floor, tOff, Math.max(0.005, e.r) / 6);
}

/**
 * Starts one note at ctx time t0 into `out`. Returns { release(t), stopAt, onEnded }.
 * `light` thins unison on slower devices.
 */
function startVoice(ctx, out, p, note, vel, t0, light) {
  const sources = [];
  const nyquist = ctx.sampleRate / 2 - 200;

  const voicePan = ctx.createStereoPanner();
  voicePan.connect(out);
  const trem = ctx.createGain();
  trem.connect(voicePan);
  const amp = ctx.createGain();
  amp.gain.value = 0;
  amp.connect(trem);
  const filter = ctx.createBiquadFilter();
  filter.type = p.filter.type;
  filter.Q.value = p.filter.reso;
  filter.connect(amp);

  // Oscillators
  const detuneParams = [];
  const active = p.oscs.filter((o) => o.on && o.level > 0);
  for (const o of active) {
    const n = light ? Math.min(2, o.unison) : o.unison;
    const oscGain = ctx.createGain();
    oscGain.gain.value = o.level / Math.sqrt(n);
    oscGain.connect(filter);
    const freq = clamp(midiHz(note + o.octave * 12 + o.semi), 1, nyquist);
    for (let u = 0; u < n; u++) {
      const spreadPos = n > 1 ? (u / (n - 1)) * 2 - 1 : 0;
      let src;
      if (o.wave === "noise") {
        src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx);
        src.loop = true;
      } else {
        src = ctx.createOscillator();
        src.type = o.wave;
        src.frequency.value = freq;
        src.detune.value = o.fine + spreadPos * o.spread;
        detuneParams.push(src.detune);
      }
      const pan = clamp(o.pan + spreadPos * Math.min(1, o.spread / 25) * 0.6, -1, 1);
      if (Math.abs(pan) > 0.001) {
        const sp = ctx.createStereoPanner();
        sp.pan.value = pan;
        src.connect(sp);
        sp.connect(oscGain);
      } else {
        src.connect(oscGain);
      }
      sources.push(src);
    }
  }

  // Filter: the cutoff follows the key, and its envelope opens or closes it (±5 octaves).
  const base = clamp(p.filter.cutoff * Math.pow(2, ((note - 60) / 12) * p.filter.keytrack), 20, nyquist);
  const fPeak = clamp(base * Math.pow(2, p.filter.env * 5), 20, nyquist);
  const fe = p.filterEnv;
  const fSus = base + (fPeak - base) * fe.s;
  envStart(filter.frequency, fe, base, fPeak, fSus, t0);

  // Level: velocity matters as much as the patch says.
  const peak = 0.42 * (1 - p.velocity + p.velocity * vel);
  const ae = p.ampEnv;
  envStart(amp.gain, ae, 0, peak, peak * ae.s, t0);

  // LFO
  if (p.lfo.target !== "off" && p.lfo.depth > 0) {
    const lfo = ctx.createOscillator();
    lfo.type = p.lfo.shape;
    lfo.frequency.value = p.lfo.rate;
    const depth = ctx.createGain();
    lfo.connect(depth);
    const d = p.lfo.depth;
    if (p.lfo.target === "pitch") {
      depth.gain.value = d * 200; // cents: up to ±2 semitones
      detuneParams.forEach((param) => depth.connect(param));
    } else if (p.lfo.target === "filter") {
      depth.gain.value = d * 3600; // cents: up to ±3 octaves
      depth.connect(filter.detune);
    } else if (p.lfo.target === "amp") {
      trem.gain.value = 1 - d / 2;
      depth.gain.value = d / 2;
      depth.connect(trem.gain);
    } else if (p.lfo.target === "pan") {
      depth.gain.value = d;
      depth.connect(voicePan.pan);
    }
    sources.push(lfo);
  }

  for (const s of sources) s.start(t0);
  let stopAt = Infinity;
  let released = false;
  const voice = {
    note,
    t0,
    get released() {
      return released;
    },
    get stopAt() {
      return stopAt;
    },
    release(tOff, fast = false) {
      if (released) return;
      released = true;
      const t = Math.max(t0, tOff);
      const env = fast ? Object.assign({}, ae, { r: 0.012 }) : ae;
      envRelease(amp.gain, env, 0, peak, peak * ae.s, t0, t);
      envRelease(filter.frequency, fast ? Object.assign({}, fe, { r: 0.012 }) : fe, base, fPeak, fSus, t0, t);
      stopAt = t + Math.max(0.005, env.r) + 0.03;
      for (const s of sources) {
        try {
          s.stop(stopAt);
        } catch (_) {}
      }
    },
    set onEnded(fn) {
      if (sources.length) sources[0].onended = fn;
      else fn();
    },
    disconnect() {
      try {
        voicePan.disconnect();
      } catch (_) {}
    },
  };
  return voice;
}

/** Quartet playing live (MIDI, typing keyboard, auditions). */
export class QuartetInstance {
  constructor(ctx, destination, patch, opts = {}) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(destination);
    this.voices = [];
    this.light = !!opts.lightLive;
    this.maxVoices = this.light ? 8 : 16;
    this.setPatch(patch);
  }

  setPatch(patch) {
    this.patch = sanitizePatch(patch);
    this.out.gain.value = dbGain(this.patch.volume);
  }

  setBpm() {}

  noteOn(note, vel = 0.8, time = 0) {
    const t = Math.max(this.ctx.currentTime, time || 0);
    this.voices.forEach((v) => {
      if (v.note === note && !v.released) v.release(t, true);
    });
    const live = this.voices.filter((v) => !v.released);
    if (live.length >= this.maxVoices) live[0].release(t, true);
    const v = startVoice(this.ctx, this.out, this.patch, note, Math.max(0.01, Math.min(1, vel)), t, this.light);
    this.voices.push(v);
    v.onEnded = () => {
      v.disconnect();
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
    };
  }

  noteOff(note, time = 0) {
    const t = Math.max(this.ctx.currentTime, time || 0);
    this.voices.forEach((v) => {
      if (v.note === note && !v.released) v.release(t);
    });
  }

  allOff() {
    const t = this.ctx.currentTime;
    this.voices.forEach((v) => v.release(t));
  }

  dispose() {
    const t = this.ctx.currentTime;
    this.voices.forEach((v) => v.release(t, true));
    setTimeout(() => {
      try {
        this.out.disconnect();
      } catch (_) {}
    }, 200);
  }
}

export function quartetSupported(ctx) {
  return !!(ctx && ctx.createOscillator && ctx.createStereoPanner);
}

/** Cuts trailing silence after `minSec`, with a short fade where it cuts. */
function trimTail(buffer, minSec) {
  const sr = buffer.sampleRate;
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  let last = 0;
  for (const ch of chans) {
    for (let i = ch.length - 1; i > last; i--) {
      if (Math.abs(ch[i]) > 1e-4) {
        last = i;
        break;
      }
    }
  }
  const minFrames = Math.ceil(minSec * sr);
  const end = Math.min(buffer.length, Math.max(minFrames, last + Math.round(0.02 * sr)));
  if (end >= buffer.length - 1) return buffer;
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: end, sampleRate: sr });
  const fade = Math.min(end, Math.round(0.01 * sr));
  for (let c = 0; c < chans.length; c++) {
    const dst = out.getChannelData(c);
    dst.set(chans[c].subarray(0, end));
    if (end > minFrames) for (let i = 0; i < fade; i++) dst[end - 1 - i] *= i / fade;
  }
  return out;
}

/**
 * Renders notes through a patch, like renderMammoth: `seconds` is the musical length,
 * up to `tailSec` more is kept for releases, then trailing silence is trimmed.
 * notes: [{ time, dur, note, vel }] in seconds.
 */
export async function renderQuartet(job) {
  const patch = sanitizePatch(job.patch);
  const sampleRate = job.sampleRate || 44100;
  const seconds = Math.max(0.05, Number(job.seconds) || 0);
  const tailSec = job.tailSec == null ? Math.min(8, patch.ampEnv.r + 0.2) : Math.max(0, job.tailSec);
  const frames = Math.max(1, Math.ceil((seconds + tailSec) * sampleRate));
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, frames, sampleRate);
  const out = ctx.createGain();
  out.gain.value = dbGain(patch.volume);
  out.connect(ctx.destination);
  for (const n of Array.isArray(job.notes) ? job.notes : []) {
    const t = Math.max(0, Number(n.time) || 0);
    const d = Math.max(0.005, Number(n.dur) || 0.1);
    const note = Math.max(0, Math.min(127, Math.round(Number(n.note) || 60)));
    const vel = Math.max(0.01, Math.min(1, n.vel == null ? 0.8 : Number(n.vel)));
    if (t >= seconds + tailSec) continue;
    startVoice(ctx, out, patch, note, vel, t, false).release(t + d);
  }
  const buffer = await ctx.startRendering();
  return trimTail(buffer, seconds);
}
