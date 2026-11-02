/**
 * STUDIO — Piano Roll note tools (pure functions, no DOM).
 *
 * Ported from LYNX SHARE's NoteTools (C++, AGPL-3.0) to STUDIO's step-based
 * notes: { startStep, lenSteps, vel, midi }. Every tool takes the note list
 * and returns a NEW list (the caller swaps it in after pushing an undo state),
 * so nothing is half-edited if a tool bails out.
 *
 * Pitch is read and written through `io.getMidi(n)` / `io.setMidi(n, midi)`
 * because older projects store a legacy `row` instead of `midi`; new notes get
 * their id from `io.newId()`.
 */

/** Small deterministic generator, so the same seed gives the same result (tests, undo/redo parity). */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const clone = (n) => ({ ...n });

/** Notes that start on the same step form a chord (LYNX: chordsOf). */
export function chordsOf(notes) {
  const by = new Map();
  for (const n of notes) {
    if (!by.has(n.startStep)) by.set(n.startStep, []);
    by.get(n.startStep).push(n);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

/**
 * Arpeggiate: each chord (and, with octaves > 1, each single note) becomes a run of
 * notes over its length. direction: "up" | "down" | "updown" | "downup".
 */
export function arpeggiate(notes, io, { step = 1, gate = 1, direction = "up", octaves = 1 } = {}) {
  step = Math.max(1, Math.round(step));
  octaves = Math.max(1, Math.min(4, Math.round(octaves)));
  const noteLen = Math.max(1, Math.round(step * Math.min(1, Math.max(0.05, gate))));
  const out = [];
  for (const chord of chordsOf(notes)) {
    if (chord.length < 2 && octaves === 1) {
      chord.forEach((n) => out.push(clone(n)));
      continue;
    }
    const base = chord.slice().sort((a, b) => io.getMidi(a) - io.getMidi(b));
    const span = Math.max(...chord.map((n) => n.lenSteps));
    const run = [];
    for (let o = 0; o < octaves; o++) {
      for (const n of base) {
        const m = io.getMidi(n) + 12 * o;
        if (m <= 127) run.push({ src: n, midi: m });
      }
    }
    const down = run.slice().reverse();
    let seq;
    if (direction === "down") seq = down;
    else if (direction === "updown") seq = run.concat(down.length > 2 ? down.slice(1, -1) : []);
    else if (direction === "downup") seq = down.concat(run.length > 2 ? run.slice(1, -1) : []);
    else seq = run;
    if (!seq.length) continue;
    const start = chord[0].startStep;
    for (let t = 0, k = 0; t < span; t += step, k++) {
      const pick = seq[k % seq.length];
      const n = { ...pick.src, id: io.newId(), startStep: start + t, lenSteps: Math.min(noteLen, span - t) };
      io.setMidi(n, pick.midi);
      out.push(n);
    }
  }
  return out;
}

/** Flip: horizontal mirrors the notes in time inside their span; vertical mirrors pitches around the middle of their range. */
export function flip(notes, io, { horizontal = false, vertical = false } = {}) {
  if (!notes.length) return [];
  const from = Math.min(...notes.map((n) => n.startStep));
  const to = Math.max(...notes.map((n) => n.startStep + n.lenSteps));
  const lo = Math.min(...notes.map((n) => io.getMidi(n)));
  const hi = Math.max(...notes.map((n) => io.getMidi(n)));
  return notes.map((src) => {
    const n = clone(src);
    if (horizontal) n.startStep = from + (to - (src.startStep + src.lenSteps));
    if (vertical) io.setMidi(n, lo + hi - io.getMidi(src));
    return n;
  });
}

/**
 * Humanize: musical irregularities on a step grid. Velocity varies on a triangular
 * spread (most notes move a little), off-beat notes get a bit softer, and lengths
 * vary by up to `length` (relative, never under one step). Notes of one chord keep
 * the same velocity offset so chords stay balanced.
 */
export function humanize(notes, { velocity = 0.12, length = 0, softerOffbeats = true, seed = 1, stepsPerBeat = 4 } = {}) {
  const rand = rng(seed);
  const bip = () => rand() * 2 - 1;
  const chordShift = new Map();
  return notes.map((src) => {
    const n = clone(src);
    let rv = chordShift.get(n.startStep);
    if (rv === undefined) {
      rv = (bip() + bip()) * 0.5;
      chordShift.set(n.startStep, rv);
    }
    let v = (n.vel ?? 0.85) + velocity * rv;
    if (softerOffbeats && n.startStep % stepsPerBeat !== 0) v -= velocity * 0.5;
    n.vel = Math.round(Math.min(1, Math.max(0.05, v)) * 100) / 100;
    if (length > 0) n.lenSteps = Math.max(1, Math.round(n.lenSteps * (1 + length * bip())));
    return n;
  });
}

/** Legato: every note lasts until the next note start (chords move together); the last ones keep their length. */
export function legato(notes, { total = Infinity } = {}) {
  const starts = [...new Set(notes.map((n) => n.startStep))].sort((a, b) => a - b);
  return notes.map((src) => {
    const n = clone(src);
    const next = starts.find((s) => s > n.startStep);
    if (next !== undefined) n.lenSteps = next - n.startStep;
    n.lenSteps = Math.max(1, Math.min(n.lenSteps, total - n.startStep));
    return n;
  });
}

/** Nearest pitch in the scale (ties go down), as LYNX's snapToScale. `scale` = semitone offsets from the root. */
export function snapToScale(midi, root, scale) {
  const ok = (m) => scale.includes((((m - root) % 12) + 12) % 12);
  for (let d = 0; d < 12; d++) {
    if (ok(midi - d)) return midi - d;
    if (ok(midi + d)) return midi + d;
  }
  return midi;
}

export function snapNotesToScale(notes, io, root, scale) {
  return notes.map((src) => {
    const n = clone(src);
    io.setMidi(n, snapToScale(io.getMidi(src), root, scale));
    return n;
  });
}

/** Note repeat: each note becomes repeats every `rate` steps over its length, the velocity decaying each time. */
export function repeatNotes(notes, io, { rate = 1, gate = 0.5, decay = 0.9, pitchStep = 0 } = {}) {
  rate = Math.max(1, Math.round(rate));
  const len = Math.max(1, Math.round(rate * Math.min(1, Math.max(0.05, gate))));
  const out = [];
  for (const src of notes) {
    const end = src.startStep + src.lenSteps;
    let vel = src.vel ?? 0.85;
    const first = clone(src);
    first.lenSteps = Math.min(len, src.lenSteps);
    out.push(first);
    for (let t = src.startStep + rate, k = 1; t < end; t += rate, k++) {
      vel *= decay;
      const n = { ...src, id: io.newId(), startStep: t, lenSteps: Math.min(len, end - t), vel: Math.max(0.05, Math.round(vel * 100) / 100) };
      if (pitchStep) io.setMidi(n, io.getMidi(src) + pitchStep * k);
      out.push(n);
    }
  }
  return out;
}

/** Euclidean rhythm (Bresenham form of Bjorklund): true when `step` is a hit. */
export function euclideanHit(steps, pulses, rotation, step) {
  if (steps <= 0 || pulses <= 0) return false;
  pulses = Math.min(pulses, steps);
  const s = (((step + rotation) % steps) + steps) % steps;
  return (s * pulses) % steps < pulses;
}

/** Writes a Euclidean rhythm of `pulses` hits over `steps` steps, repeated over `total` steps, on `midi`. */
export function euclidean(io, { steps = 16, pulses = 5, rotation = 0, total = 16, midi = 60, velocity = 0.8, accent = 0.15 } = {}) {
  const out = [];
  let first = true;
  for (let s = 0; s < total; s++) {
    if (s % Math.max(1, steps) === 0) first = true;
    if (!euclideanHit(steps, pulses, rotation, s)) continue;
    const n = { id: io.newId(), startStep: s, lenSteps: 1, vel: Math.min(1, velocity + (first ? accent : 0)) };
    io.setMidi(n, midi);
    out.push(n);
    first = false;
  }
  return out;
}
