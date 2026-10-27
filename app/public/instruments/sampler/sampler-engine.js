/**
 * The Sampler's sound: plays SoundFont (.sf2) and SFZ instruments with the browser's
 * own audio nodes, live (MIDI, keyboard) and offline (clips), with the same voice code.
 *
 * A voice: the zone's sample (looped where the file says) at the note's pitch → its own
 * envelope (delay, attack, hold, decay, sustain, release) → optional low-pass → pan →
 * the instrument's output. Notes in the same exclusive group cut each other (hi-hats).
 *
 * Files come from this browser's storage through setHost({ loadFile, decode }), and are
 * read once: banks are kept by file id, samples are cut from a SoundFont as they play.
 */
import { sanitizePatch } from "./params.js?v=1";
import { parseSf2, sampleBuffer } from "./sf2.js?v=1";
import { parseSfz, toZones, wavSmpl, samplePath } from "./sfz.js?v=1";

let host = { loadFile: null, decode: null };
export function setHost(h) {
  host = Object.assign({}, host, h);
}

const banks = new Map(); // source key -> Promise<bank>

const sourceKey = (s) => (s ? `${s.kind}:${s.fileId}` : "");

/** A sample file name, without folders, in lower case (for matching SFZ paths). */
export const baseName = (p) => String(p).replace(/\\/g, "/").split("/").pop().toLowerCase();

/**
 * Loads (once) the instrument a patch's source names:
 * { kind, name, presets: [{ name, bank, program, zones }] }.
 * Rejects with err.missing = true when the file is not in this browser.
 */
export function loadBank(source) {
  if (!source) return Promise.reject(Object.assign(new Error("No sound loaded yet"), { missing: true }));
  const key = sourceKey(source);
  if (!banks.has(key)) {
    const p = readBank(source);
    p.catch(() => banks.delete(key));
    banks.set(key, p);
  }
  return banks.get(key);
}

/** The bank if it has finished loading, else null (live notes need it now). */
const ready = new Map();
export function readyBank(source) {
  return ready.get(sourceKey(source)) || null;
}

async function fileBytes(id, label) {
  const rec = host.loadFile ? await host.loadFile(id) : null;
  if (!rec || !rec.bytes) throw Object.assign(new Error(`"${label}" is not in this browser. Load the file again in the Sampler.`), { missing: true });
  return rec.bytes;
}

async function readBank(source) {
  const label = source.fileName || "The sound file";
  if (source.kind === "sf2") {
    const bytes = await fileBytes(source.fileId, label);
    const sf = parseSf2(bytes);
    const cache = new Map();
    const bank = {
      kind: "sf2",
      name: sf.name || label.replace(/\.sf2$/i, ""),
      presets: sf.presets,
      bufferFor(zone) {
        const k = `${zone.sample.index}:${zone.offset}:${zone.length}`;
        let b = cache.get(k);
        if (!b) cache.set(k, (b = sampleBuffer(sf, zone)));
        return b;
      },
    };
    ready.set(sourceKey(source), bank);
    return bank;
  }
  const text = new TextDecoder().decode(await fileBytes(source.fileId, label));
  const { regions } = parseSfz(text);
  const files = source.files || {};
  const byBase = new Map(Object.entries(files).map(([p, id]) => [baseName(p), id]));
  const decoded = new Map();
  const missing = [];
  for (const r of regions) {
    const path = samplePath(r);
    if (decoded.has(path)) continue;
    const id = files[path] || byBase.get(baseName(path));
    if (!id) {
      decoded.set(path, null);
      missing.push(path);
      continue;
    }
    try {
      const bytes = await fileBytes(id, baseName(path));
      const smpl = wavSmpl(bytes);
      const buffer = await host.decode(bytes.slice(0));
      decoded.set(path, Object.assign({ buffer }, smpl || {}));
    } catch (err) {
      decoded.set(path, null);
      missing.push(path);
    }
  }
  const zones = toZones(regions, (p) => decoded.get(p));
  if (!zones.length) throw new Error(missing.length ? `The SFZ's samples were not found (${missing.slice(0, 3).join(", ")}…). Choose the .sfz together with its sample files or folder.` : "This SFZ has no playable regions");
  const bank = { kind: "sfz", name: label.replace(/\.sfz$/i, ""), presets: [{ name: label.replace(/\.sfz$/i, ""), bank: 0, program: 0, zones }], missing, bufferFor: (z) => z.buffer };
  ready.set(sourceKey(source), bank);
  return bank;
}

const dbGain = (db) => Math.pow(10, db / 20);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The zones a note plays: its key and velocity range, one random layer where the file has them. */
export function zonesFor(preset, note, vel, rnd) {
  const v = Math.round(vel * 127);
  return preset.zones.filter((z) => note >= z.lokey && note <= z.hikey && v >= z.lovel && v <= z.hivel && (z.lorand == null || (rnd >= z.lorand && rnd < z.hirand)));
}

function startVoice(ctx, out, bank, zone, patch, note, vel, t0) {
  const buf = bank.bufferFor(zone);
  const rate = buf.sampleRate;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const semis = ((note - zone.root) * zone.keytrack) / 100 + zone.tune / 100 + patch.transpose + patch.fine / 100;
  src.playbackRate.value = clamp(Math.pow(2, semis / 12), 0.01, 64);
  // SoundFont samples are cut to the zone; SFZ samples are whole files with an offset.
  const base = zone.buffer ? zone.offset : 0;
  const startSec = base / rate;
  const lengthSec = zone.length / rate;
  const looping = zone.loop && zone.loopEnd > zone.loopStart + 8 && zone.loopEnd <= zone.length + 1;
  if (looping) {
    src.loop = true;
    src.loopStart = (base + zone.loopStart) / rate;
    src.loopEnd = (base + zone.loopEnd) / rate;
  }

  const env = ctx.createGain();
  const velGain = 1 - patch.velocity * (1 - vel * vel);
  const peak = 0.5 * dbGain(zone.gainDb) * velGain;
  const atk = patch.attack > 0 ? patch.attack : Math.max(0.001, zone.attack);
  const rel = patch.release > 0 ? patch.release : Math.max(0.01, zone.release);
  const dly = Math.min(4, zone.delay > 0.002 ? zone.delay : 0);
  const hold = zone.hold > 0.002 ? zone.hold : 0;
  const dec = Math.max(0.005, zone.decay);
  const sus = peak * clamp(zone.sustain, 0, 1);
  const tA = t0 + dly;
  const tH = tA + atk;
  const tD = tH + hold;
  env.gain.setValueAtTime(0, t0);
  env.gain.setValueAtTime(0, tA);
  env.gain.linearRampToValueAtTime(peak, tH);
  if (hold) env.gain.setValueAtTime(peak, tD);
  env.gain.setTargetAtTime(sus, tD, dec / 4);
  const levelAt = (t) => {
    if (t <= tA) return 0;
    if (t < tH) return peak * ((t - tA) / atk);
    if (t < tD) return peak;
    return sus + (peak - sus) * Math.exp(-(t - tD) / (dec / 4));
  };

  let node = src;
  const cut = Math.min(zone.cutoff > 0 ? zone.cutoff : 22050, patch.tone < 19999 ? patch.tone : 22050);
  if (cut < 20000) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = clamp(cut, 30, ctx.sampleRate / 2 - 100);
    f.Q.value = 0.7;
    node.connect(f);
    node = f;
  }
  node.connect(env);
  let last = env;
  if (Math.abs(zone.pan) > 0.01) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = zone.pan;
    env.connect(pan);
    last = pan;
  }
  last.connect(out);

  if (looping) src.start(t0, startSec);
  else src.start(t0, startSec, lengthSec);
  let released = false;
  let endAt = looping ? Infinity : t0 + lengthSec / src.playbackRate.value + 0.02;
  if (!looping) src.stop(endAt);
  let relAt = Infinity;
  return {
    note,
    cutBy: zone.cutBy || 0,
    oneShot: !!zone.oneShot,
    get released() {
      return released;
    },
    /** Lets go at tOff; an earlier time (a cut by another note) replaces a later one. */
    release(tOff, fast = false) {
      const t = Math.max(tOff, t0);
      if (t >= relAt) return;
      relAt = t;
      released = true;
      const r = fast ? 0.015 : rel;
      env.gain.cancelScheduledValues(t);
      env.gain.setValueAtTime(levelAt(t), t);
      env.gain.setTargetAtTime(0, t, r / 5);
      const stopAt = t + r + 0.05;
      if (stopAt < endAt) {
        endAt = stopAt;
        try {
          src.stop(stopAt);
        } catch (_) {}
      }
    },
    set onEnded(fn) {
      src.onended = fn;
    },
    disconnect() {
      try {
        last.disconnect();
      } catch (_) {}
    },
  };
}

/** Starts the zones of one note; returns their voices. */
function playNote(ctx, out, bank, patch, note, vel, t0, rnd, voices) {
  const preset = bank.presets[Math.min(patch.preset, bank.presets.length - 1)];
  if (!preset) return [];
  const zs = zonesFor(preset, note, vel, rnd);
  const started = [];
  for (const z of zs) {
    // Exclusive groups: a new note cuts the voices it turns off (an open hi-hat by a closed one).
    if (z.cutGroup) {
      for (const v of voices) if (v.cutBy === z.cutGroup) v.release(t0, true);
    }
    started.push(startVoice(ctx, out, bank, z, patch, note, vel, t0));
  }
  return started;
}

/** The Sampler playing live. Notes before its file has loaded are skipped. */
export class SamplerInstance {
  constructor(ctx, destination, patch, opts = {}) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.connect(destination);
    this.voices = [];
    this.maxVoices = opts.lightLive ? 24 : 64;
    this.onStatus = opts.onStatus || null;
    this.onError = opts.onError || null;
    this.bank = null;
    this.error = null;
    this.setPatch(patch);
  }

  setPatch(patch) {
    const next = sanitizePatch(patch);
    const changed = sourceKey(next.source) !== sourceKey(this.patch && this.patch.source);
    this.patch = next;
    this.output.gain.value = dbGain(next.volume);
    if (changed) {
      this.bank = readyBank(next.source);
      this.error = null;
      if (!this.bank && next.source) {
        loadBank(next.source).then(
          (b) => {
            if (sourceKey(this.patch.source) === sourceKey(next.source)) this.bank = b;
          },
          (err) => {
            this.error = err;
            if (this.onError) this.onError(err.message);
          }
        );
      }
    }
  }

  setBpm() {}

  noteOn(note, vel = 0.8, time = 0) {
    if (!this.bank) return;
    const t = Math.max(this.ctx.currentTime, time || 0);
    this.voices.forEach((v) => {
      if (v.note === note && !v.released && !v.oneShot) v.release(t, true);
    });
    const live = this.voices.filter((v) => !v.released);
    for (let i = 0; i <= live.length - this.maxVoices; i++) live[i].release(t, true);
    const started = playNote(this.ctx, this.output, this.bank, this.patch, note, clamp(vel, 0.01, 1), t, Math.random(), this.voices);
    for (const v of started) {
      this.voices.push(v);
      v.onEnded = () => {
        v.disconnect();
        const i = this.voices.indexOf(v);
        if (i >= 0) this.voices.splice(i, 1);
      };
    }
  }

  noteOff(note, time = 0) {
    const t = Math.max(this.ctx.currentTime, time || 0);
    this.voices.forEach((v) => {
      if (v.note === note && !v.released && !v.oneShot) v.release(t);
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
        this.output.disconnect();
      } catch (_) {}
    }, 200);
  }
}

export function samplerSupported(ctx) {
  return !!(ctx && ctx.createBufferSource && ctx.createStereoPanner);
}

function trimTail(buffer, minSec) {
  const sr = buffer.sampleRate;
  let last = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = d.length - 1; i > last; i--) {
      if (Math.abs(d[i]) > 1e-4) {
        last = i;
        break;
      }
    }
  }
  const minFrames = Math.ceil(minSec * sr);
  const end = Math.min(buffer.length, Math.max(minFrames, last + Math.round(0.02 * sr)));
  if (end >= buffer.length - 1) return buffer;
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: end, sampleRate: sr });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.getChannelData(c).set(buffer.getChannelData(c).subarray(0, end));
  return out;
}

/** Renders notes ({ time, dur, note, vel } in seconds) offline, like the other synths. */
export async function renderSampler(job) {
  const patch = sanitizePatch(job.patch);
  const bank = await loadBank(patch.source);
  const sampleRate = job.sampleRate || 44100;
  const seconds = Math.max(0.05, Number(job.seconds) || 0);
  const tailSec = job.tailSec == null ? Math.min(8, Math.max(0.5, patch.release || 2)) : Math.max(0, job.tailSec);
  const frames = Math.max(1, Math.ceil((seconds + tailSec) * sampleRate));
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, frames, sampleRate);
  const out = ctx.createGain();
  out.gain.value = dbGain(patch.volume);
  out.connect(ctx.destination);
  const voices = [];
  // Layers picked "at random" are the same on every render: a fixed sequence.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const notes = (Array.isArray(job.notes) ? job.notes : []).slice().sort((a, b) => a.time - b.time);
  for (const n of notes) {
    const t = Math.max(0, Number(n.time) || 0);
    if (t >= seconds + tailSec) continue;
    const d = Math.max(0.005, Number(n.dur) || 0.1);
    const note = clamp(Math.round(Number(n.note) || 60), 0, 127);
    const vel = clamp(n.vel == null ? 0.8 : Number(n.vel), 0.01, 1);
    const started = playNote(ctx, out, bank, patch, note, vel, t, rnd(), voices);
    for (const v of started) {
      voices.push(v);
      if (!v.oneShot) v.release(t + d);
    }
  }
  return trimTail(await ctx.startRendering(), seconds);
}
