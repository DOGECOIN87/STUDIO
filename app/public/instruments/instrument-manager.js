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
import { sanitizePatch as sanitizeMammoth, clonePatch as cloneMammoth } from "./mammoth/params.js?v=1";
import { sanitizePatch as sanitizeQuartet, clonePatch as cloneQuartet } from "./quartet/params.js?v=1";
import { sanitizePatch as sanitizeSampler, clonePatch as cloneSampler, defaultPatch as samplerDefault } from "./sampler/params.js?v=1";
import { STOCK_INSTRUMENTS, findStockInstrument } from "./registry.js?v=3";

export const MAX_INSTRUMENTS = 16;
export const MAX_RENDERS = 400;
export const MAX_RENDER_NOTES = 4096;
export const MAX_RENDER_SECONDS = 600;

/**
 * Each synth type: how to clean and copy its patch, and where its live engine,
 * renderer, editor and factory presets load from (on first use).
 */
const DRIVERS = {
  mammoth: {
    sanitize: sanitizeMammoth,
    clone: cloneMammoth,
    host: () =>
      import("./mammoth/mammoth-host.js?v=2").then((m) => ({ supported: m.mammothSupported, Instance: m.MammothInstance, render: m.renderMammoth })),
    editor: () => import("./mammoth/mammoth-ui.js?v=13").then((m) => m.openMammothEditor),
    presets: () => import("./mammoth/presets.js?v=3").then((m) => ({ list: m.FACTORY_PRESETS, start: "Permafrost Pluck" })),
  },
  quartet: {
    sanitize: sanitizeQuartet,
    clone: cloneQuartet,
    host: () =>
      import("./quartet/quartet-engine.js?v=2").then((m) => ({ supported: m.quartetSupported, Instance: m.QuartetInstance, render: m.renderQuartet })),
    editor: () => import("./quartet/quartet-ui.js?v=9").then((m) => m.openQuartetEditor),
    presets: () => import("./quartet/presets.js?v=1").then((m) => ({ list: m.FACTORY_PRESETS, start: m.DEFAULT_PRESET })),
  },
  sampler: {
    sanitize: sanitizeSampler,
    clone: cloneSampler,
    host: () =>
      import("./sampler/sampler-engine.js?v=1").then((m) => ({ supported: m.samplerSupported, Instance: m.SamplerInstance, render: m.renderSampler, engine: m })),
    editor: () => import("./sampler/sampler-ui.js?v=2").then((m) => m.openSamplerEditor),
    presets: () => Promise.resolve({ list: [samplerDefault()], start: "Sampler" }),
  },
};
const driverOf = (type) => DRIVERS[type] || DRIVERS.mammoth;
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
      patch: driverOf(item.type).sanitize(item.patch),
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
    // Older files have no type: their renders are all Mammoth.
    const type = findStockInstrument(r.type) ? r.type : "mammoth";
    out.push({
      assetId: String(r.assetId),
      type,
      instrumentId: ID_RE.test(String(r.instrumentId || "")) ? String(r.instrumentId) : "",
      name: String(r.name || "Synth clip").slice(0, 120),
      color: HEX_RE.test(r.color) ? r.color : "#5fb4ff",
      patch: driverOf(type).sanitize(r.patch),
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
  const { engine, assets, getProject, registerAsset, nextId, setStatus, pushUndoState, onMutated, refreshLibrary, selectAsset, watchPanel } = deps;
  const { storeFile, loadFile, pickFiles } = deps;
  // Sampler files kept in memory too, for browsers that cannot store them (private windows).
  const memFiles = new Map();
  const readFile = async (id) => memFiles.get(id) || (loadFile ? loadFile(id) : null);
  const live = new Map();
  const typingHeld = new Map();
  const previewTimers = new Map();
  const hostMods = new Map(); // type -> loaded engine
  const loading = new Map(); // "kind:type" -> promise
  const watched = new WeakSet();
  let editor = null;
  let warnedNoLive = false;

  const once = (key, make) => {
    if (!loading.has(key)) {
      const p = make();
      // A failed load (offline) may be tried again later.
      p.catch(() => loading.delete(key));
      loading.set(key, p);
    }
    return loading.get(key);
  };
  const host = (type = "mammoth") =>
    once(`host:${type}`, () =>
      driverOf(type)
        .host()
        .then((m) => {
          if (m.engine && m.engine.setHost) m.engine.setHost({ loadFile: readFile, decode: (bytes) => engine.decodeAudioFile(bytes) });
          hostMods.set(type, m);
          return m;
        })
    );
  const editorModule = (type) => once(`editor:${type}`, () => driverOf(type).editor());
  const presets = (type) => once(`presets:${type}`, () => driverOf(type).presets());

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
    const hostMod = hostMods.get(inst.type);
    if (!hostMod) {
      host(inst.type).catch(() => {});
      return null;
    }
    const ctx = engine.ensureContext();
    if (!hostMod.supported(ctx)) {
      if (!warnedNoLive) {
        warnedNoLive = true;
        setStatus("This browser can't play synths live (no AudioWorklet). Paint Pat / Render Clip still render them.", { kind: "error" });
      }
      return null;
    }
    const synth = new hostMod.Instance(ctx, engine.masterGain, inst.patch, {
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
      host(inst.type).then(() => playPhrase(asset)).catch(() => {});
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
    const hostM = await host(inst.type);
    const bpm = getProject().bpm;
    const sampleRate = engine.ctx ? engine.ctx.sampleRate : 44100;
    const patch = driverOf(inst.type).clone(inst.patch);
    const clean = notes
      .slice(0, MAX_RENDER_NOTES)
      .map((n) => [Number(n.time.toFixed(4)), Number(Math.max(0.005, n.dur).toFixed(4)), clampNote(n.note), Number(Math.max(0.01, Math.min(1, n.vel)).toFixed(3))]);
    const buffer = await hostM.render({
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
    rs.push({ assetId, type: inst.type, instrumentId: inst.id, name, color: inst.color, patch, notes: clean, seconds, bpm, sampleRate });
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
    const hostM = await host(inst.type);
    return hostM.render({
      patch: driverOf(inst.type).clone(inst.patch),
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
    const hostM = await host(r.type);
    const buffer = await hostM.render({
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
      const hostM = await host(inst.type);
      const buffer = await hostM.render({
        patch: driverOf(inst.type).clone(inst.patch),
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

  /* ------------------------------------------------------ sampler files */
  const SOUND_FILE = /\.(sf2|sfz)$/i;
  const AUDIO_FILE = /\.(wav|wave|flac|ogg|oga|mp3|m4a|aif|aiff)$/i;

  /** Files a picker or a drop gave: true when they include a SoundFont or an SFZ. */
  function isSamplerSet(files) {
    return Array.from(files || []).some((f) => SOUND_FILE.test(f.name));
  }

  async function keep(id, name, bytes, type) {
    memFiles.set(id, { id, name, bytes });
    const ok = storeFile ? await storeFile(id, name, bytes, type) : false;
    if (ok) memFiles.delete(id);
    return ok;
  }

  /**
   * Stores a SoundFont, or an SFZ with its samples, and returns the sampler patch for it.
   * SFZ samples are matched by their path from the .sfz, else by file name.
   */
  async function importSamplerFiles(files) {
    const all = Array.from(files || []);
    const sf2 = all.find((f) => /\.sf2$/i.test(f.name));
    const sfz = all.find((f) => /\.sfz$/i.test(f.name));
    if (!sf2 && !sfz) throw new Error("Choose a SoundFont (.sf2) or an SFZ (.sfz) file");
    const patch = samplerDefault();
    if (sf2) {
      if (sf2.size > 400 * 1024 * 1024) throw new Error("This SoundFont is larger than 400 MB, too big to play in a browser");
      const bytes = await sf2.arrayBuffer();
      const { parseSf2 } = await import("./sampler/sf2.js?v=1");
      const sf = parseSf2(bytes); // throws a readable message for a damaged file
      const id = nextId("sf2");
      await keep(id, sf2.name, bytes, "audio/x-soundfont");
      patch.source = { kind: "sf2", fileId: id, fileName: sf2.name };
      patch.name = sf.presets[0] ? sf.presets[0].name : sf2.name.replace(/\.sf2$/i, "");
      return { patch, label: sf2.name.replace(/\.sf2$/i, ""), presets: sf.presets.length };
    }
    const text = await sfz.text();
    const { parseSfz, samplePath } = await import("./sampler/sfz.js?v=1");
    const { regions } = parseSfz(text);
    const sfzDir = (sfz.webkitRelativePath || "").split("/").slice(0, -1).join("/");
    const rel = (f) => {
      const p = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
      return sfzDir && p.startsWith(`${sfzDir}/`) ? p.slice(sfzDir.length + 1) : p;
    };
    const audio = all.filter((f) => AUDIO_FILE.test(f.name));
    const byPath = new Map(audio.map((f) => [rel(f).toLowerCase(), f]));
    const byBase = new Map(audio.map((f) => [f.name.toLowerCase(), f]));
    const wanted = Array.from(new Set(regions.map(samplePath).filter(Boolean)));
    const filesMap = {};
    let found = 0;
    for (const path of wanted) {
      const f = byPath.get(path.toLowerCase()) || byBase.get(path.split("/").pop().toLowerCase());
      if (!f) continue;
      const id = nextId("sfzs");
      await keep(id, f.name, await f.arrayBuffer(), f.type || "audio/wav");
      filesMap[path] = id;
      found++;
    }
    const id = nextId("sfz");
    await keep(id, sfz.name, new TextEncoder().encode(text).buffer, "text/plain");
    patch.source = { kind: "sfz", fileId: id, fileName: sfz.name, files: filesMap };
    patch.name = sfz.name.replace(/\.sfz$/i, "");
    return { patch, label: patch.name, samples: found, wanted: wanted.length };
  }

  /** Picks a SoundFont / SFZ (and samples) and makes a Sampler channel from it. */
  async function addSampler(files = null, { folder = false } = {}) {
    let chosen = files;
    if (!chosen) {
      if (!pickFiles) return null;
      chosen = await pickFiles(folder ? null : ".sf2,.sfz,audio/*,.wav,.flac,.ogg", { multiple: true, folder });
      if (!chosen || !chosen.length) return null;
    }
    setStatus("Loading the sound…");
    let made;
    try {
      made = await importSamplerFiles(chosen);
    } catch (err) {
      setStatus(err.message, { kind: "error" });
      return null;
    }
    const inst = await addInstrument("sampler", { patch: made.patch, name: made.label });
    if (inst && made.wanted && made.samples < made.wanted) {
      setStatus(`${made.wanted - made.samples} of ${made.wanted} samples were not chosen. In the Sampler, use Load folder and pick the instrument's folder.`, { kind: "error" });
    }
    return inst;
  }

  /** The Sampler window's Load buttons: a new sound for an existing channel. */
  async function reloadSampler(instId, { folder = false } = {}) {
    const inst = byId(instId);
    if (!inst || !pickFiles) return false;
    const chosen = await pickFiles(folder ? null : ".sf2,.sfz,audio/*,.wav,.flac,.ogg", { multiple: true, folder });
    if (!chosen || !chosen.length) return false;
    let made;
    try {
      made = await importSamplerFiles(chosen);
    } catch (err) {
      setStatus(err.message, { kind: "error" });
      return false;
    }
    pushUndoState();
    inst.patch = sanitizeSampler(Object.assign({}, inst.patch, { source: made.patch.source, name: made.patch.name, preset: 0 }));
    const rec = live.get(inst.id);
    if (rec) {
      rec.synth.setPatch(inst.patch);
      rec.patchRef = inst.patch;
    }
    refreshPreview(inst);
    onMutated(`Sampler "${inst.name}" now plays ${made.label}`);
    return true;
  }

  async function addInstrument(type = "mammoth", opts = {}) {
    const def = findStockInstrument(type);
    if (!def) return null;
    if (list().length >= MAX_INSTRUMENTS) {
      setStatus(`A project can hold up to ${MAX_INSTRUMENTS} synth channels.`, { kind: "error" });
      return null;
    }
    // A Sampler starts from a file the person chooses.
    if (type === "sampler" && !opts.patch) return addSampler();
    engine.ensureContext();
    let presetsM;
    try {
      [, presetsM] = await Promise.all([host(type), presets(type)]);
    } catch (err) {
      setStatus(`The synth could not be loaded: ${err.message}`, { kind: "error" });
      return null;
    }
    pushUndoState();
    const start = opts.patch || presetsM.list.find((p) => p.name === presetsM.start) || presetsM.list[0];
    const base = opts.name ? String(opts.name).slice(0, 40) : def.channelName;
    const inst = {
      id: nextId("inst"),
      type,
      name: opts.name ? base : `${base} ${nextNumber(base)}`,
      color: def.color,
      assetId: nextId("synth"),
      root: type === "sampler" ? 60 : 72,
      patch: driverOf(type).clone(start),
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
    let openFn;
    try {
      [hostM, openFn] = await Promise.all([host(inst.type), editorModule(inst.type)]);
    } catch (err) {
      setStatus(`The synth editor could not be loaded: ${err.message}`, { kind: "error" });
      return;
    }
    const id = inst.id;
    const driver = driverOf(inst.type);
    let dirty = false;
    // One editor window is open at a time: another synth's window closes first.
    if (editor && editor.isOpen() && editor.openedWith !== openFn) editor.close();
    editor = openFn({
      instrumentId: id,
      getInstrument: () => byId(id),
      live: () => {
        const i = byId(id);
        return i ? liveFor(i) : null;
      },
      liveSupported: hostM.supported(engine.ensureContext()),
      ensureAudio: () => engine.ensureContext(),
      replacePatch: (patch) => {
        const i = byId(id);
        if (!i) return;
        i.patch = driver.sanitize(patch);
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
      // Sampler: load another SoundFont / SFZ file or folder into this channel.
      loadFiles: (opts) => reloadSampler(id, opts),
      loadBank: (source) => (hostM.engine ? hostM.engine.loadBank(source) : Promise.reject(new Error("No sampler"))),
      onClose: () => {
        const i = byId(id);
        if (dirty && i) refreshPreview(i);
        dirty = false;
      },
    });
    editor.openedWith = openFn;
    // The window dims what is behind it, like the studio's other panels.
    if (watchPanel && editor.element && !watched.has(editor.element)) {
      watched.add(editor.element);
      const ed = editor;
      watchPanel(editor.element, { close: () => ed.close() });
    }
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
    host("mammoth").catch(() => {});
  }

  return {
    STOCK_INSTRUMENTS,
    isInstrumentAsset: (asset) => !!(asset && asset.instrumentId),
    isRenderAsset: (asset) => !!(asset && asset.renderOf),
    instrumentForAsset: forAsset,
    count: () => list().length,
    addInstrument,
    addSampler,
    isSamplerSet,
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
