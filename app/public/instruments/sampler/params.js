/**
 * Sampler patch: which SoundFont / SFZ it plays (the file itself is kept in this
 * browser's storage, by id) and how it is played. Plain JSON for undo and project files.
 *   source  { kind: "sf2" | "sfz", fileId, fileName, files?: { samplePath: fileId } }
 *   preset  which SoundFont preset (index into the file's presets)
 *   volume (dB), transpose (semitones), fine (cents), attack / release (seconds; 0 = as the
 *   file sets them), tone (low-pass Hz; 20000 = open), velocity (0..1 sensitivity)
 */
export const RANGES = {
  volume: [-36, 12],
  transpose: [-24, 24],
  fine: [-100, 100],
  attack: [0, 4],
  release: [0, 8],
  tone: [200, 20000],
  velocity: [0, 1],
};

const ID_RE = /^[\w.:-]{1,80}$/;

export function defaultPatch() {
  return { name: "Sampler", source: null, preset: 0, volume: 0, transpose: 0, fine: 0, attack: 0, release: 0, tone: 20000, velocity: 0.8 };
}

const num = (v, [lo, hi], d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.max(lo, Math.min(hi, Number(v))) : d);

function cleanSource(s) {
  if (!s || typeof s !== "object" || (s.kind !== "sf2" && s.kind !== "sfz") || !ID_RE.test(String(s.fileId || ""))) return null;
  const out = { kind: s.kind, fileId: String(s.fileId), fileName: String(s.fileName || "").slice(0, 160) };
  if (s.kind === "sfz") {
    out.files = {};
    let n = 0;
    for (const [path, id] of Object.entries(s.files && typeof s.files === "object" ? s.files : {})) {
      if (n >= 4000) break;
      if (typeof path === "string" && path.length <= 400 && ID_RE.test(String(id))) {
        out.files[path] = String(id);
        n++;
      }
    }
  }
  return out;
}

export function sanitizePatch(raw) {
  const d = defaultPatch();
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    name: String(p.name || d.name).slice(0, 80),
    source: cleanSource(p.source),
    preset: Math.max(0, Math.min(4095, Math.round(Number(p.preset) || 0))),
    volume: num(p.volume, RANGES.volume, d.volume),
    transpose: Math.round(num(p.transpose, RANGES.transpose, d.transpose)),
    fine: num(p.fine, RANGES.fine, d.fine),
    attack: num(p.attack, RANGES.attack, d.attack),
    release: num(p.release, RANGES.release, d.release),
    tone: num(p.tone, RANGES.tone, d.tone),
    velocity: num(p.velocity, RANGES.velocity, d.velocity),
  };
}

export function clonePatch(p) {
  return JSON.parse(JSON.stringify(sanitizePatch(p)));
}
