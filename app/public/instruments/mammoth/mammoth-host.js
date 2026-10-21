/**
 * Mammoth — host side (main thread).
 *
 *   • loads the AudioWorklet module once per AudioContext,
 *   • MammothInstance: one live synth node (notes, parameter edits, meters),
 *   • renderMammoth(): renders notes to an AudioBuffer — OfflineAudioContext
 *     with the same worklet when the browser supports it, otherwise the same
 *     engine on the main thread in small chunks (Safari without offline
 *     worklets, or any failure).
 *
 * Nothing here is fetched from another origin: the processor is a same-origin
 * static file next to this module.
 */
import { engineParamTable, sanitizePatch, tablesUsed } from "./params.js?v=1";
import { buildWavetable } from "./wavetables.js?v=1";

export const PROCESSOR_NAME = "mammoth-synth";
const PROCESSOR_URL = new URL("./mammoth-processor.js?v=1", import.meta.url).href;
const moduleLoads = new WeakMap();
let paramTable = null;

function params() {
  if (!paramTable) paramTable = engineParamTable();
  return paramTable;
}

/** True when this browser can run the synth live (AudioWorklet support). */
export function mammothSupported(ctx) {
  return !!(ctx && ctx.audioWorklet && typeof ctx.audioWorklet.addModule === "function" && typeof AudioWorkletNode === "function");
}

/** Adds the processor module to `ctx` (once). */
export function loadMammothWorklet(ctx) {
  if (!mammothSupported(ctx)) return Promise.reject(new Error("This browser has no AudioWorklet support."));
  let p = moduleLoads.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(PROCESSOR_URL).catch((err) => {
      moduleLoads.delete(ctx);
      throw err;
    });
    moduleLoads.set(ctx, p);
  }
  return p;
}

/** Plain-object copy of a built table for the worklet (structured-clone friendly). */
function tablePayload(index) {
  const t = buildWavetable(index);
  return { index: t.index, frames: t.frames, size: t.size, levels: t.levels, data: t.data };
}

/* ------------------------------------------------------------ live node */

export class MammothInstance {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} destination
   * @param {object} patch
   * @param {{bpm?: number, onStatus?: Function, onError?: Function}} opts
   */
  constructor(ctx, destination, patch, opts = {}) {
    this.ctx = ctx;
    this.patch = sanitizePatch(patch);
    this.bpm = opts.bpm > 0 ? opts.bpm : 120;
    this.onStatus = opts.onStatus || null;
    this.onError = opts.onError || null;
    this.node = null;
    this.ready = false;
    this.disposed = false;
    this.failed = null;
    this.queue = [];
    this.sentTables = new Set();
    this.meterOn = false;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.output.connect(destination);
    this.readyPromise = this.init();
  }

  async init() {
    try {
      await loadMammothWorklet(this.ctx);
      if (this.disposed) return;
      const tables = tablesUsed(this.patch);
      this.node = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { params: params(), patch: this.patch, tables: tables.map(tablePayload), bpm: this.bpm },
      });
      for (const t of tables) this.sentTables.add(t);
      this.node.port.onmessage = (e) => {
        const m = e.data;
        if (m && m.type === "status" && this.onStatus) this.onStatus(m);
      };
      this.node.onprocessorerror = () => {
        this.failed = "The synth engine stopped after an internal error. Close and reopen the synth to restart it.";
        if (this.onError) this.onError(this.failed);
      };
      this.node.connect(this.output);
      this.ready = true;
      if (this.meterOn) this.node.port.postMessage({ type: "meter", on: true });
      const pending = this.queue;
      this.queue = [];
      for (const m of pending) this.node.port.postMessage(m);
    } catch (err) {
      this.failed = err && err.message ? err.message : String(err);
      if (this.onError) this.onError(this.failed);
    }
  }

  post(msg) {
    if (this.disposed || this.failed) return;
    if (this.ready && this.node) this.node.port.postMessage(msg);
    else if (this.queue.length < 512) this.queue.push(msg);
  }

  ensureTable(index) {
    const i = index | 0;
    if (this.sentTables.has(i)) return;
    this.sentTables.add(i);
    this.post({ type: "table", table: tablePayload(i) });
  }

  setPatch(patch) {
    this.patch = sanitizePatch(patch);
    for (const t of tablesUsed(this.patch)) this.ensureTable(t);
    this.post({ type: "patch", patch: this.patch });
  }

  setParam(id, value) {
    this.post({ type: "param", id, value });
  }

  setEnum(id, value) {
    if (/^osc[123]\.table$/.test(id)) this.ensureTable(value);
    this.post({ type: "enum", id, value });
  }

  setMods(mods) {
    this.post({ type: "mods", mods });
  }

  setSeq(slot, steps, shapes) {
    this.post({ type: "seq", slot, steps, shapes });
  }

  noteOn(note, vel = 0.8, time = 0) {
    this.post({ type: "note", on: true, note, vel, time });
  }

  noteOff(note, time = 0) {
    this.post({ type: "note", on: false, note, time });
  }

  allOff() {
    this.post({ type: "allOff" });
  }

  panic() {
    this.post({ type: "panic" });
  }

  setBpm(bpm) {
    if (!(bpm > 0) || bpm === this.bpm) return;
    this.bpm = bpm;
    this.post({ type: "bpm", bpm });
  }

  aftertouch(value) {
    this.post({ type: "at", value });
  }

  setMeter(on) {
    this.meterOn = !!on;
    this.post({ type: "meter", on: !!on });
  }

  setVolume(gain) {
    try {
      this.output.gain.setTargetAtTime(Math.max(0, gain), this.ctx.currentTime, 0.01);
    } catch (_) {
      this.output.gain.value = Math.max(0, gain);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      if (this.node) {
        this.node.port.postMessage({ type: "dispose" });
        this.node.port.onmessage = null;
        this.node.disconnect();
      }
    } catch (_) {}
    try {
      this.output.disconnect();
    } catch (_) {}
    this.node = null;
  }
}

/* ------------------------------------------------------- offline render */

let engineModule = null;
function loadEngine() {
  if (!engineModule) engineModule = import("./mammoth-processor.js?v=1");
  return engineModule;
}

function makeBuffer(channels, length, sampleRate) {
  try {
    return new AudioBuffer({ numberOfChannels: channels, length, sampleRate });
  } catch (_) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    return new OAC(channels, Math.max(1, length), sampleRate).createBuffer(channels, Math.max(1, length), sampleRate);
  }
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/** Same engine as the worklet, run here in 1 s chunks with a yield between them. */
async function renderOnMainThread(patch, events, frames, sampleRate, bpm) {
  const { MammothEngine } = await loadEngine();
  const tables = tablesUsed(patch).map(tablePayload);
  const engine = new MammothEngine(sampleRate, { params: params(), patch, tables, events, bpm });
  const buffer = makeBuffer(2, frames, sampleRate);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const bl = new Float32Array(128);
  const br = new Float32Array(128);
  let sinceYield = 0;
  for (let pos = 0; pos < frames; pos += 128) {
    engine.render(bl, br, 128, pos);
    const n = Math.min(128, frames - pos);
    L.set(n === 128 ? bl : bl.subarray(0, n), pos);
    R.set(n === 128 ? br : br.subarray(0, n), pos);
    sinceYield += 128;
    if (sinceYield >= sampleRate) {
      sinceYield = 0;
      await yieldToUi();
    }
  }
  return buffer;
}

/** Cuts trailing silence (below −80 dBFS) after `minSec`, keeping a short fade. */
export function trimTail(buffer, minSec) {
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
  const out = makeBuffer(buffer.numberOfChannels, end, sr);
  const fade = Math.min(end, Math.round(0.01 * sr));
  for (let c = 0; c < chans.length; c++) {
    const dst = out.getChannelData(c);
    dst.set(chans[c].subarray(0, end));
    if (end > minFrames) for (let i = 0; i < fade; i++) dst[end - 1 - i] *= i / fade;
  }
  return out;
}

/**
 * Renders notes through a patch.
 * @param {{patch: object, notes: Array<{time:number, dur:number, note:number, vel?:number}>,
 *          seconds: number, tailSec?: number, sampleRate?: number, bpm?: number}} job
 *   `seconds` is the musical length (notes end by then); up to `tailSec` more is
 *   rendered for release and effect tails, then trailing silence is trimmed.
 * @returns {Promise<AudioBuffer>}
 */
export async function renderMammoth(job) {
  const patch = sanitizePatch(job.patch);
  const sampleRate = job.sampleRate || 44100;
  const bpm = job.bpm > 0 ? job.bpm : 120;
  const tailSec = job.tailSec == null ? 4 : Math.max(0, job.tailSec);
  const seconds = Math.max(0.05, Number(job.seconds) || 0);
  const frames = Math.ceil((seconds + tailSec) * sampleRate);
  const events = [];
  for (const n of Array.isArray(job.notes) ? job.notes : []) {
    const t = Math.max(0, Number(n.time) || 0);
    const d = Math.max(0.005, Number(n.dur) || 0.1);
    const note = Math.max(0, Math.min(127, Math.round(Number(n.note) || 60)));
    const vel = Math.max(0.01, Math.min(1, n.vel == null ? 0.8 : Number(n.vel)));
    events.push({ frame: Math.round(t * sampleRate), on: true, note, vel });
    events.push({ frame: Math.round((t + d) * sampleRate), on: false, note, vel });
  }
  let buffer = null;
  const OAC = typeof window !== "undefined" ? window.OfflineAudioContext || window.webkitOfflineAudioContext : null;
  if (OAC) {
    try {
      const ctx = new OAC(2, frames, sampleRate);
      if (!mammothSupported(ctx)) throw new Error("no offline worklet");
      await loadMammothWorklet(ctx);
      const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { params: params(), patch, tables: tablesUsed(patch).map(tablePayload), events, bpm },
      });
      node.connect(ctx.destination);
      buffer = await ctx.startRendering();
    } catch (_) {
      buffer = null;
    }
  }
  if (!buffer) buffer = await renderOnMainThread(patch, events, frames, sampleRate, bpm);
  return trimTail(buffer, seconds);
}
