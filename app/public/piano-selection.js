/**
 * STUDIO — Piano Roll note selection (pure functions, no DOM).
 *
 * The selection itself is a Set of note ids, kept by the controller; everything that
 * reads or changes the notes in it lives here so it can be tested in Node. Notes are
 * `{ id, startStep, lenSteps, vel, midi }`; pitch goes through `io.getMidi(n)` /
 * `io.setMidi(n, midi)` because older projects store a legacy `row`, and new notes get
 * their id from `io.newId()`.
 *
 * A function never mutates the note list or the selection it is handed. The one
 * exception is documented per function (`selectBy` returns picks, `copySelection`
 * returns a clipboard, `pasteClipboard` returns new notes); the caller applies them
 * after it has pushed an undo state.
 */

export const VEL_MIN = 0.1;
export const VEL_MAX = 1;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Span of a set of notes: first start, last end, lowest and highest pitch. */
export function bounds(notes, io) {
  if (!notes || !notes.length) return null;
  let start = Infinity;
  let end = -Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    start = Math.min(start, n.startStep);
    end = Math.max(end, n.startStep + Math.max(1, n.lenSteps));
    const m = io.getMidi(n);
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  return { start, end, lo, hi };
}

/**
 * The largest move in steps and semitones that keeps the block inside the pattern and
 * the keyboard, so a selection keeps its shape instead of piling up at an edge.
 */
export function clampDelta(notes, io, dStep, dMidi, limits = {}) {
  const b = bounds(notes, io);
  if (!b) return { dStep: 0, dMidi: 0 };
  const total = Number.isFinite(limits.total) ? limits.total : Infinity;
  const low = Number.isFinite(limits.low) ? limits.low : 0;
  const high = Number.isFinite(limits.high) ? limits.high : 127;
  const step = Math.round(dStep) || 0;
  const semi = Math.round(dMidi) || 0;
  return {
    dStep: clamp(step, -b.start, Math.max(-b.start, total - b.end)),
    dMidi: clamp(semi, low - b.lo, high - b.hi),
  };
}

/** Notes that overlap a grid rectangle, in canvas pixels. */
export function notesInRect(notes, io, rect, geo) {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);
  const minWidth = geo.minWidth || 6;
  return (notes || []).filter((n) => {
    const nx = geo.xOfStep(n.startStep);
    const nw = Math.max(minWidth, n.lenSteps * geo.stepW - 1);
    const ny = geo.yOfMidi(io.getMidi(n));
    return nx < right && nx + nw > left && ny < bottom && ny + geo.rowH > top;
  });
}

/** The note under a grid point, top-most first. The end step belongs to the next cell. */
export function noteAt(notes, io, midi, step) {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (io.getMidi(n) !== midi) continue;
    if (step >= n.startStep && step < n.startStep + Math.max(1, n.lenSteps)) return n;
  }
  return null;
}

/** The note whose start is closest to `step`, within `tolerance` steps (velocity lane). */
export function nearestNote(notes, step, tolerance = 1.2) {
  let best = null;
  let bestD = Infinity;
  for (const n of notes || []) {
    const d = Math.abs(n.startStep - step);
    if (d > tolerance) continue;
    if (d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

/**
 * The notes a velocity drag moves: the whole selection when the note under the pointer
 * is part of it, otherwise just that note.
 */
export function velocityGroup(notes, hit, selection) {
  if (!hit) return [];
  const sel = selection instanceof Set ? selection : new Set(selection || []);
  if (sel.has(hit.id) && sel.size > 1) return (notes || []).filter((n) => sel.has(n.id));
  return [hit];
}

/** A velocity clamped to the lane's audible range (0 means silent, so it is never 0). */
export function clampVelocity(v) {
  const n = Number.isFinite(v) ? v : 0.85;
  return clamp(Math.round(n * 1000) / 1000, VEL_MIN, VEL_MAX);
}

/**
 * One "Select…" command. Returns the picked notes, `null` when the command needs a
 * starting note that is not there (Same pitch), or `undefined` for an unknown command.
 *
 * kinds: all | none | invert | onbeat | offbeat | loud | quiet | random | pitch | overlap
 * opts:  { beat, rng } — `beat` is the step group (4 in 4/4), `rng` a seeded generator.
 */
export function selectBy(notes, io, selection, kind, opts = {}) {
  const all = Array.from(notes || []);
  const sel = selection instanceof Set ? selection : new Set(selection || []);
  const beat = Math.max(1, Math.round(opts.beat || 4));
  switch (kind) {
    case "all":
      return all;
    case "none":
      return [];
    case "invert":
      return all.filter((n) => !sel.has(n.id));
    case "onbeat":
      return all.filter((n) => n.startStep % beat === 0);
    case "offbeat":
      return all.filter((n) => n.startStep % beat !== 0);
    case "loud":
    case "quiet": {
      // Stable sort, so equal velocities keep the pattern's own order and the same
      // command twice in a row picks the same notes.
      const byVel = all.slice().sort((a, b) => (b.vel ?? 0.85) - (a.vel ?? 0.85));
      const half = Math.max(1, Math.round(all.length / 2));
      return kind === "loud" ? byVel.slice(0, half) : byVel.slice(-half);
    }
    case "random": {
      const rng = opts.rng || Math.random;
      return all.filter(() => rng() < 0.5);
    }
    case "pitch": {
      const pitches = new Set(all.filter((n) => sel.has(n.id)).map((n) => io.getMidi(n)));
      if (!pitches.size) return null;
      return all.filter((n) => pitches.has(io.getMidi(n)));
    }
    case "overlap":
      return all.filter((a) =>
        all.some(
          (b) =>
            b !== a &&
            io.getMidi(b) === io.getMidi(a) &&
            b.startStep < a.startStep + Math.max(1, a.lenSteps) &&
            a.startStep < b.startStep + Math.max(1, b.lenSteps)
        )
      );
    default:
      return undefined;
  }
}

/**
 * Copies notes as plain data relative to the first one's step, so a paste lands where it
 * is asked to and not where it came from. Returns `null` for an empty selection.
 */
export function copySelection(notes, io, selection) {
  const sel = selection instanceof Set ? selection : new Set(selection || []);
  const picked = (notes || []).filter((n) => sel.has(n.id));
  if (!picked.length) return null;
  const b = bounds(picked, io);
  return {
    notes: picked.map((n) => ({
      offset: n.startStep - b.start,
      lenSteps: Math.max(1, n.lenSteps),
      vel: n.vel ?? 0.85,
      midi: io.getMidi(n),
    })),
    span: b.end - b.start,
    from: b.start,
  };
}

/** New notes for a clipboard pasted at `startStep`; anything past the pattern's end is left out. */
export function pasteClipboard(clip, startStep, io, opts = {}) {
  if (!clip || !Array.isArray(clip.notes) || !clip.notes.length) return [];
  const total = Number.isFinite(opts.total) ? opts.total : Infinity;
  const at = Number.isFinite(startStep) ? Math.round(startStep) : 0;
  const out = [];
  for (const c of clip.notes) {
    const start = at + c.offset;
    if (start < 0 || start >= total) continue;
    const n = {
      id: io.newId(),
      startStep: start,
      lenSteps: Math.max(1, Math.min(Math.max(1, c.lenSteps), total - start)),
      vel: Number.isFinite(c.vel) ? c.vel : 0.85,
    };
    io.setMidi(n, c.midi);
    out.push(n);
  }
  return out;
}
