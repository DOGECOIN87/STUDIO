/**
 * Audius Studio — instrument channels (stock synths) in the DAW.
 *
 * A synth channel behaves like any other Step Rack / Library channel: it can be
 * selected, auditioned, painted in the Step Rack, written in the Piano Roll,
 * played from MIDI or the typing keyboard. Because the arrangement engine plays
 * audio clips, "Paint Pat" and "Render Clip" render the notes through the synth
 * into a new audio clip.
 *
 * Data model — all plain JSON, so undo snapshots deep-copy it and project files
 * carry it:
 *   project.instruments  [{ id, type, name, color, assetId, root, patch }]
 *   project.synthRenders [{ assetId, instrumentId, name, color, patch, notes, seconds, bpm, sampleRate }]
 * A render keeps its own copy of the patch and notes, so opening a saved project
 * re-renders exactly the same audio (the engine is deterministic).
 * Runtime only: the channel's Library asset (a short preview buffer tagged with
 * instrumentId), render assets (tagged renderOf) and the live synth nodes.
 */
import { sanitizePatch, clonePatch } from "./mammoth/params.js?v=1";
import { STOCK_INSTRUMENTS, findStockInstrument } from "./registry.js?v=1";

export const MAX_INSTRUMENTS = 16;
export const MAX_RENDERS = 400;
export const MAX_RENDER_NOTES = 4096;
export const MAX_RENDER_SECONDS = 600;
const DEFAULT_PRESET = "Permafrost Pluck";
/** Touch screens get the lighter live engine (see mammoth-host.js). */
function touchScreen() {
  return !!(window.matchMedia && window.matchMedia("(pointer: coarse), (hover: none)").matches);
}
const ID_RE = /^[\w.:-]{1,80}$/;
const HEX_RE = /^#[0-9a-f]{3,8}$/i;

function num(v, min, max, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
}

/** Validates project.instruments from a file. Never throws. */
export function sanitizeInstruments(raw) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== "object" || !findStockInstrument(item.type)) continue;
    if (!ID_RE.test(String(item.id || "")) || !ID_RE.test(String(item.assetId || ""))) continue;
    if (seen.has(item.id) || seen.has(item.assetId)) continue;
    seen.add(item.id);
    seen.add(item.assetId);
    out.push({
      id: String(item.id),
      type: item.type,
      name: String(item.name || "Synth").slice(0, 60),
      color: HEX_RE.test(item.color) ? item.color : findStockInstrument(item.type).color,
      assetId: String(item.assetId),
      root: Math.round(num(item.root, 24, 96, 72)),
      patch: sanitizePatch(item.patch),
    });
    if (out.length >= MAX_INSTRUMENTS) break;
  }
  return out;
}

/** Validates project.synthRenders from a file. Never throws. */
export function sanitizeSynthRenders(raw) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== "object" || !ID_RE.test(String(r.assetId || "")) || seen.has(r.assetId)) continue;
    seen.add(r.assetId);
    const notes = [];
    for (const n of Array.isArray(r.notes) ? r.notes : []) {
      if (!Array.isArray(n) || n.length < 4) continue;
      notes.push([num(n[0], 0, MAX_RENDER_SECONDS, 0), num(n[1], 0.005, MAX_RENDER_SECONDS, 0.1), Math.round(num(n[2], 0, 127, 60)), num(n[3], 0.01, 1, 0.8)]);
      if (notes.length >= MAX_RENDER_NOTES) break;
    }
    out.push({
      assetId: String(r.assetId),
      instrumentId: ID_RE.test(String(r.instrumentId || "")) ? String(r.instrumentId) : "",
      name: String(r.name || "Synth clip").slice(0, 120),
      color: HEX_RE.test(r.color) ? r.color : "#5fb4ff",
      patch: sanitizePatch(r.patch),
      notes,
      seconds: num(r.seconds, 0.05, MAX_RENDER_SECONDS, 2),
      bpm: num(r.bpm, 20, 999, 120),
      sampleRate: Math.round(num(r.sampleRate, 22050, 96000, 44100)),
    });
    if (out.length >= MAX_RENDERS) break;
  }
  return out;
}

/**
 * deps: engine, assets, getProject(), registerAsset(id,name,color,buffer), nextId(prefix),
 *       setStatus(text, {kind}), pushUndoState(), onMutated(text), refreshLibrary(), selectAsset(id)
 */
export function createInstrumentManager(deps) {
  const { engine, assets, getProject, registerAsset, nextId, setStatus, pushUndoState, onMutated, refreshLibrary, selectAsset } = deps;
  const live = new Map();
  const typingHeld = new Map();
  const previewTimers = new Map();
  let hostMod = null;
  let hostP = null;
  let uiP = null;
  let presetsP = null;
  let editor = null;
  let warnedNoLive = false;

  const host = () =>
    hostP ||
    (hostP = import("./mammoth/mammoth-host.js?v=2").then((m) => {
      hostMod = m;
      return m;
    }));
  const uiModule = () => uiP || (uiP = import("./mammoth/mammoth-ui.js?v=6"));
  const presets = () => presetsP || (presetsP = import("./mammoth/presets.js?v=3"));

  function list() {
    const p = getProject();
    if (!Array.isArray(p.instruments)) p.instruments = [];
    return p.instruments;
  }
  function renders() {
    const p = getProject();
    if (!Array.isArray(p.synthRenders)) p.synthRenders = [];
    return p.synthRenders;
  }
  const byId = (id) => list().find((i) => i.id === id) || null;
  const forAsset = (asset) => (asset && asset.instrumentId ? byId(asset.instrumentId) : null);
  const clampNote = (n) => Math.max(0, Math.min(127, Math.round(n)));

  function putAsset(id, name, color, buffer, extra) {
    const a = registerAsset(id, name, color, buffer);
    Object.assign(a, extra);
    return a;
  }

  function silentBuffer(seconds = 0.5) {
    const ctx = engine.ensureContext();
    return ctx.createBuffer(2, Math.max(1, Math.round(ctx.sampleRate * seconds)), ctx.sampleRate);
  }

  /* ------------------------------------------------------- live synths */
  function liveFor(inst) {
    const rec = live.get(inst.id);
    if (rec) return rec.synth;
    if (!hostMod) {
      host().catch(() => {});
      return null;
    }
    const ctx = engine.ensureContext();
    if (!hostMod.mammothSupported(ctx)) {
      if (!warnedNoLive) {
        warnedNoLive = true;
        setStatus("This browser can't play synths live (no AudioWorklet). Paint Pat / Render Clip still render them.", { kind: "error" });
      }
      return null;
    }
    const synth = new hostMod.MammothInstance(ctx, engine.masterGain, inst.patch, {
      bpm: getProject().bpm,
      lightLive: touchScreen(),
      onStatus: (m) => {
        if (editor && editor.instrumentId === inst.id) editor.onStatus(m);
      },
      onError: (msg) => setStatus(`Synth "${inst.name}": ${msg}`, { kind: "error" }),
    });
    live.set(inst.id, { synth, patchRef: inst.patch });
    return synth;
  }

  /**
   * Brings live synths in line with the project after undo / redo / load:
   * disposes removed instruments and resends any patch whose object changed.
   */
  function syncLive({ refreshEditor = true } = {}) {
    const bpm = getProject().bpm;
    let editorPatchChanged = false;
    for (const [id, rec] of Array.from(live.entries())) {
      const inst = byId(id);
      if (!inst) {
        rec.synth.dispose();
        live.delete(id);
        continue;
      }
      if (rec.patchRef !== inst.patch) {
        rec.synth.setPatch(inst.patch);
        rec.patchRef = inst.patch;
        if (editor && editor.instrumentId === id) editorPatchChanged = true;
      }
      rec.synth.setBpm(bpm);
    }
    if (editor && editor.isOpen()) {
      if (!byId(editor.instrumentId)) editor.close();
      else if (refreshEditor || editorPatchChanged) editor.refresh();
    }
  }

  /* ----------------------------------------------------------- audition */
  function previewNote(asset, pitchSt = 0, durSec = 0.4, vel = 0.85) {
    const inst = forAsset(asset);
    if (!inst) return false;
    const s = liveFor(inst);
    if (!s) return true;
    const ctx = engine.ensureContext();
    const note = clampNote(inst.root + pitchSt);
    s.noteOn(note, Math.max(0.05, Math.min(1, vel)), 0);
    s.noteOff(note, ctx.currentTime + Math.max(0.03, durSec));
    return true;
  }

  function playPhrase(asset) {
    const inst = forAsset(asset);
    if (!inst) return false;
    const s = liveFor(inst);
    if (!s) {
      host().then(() => playPhrase(asset)).catch(() => {});
      return true;
    }
    const ctx = engine.ensureContext();
    const t0 = ctx.currentTime + 0.03;
    const r = inst.root;
    const seq = [
      [0, 0, 0.32],
      [0.22, 4, 0.32],
      [0.44, 7, 0.32],
      [0.66, 12, 0.7],
    ];
    for (const [t, st, d] of seq) {
      s.noteOn(clampNote(r + st), 0.85, t0 + t);
      s.noteOff(clampNote(r + st), t0 + t + d);
    }
    setStatus(`Auditioning synth "${inst.name}" (${inst.patch.name})`);
    return true;
  }

  /** MIDI note on: returns a voice-like handle with stop(), or null. */
  function midiNoteOn(asset, midiNote, vel) {
    const inst = forAsset(asset);
    if (!inst) return null;
    const s = liveFor(inst);
    if (!s) return { stop() {} };
    const note = clampNote(midiNote + inst.root - 72);
    s.noteOn(note, Math.max(0.02, Math.min(1, vel)), 0);
    return { stop: () => s.noteOff(note, 0) };
  }

  /** Typing keyboard: `semitoneOffset` is the DAW map value (z = 0 = C4 when the root is C5). */
  function typingNoteOn(asset, semitoneOffset, keyId) {
    const inst = forAsset(asset);
    if (!inst) return false;
    if (typingHeld.has(keyId)) return true;
    const s = liveFor(inst);
    if (!s) return true;
    const note = clampNote(inst.root + semitoneOffset - 12);
    s.noteOn(note, 0.85, 0);
    typingHeld.set(keyId, { synth: s, note });
    return true;
  }
  function typingNoteOff(keyId) {
    const h = typingHeld.get(keyId);
    if (!h) return false;
    typingHeld.delete(keyId);
    h.synth.noteOff(h.note, 0);
    return true;
  }
  function releaseTyping() {
    for (const key of Array.from(typingHeld.keys())) typingNoteOff(key);
  }

  function allNotesOff() {
    releaseTyping();
    for (const rec of live.values()) rec.synth.allOff();
  }

  /* -------------------------------------------------------------- render */
  async function renderToAsset(inst, notes, { seconds, label }) {
    const hostM = await host();
    const bpm = getProject().bpm;
    const sampleRate = engine.ctx ? engine.ctx.sampleRate : 44100;
    const patch = clonePatch(inst.patch);
    const clean = notes
      .slice(0, MAX_RENDER_NOTES)
      .map((n) => [Number(n.time.toFixed(4)), Number(Math.max(0.005, n.dur).toFixed(4)), clampNote(n.note), Number(Math.max(0.01, Math.min(1, n.vel)).toFixed(3))]);
    const buffer = await hostM.renderMammoth({
      patch,
      notes: clean.map(([time, dur, note, vel]) => ({ time, dur, note, vel })),
      seconds,
      bpm,
      sampleRate,
    });
    const assetId = nextId("synthclip");
    const name = `${inst.name} · ${label}`.slice(0, 120);
    putAsset(assetId, name, inst.color, buffer, { renderOf: inst.id });
    const rs = renders();
    rs.push({ assetId, instrumentId: inst.id, name, color: inst.color, patch, notes: clean, seconds, bpm, sampleRate });
    if (rs.length > MAX_RENDERS) rs.splice(0, rs.length - MAX_RENDERS);
    return { assetId, buffer, durationSec: buffer.duration };
  }

  /**
   * Notes -> an AudioBuffer only (nothing joins the Library), for linked pattern clips.
   * `notes`: [{ time, dur (seconds), semi (from C5, as in the Piano Roll), vel }].
   */
  async function renderBuffer(asset, notes, seconds) {
    const inst = forAsset(asset);
    if (!inst || !notes.length) return null;
    const hostM = await host();
    return hostM.renderMammoth({
      patch: clonePatch(inst.patch),
      notes: notes.slice(0, MAX_RENDER_NOTES).map((n) => ({
        time: Number(n.time.toFixed(4)),
        dur: Number(Math.max(0.005, n.dur).toFixed(4)),
        note: clampNote(inst.root + (n.semi || 0)),
        vel: Number(Math.max(0.01, Math.min(1, n.vel == null ? 0.85 : n.vel)).toFixed(3)),
      })),
      seconds,
      bpm: getProject().bpm,
      sampleRate: engine.ctx ? engine.ctx.sampleRate : 44100,
    });
  }

  /** A synth channel's sound as text, so a change to it can be noticed. */
  function soundSignature(asset) {
    const inst = forAsset(asset);
    return inst ? `${inst.root}|${JSON.stringify(inst.patch)}` : "";
  }

  /** Step Rack row → audio clip (one bar of steps at the root note: 16 in 4/4, 12 in 3/4). */
  function renderSteps(asset, steps, { swingBeats = 0, label = "Pattern" } = {}) {
    const inst = forAsset(asset);
    if (!inst) return Promise.resolve(null);
    const spb = 60 / getProject().bpm;
    const notes = [];
    const barSteps = steps.length || 16;
    for (let s = 0; s < barSteps; s++) {
      if (!steps[s]) continue;
      const beat = s * 0.25 + (s % 2 === 1 ? swingBeats : 0);
      notes.push({ time: beat * spb, dur: 0.25 * spb * 0.9, note: inst.root, vel: 0.85 });
    }
    if (!notes.length) return Promise.resolve(null);
    return renderToAsset(inst, notes, { seconds: barSteps * 0.25 * spb, label });
  }

  /** Piano Roll notes → audio clip. `notes`: [{startStep, lenSteps, midi, vel}] (midi as written; C5 = 72). */
  function renderNotes(asset, notes, { label = "Piano Roll", steps = 16 } = {}) {
    const inst = forAsset(asset);
    if (!inst || !notes.length) return Promise.resolve(null);
    const spb = 60 / getProject().bpm;
    let endSteps = steps;
    const out = notes.map((n) => {
      endSteps = Math.max(endSteps, n.startStep + n.lenSteps);
      return { time: n.startStep * 0.25 * spb, dur: n.lenSteps * 0.25 * spb * 0.98, note: inst.root + n.midi - 72, vel: n.vel == null ? 0.85 : n.vel };
    });
    return renderToAsset(inst, out, { seconds: endSteps * 0.25 * spb, label });
  }

  async function restoreRender(r) {
    const hostM = await host();
    const buffer = await hostM.renderMammoth({
      patch: r.patch,
      notes: r.notes.map(([time, dur, note, vel]) => ({ time, dur, note, vel })),
      seconds: r.seconds,
      bpm: r.bpm,
      sampleRate: r.sampleRate,
    });
    putAsset(r.assetId, r.name, r.color, buffer, { renderOf: r.instrumentId });
  }

  /* ------------------------------------------------------ channel assets */
  async function refreshPreview(inst) {
    try {
      const hostM = await host();
      const buffer = await hostM.renderMammoth({
        patch: clonePatch(inst.patch),
        notes: [{ time: 0, dur: 0.5, note: inst.root, vel: 0.85 }],
        seconds: 0.5,
        tailSec: 2,
        bpm: getProject().bpm,
        sampleRate: engine.ctx ? engine.ctx.sampleRate : 44100,
      });
      const current = byId(inst.id);
      if (!current || !assets.has(current.assetId)) return;
      const old = assets.get(current.assetId);
      putAsset(current.assetId, old.name, old.color, buffer, { instrumentId: current.id, muted: !!old.muted });
      refreshLibrary();
    } catch (err) {
      console.warn("Synth preview render failed:", err);
    }
  }

  function schedulePreview(inst) {
    if (!inst) return;
    clearTimeout(previewTimers.get(inst.id));
    previewTimers.set(
      inst.id,
      setTimeout(() => {
        previewTimers.delete(inst.id);
        refreshPreview(inst);
      }, 1500)
    );
  }

  function nextNumber(base) {
    const used = new Set(list().map((i) => i.name));
    let n = 1;
    while (used.has(`${base} ${n}`)) n++;
    return n;
  }

  async function addInstrument(type = "mammoth") {
    const def = findStockInstrument(type);
    if (!def) return null;
    if (list().length >= MAX_INSTRUMENTS) {
      setStatus(`A project can hold up to ${MAX_INSTRUMENTS} synth channels.`, { kind: "error" });
      return null;
    }
    engine.ensureContext();
    let presetsM;
    try {
      [, presetsM] = await Promise.all([host(), presets()]);
    } catch (err) {
      setStatus(`The synth could not be loaded: ${err.message}`, { kind: "error" });
      return null;
    }
    pushUndoState();
    const start = presetsM.FACTORY_PRESETS.find((p) => p.name === DEFAULT_PRESET) || presetsM.FACTORY_PRESETS[0];
    const inst = {
      id: nextId("inst"),
      type,
      name: `${def.channelName} ${nextNumber(def.channelName)}`,
      color: def.color,
      assetId: nextId("synth"),
      root: 72,
      patch: clonePatch(start),
    };
    list().push(inst);
    putAsset(inst.assetId, inst.name, inst.color, silentBuffer(), { instrumentId: inst.id });
    selectAsset(inst.assetId);
    onMutated(`Added synth channel "${inst.name}" — paint steps, write notes, or play it with MIDI / the typing keyboard`);
    refreshLibrary();
    refreshPreview(inst);
    openEditor(assets.get(inst.assetId));
    return inst;
  }

  async function openEditor(asset) {
    const inst = forAsset(asset);
    if (!inst) return;
    engine.ensureContext();
    let hostM;
    let uiM;
    try {
      [hostM, uiM] = await Promise.all([host(), uiModule()]);
    } catch (err) {
      setStatus(`The synth editor could not be loaded: ${err.message}`, { kind: "error" });
      return;
    }
    const id = inst.id;
    let dirty = false;
    editor = uiM.openMammothEditor({
      instrumentId: id,
      getInstrument: () => byId(id),
      live: () => {
        const i = byId(id);
        return i ? liveFor(i) : null;
      },
      liveSupported: hostM.mammothSupported(engine.ensureContext()),
      ensureAudio: () => engine.ensureContext(),
      replacePatch: (patch) => {
        const i = byId(id);
        if (!i) return;
        i.patch = sanitizePatch(patch);
        const rec = live.get(id);
        if (rec) {
          rec.synth.setPatch(i.patch);
          rec.patchRef = i.patch;
        }
        dirty = true;
      },
      setRoot: (note) => {
        const i = byId(id);
        if (!i) return;
        pushUndoState();
        i.root = Math.max(24, Math.min(96, Math.round(note)));
        dirty = true;
      },
      beginEdit: () => pushUndoState(),
      // The editor shows its own messages in its header; the global toast stays out of the keyboard.
      commit: () => {
        dirty = true;
      },
      setStatus: (text, kind) => setStatus(text, { kind: kind === "error" ? "error" : kind === "value" ? "value" : "info" }),
      onClose: () => {
        const i = byId(id);
        if (dirty && i) refreshPreview(i);
        dirty = false;
      },
    });
  }

  function closeEditor() {
    if (editor && editor.isOpen()) editor.close();
  }

  /* ------------------------------------------------------- bookkeeping */
  function onAssetDeleted(assetId) {
    const p = getProject();
    p.instruments = list().filter((i) => i.assetId !== assetId);
    p.synthRenders = renders().filter((r) => r.assetId !== assetId);
    syncLive();
  }

  function onCleared() {
    const p = getProject();
    p.instruments = [];
    p.synthRenders = [];
    syncLive();
  }

  /** After a project is opened: build channel assets and re-render synth clips. `quiet` skips the messages. */
  async function restoreProject({ quiet = false } = {}) {
    syncLive();
    for (const [id, a] of Array.from(assets.entries())) {
      if (a.instrumentId && !byId(a.instrumentId)) assets.delete(id);
    }
    const insts = list().filter((i) => !assets.has(i.assetId) || !assets.get(i.assetId).instrumentId);
    const missing = renders().filter((r) => !assets.has(r.assetId));
    if (!insts.length && !missing.length) return;
    for (const inst of insts) putAsset(inst.assetId, inst.name, inst.color, silentBuffer(), { instrumentId: inst.id });
    refreshLibrary();
    if (missing.length && !quiet) setStatus(`Rendering ${missing.length} synth clip${missing.length === 1 ? "" : "s"}…`);
    let failed = 0;
    for (const r of missing) {
      try {
        await restoreRender(r);
      } catch (err) {
        failed++;
        console.warn("Synth clip render failed:", err);
      }
    }
    for (const inst of insts) await refreshPreview(inst);
    refreshLibrary();
    onMutated(quiet ? null : failed ? `${failed} synth clip(s) could not be rendered` : missing.length ? `Rendered ${missing.length} synth clip(s)` : null);
  }

  /** Warm the synth modules in the background so the first note is instant. */
  function preload() {
    host().catch(() => {});
  }

  return {
    STOCK_INSTRUMENTS,
    isInstrumentAsset: (asset) => !!(asset && asset.instrumentId),
    isRenderAsset: (asset) => !!(asset && asset.renderOf),
    instrumentForAsset: forAsset,
    count: () => list().length,
    addInstrument,
    openEditor,
    closeEditor,
    previewNote,
    playPhrase,
    midiNoteOn,
    typingNoteOn,
    typingNoteOff,
    releaseTyping,
    allNotesOff,
    renderSteps,
    renderNotes,
    renderBuffer,
    soundSignature,
    onAssetDeleted,
    onCleared,
    syncLive,
    restoreProject,
    preload,
  };
}
