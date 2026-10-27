/**
 * SFZ reader (the plain-text sampler format; Audius Studio's own code).
 *
 * parseSfz(text) -> { regions: [{ sample, ...opcodes }] }
 * toZones(regions, decoded) -> zones in the same shape as sf2.js makes, where
 *   decoded(samplePath) gives { buffer: AudioBuffer, loop?: {start, end}, unity? } or null.
 * Supported: <control> <global> <master> <group> <region>; sample, default_path, key,
 * lokey/hikey, lovel/hivel, pitch_keycenter, pitch_keytrack, tune, transpose, volume, pan,
 * offset, end, loop_mode, loop_start/loop_end (and loopstart/loopend), ampeg_delay/attack/
 * hold/decay/sustain/release, cutoff, group/off_by, lorand/hirand, trigger (attack only).
 * Note names: c4 = 60.
 */

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function noteValue(v) {
  const s = String(v).trim().toLowerCase();
  if (/^-?\d+$/.test(s)) return Number(s);
  const m = /^([a-g])(#|b)?(-?\d+)$/.exec(s);
  if (!m) return NaN;
  return NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

export function parseSfz(text) {
  // Comments: // to the end of a line, and /* … */ blocks.
  const src = String(text).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  return { regions: resolveScopes(src) };
}

/** Regions with what they inherit from <control>, <global>, <master> and <group>, in document order. */
function resolveScopes(src) {
  const re = /<(\w+)>|([A-Za-z_][\w]*)=/g;
  const tokens = [];
  let m;
  while ((m = re.exec(src))) tokens.push({ m, at: m.index, end: re.lastIndex });
  const levels = { control: {}, global: {}, master: {}, group: {} };
  const out = [];
  let cur = null;
  let inRegion = null;
  const flush = () => {
    if (inRegion) out.push(Object.assign({}, levels.control, levels.global, levels.master, levels.group, inRegion));
    inRegion = null;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.m[1]) {
      flush();
      const h = t.m[1].toLowerCase();
      if (h === "region") {
        inRegion = {};
        cur = inRegion;
      } else if (h in levels) {
        if (h === "control") levels.control = {};
        if (h === "global") (levels.global = {}), (levels.master = {}), (levels.group = {});
        if (h === "master") (levels.master = {}), (levels.group = {});
        if (h === "group") levels.group = {};
        cur = levels[h];
      } else cur = null;
      continue;
    }
    if (!cur) continue;
    const key = t.m[2].toLowerCase();
    const next = tokens[i + 1];
    let value = src.slice(t.end, next ? next.at : src.length);
    value = key === "sample" || key === "default_path" ? value.split(/\r?\n/)[0].trim() : value.trim().split(/\s+/)[0] || "";
    cur[key] = value;
  }
  flush();
  return out;
}

const num = (v, d) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : d;
};

/** The sample path a region names, with default_path applied and slashes made forward. */
export function samplePath(r) {
  const base = String(r.default_path || "").replace(/\\/g, "/");
  return (base + String(r.sample || "")).replace(/\\/g, "/").replace(/^\.\//, "");
}

export function toZones(regions, decoded) {
  const zones = [];
  for (const r of regions) {
    if (!r.sample || (r.trigger && r.trigger !== "attack" && r.trigger !== "first" && r.trigger !== "legato")) continue;
    const d = decoded(samplePath(r));
    if (!d || !d.buffer) continue;
    let lokey = 0;
    let hikey = 127;
    let root = 60;
    if (r.key != null) {
      lokey = hikey = root = noteValue(r.key);
    }
    if (r.lokey != null) lokey = noteValue(r.lokey);
    if (r.hikey != null) hikey = noteValue(r.hikey);
    if (r.pitch_keycenter != null) root = noteValue(r.pitch_keycenter);
    else if (r.key == null && d.unity != null) root = d.unity;
    if (!Number.isFinite(lokey) || !Number.isFinite(hikey) || !Number.isFinite(root)) continue;
    const rate = d.buffer.sampleRate;
    const offset = Math.max(0, num(r.offset, 0));
    const endFrame = r.end != null ? Math.min(d.buffer.length, num(r.end, d.buffer.length) + 1) : d.buffer.length;
    const mode = String(r.loop_mode || r.loopmode || (d.loop ? "loop_continuous" : "no_loop")).toLowerCase();
    const ls = num(r.loop_start != null ? r.loop_start : r.loopstart, d.loop ? d.loop.start : 0);
    const le = num(r.loop_end != null ? r.loop_end : r.loopend, d.loop ? d.loop.end : 0);
    zones.push({
      lokey: Math.max(0, lokey),
      hikey: Math.min(127, hikey),
      lovel: num(r.lovel, 0),
      hivel: num(r.hivel, 127),
      lorand: num(r.lorand, 0),
      hirand: num(r.hirand, 1),
      buffer: d.buffer,
      sample: { name: samplePath(r), rate },
      offset,
      length: Math.max(1, endFrame - offset),
      root,
      tune: num(r.tune, 0) + num(r.transpose, 0) * 100,
      keytrack: num(r.pitch_keytrack, 100),
      loop: mode === "loop_continuous" ? 1 : mode === "loop_sustain" ? 3 : 0,
      oneShot: mode === "one_shot",
      loopStart: ls - offset,
      loopEnd: le - offset,
      delay: num(r.ampeg_delay, 0),
      attack: num(r.ampeg_attack, 0.001),
      hold: num(r.ampeg_hold, 0),
      decay: num(r.ampeg_decay, 0),
      sustain: Math.max(0, Math.min(1, num(r.ampeg_sustain, 100) / 100)),
      release: Math.max(0.005, num(r.ampeg_release, 0.05)),
      gainDb: num(r.volume, 0),
      pan: Math.max(-1, Math.min(1, num(r.pan, 0) / 100)),
      cutoff: num(r.cutoff, 0),
      // group / off_by: a note of group G cuts the voices that are off_by G.
      cutGroup: num(r.group, 0),
      cutBy: num(r.off_by, 0),
    });
  }
  return zones;
}

/** Loop points and root note from a WAV file's 'smpl' chunk, when it has one. */
export function wavSmpl(bytes) {
  try {
    const v = new DataView(bytes);
    if (v.byteLength < 12 || v.getUint32(0, false) !== 0x52494646) return null; // "RIFF"
    let p = 12;
    while (p + 8 <= v.byteLength) {
      const id = v.getUint32(p, false);
      const size = v.getUint32(p + 4, true);
      if (id === 0x736d706c && size >= 36) {
        // "smpl"
        const unity = v.getUint32(p + 8 + 12, true);
        const loops = v.getUint32(p + 8 + 28, true);
        const out = { unity: unity <= 127 ? unity : null };
        if (loops > 0 && size >= 36 + 24) {
          out.loop = { start: v.getUint32(p + 8 + 36 + 8, true), end: v.getUint32(p + 8 + 36 + 12, true) + 1 };
        }
        return out;
      }
      p += 8 + size + (size & 1);
    }
  } catch (_) {}
  return null;
}
