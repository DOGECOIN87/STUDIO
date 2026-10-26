/**
 * Track LFO: a low-frequency wave, locked to the tempo, that moves one track
 * setting (volume or pan) up and down while the song plays.
 *
 * The wave is a short looped buffer played through a gain node into the
 * target AudioParam, so it runs on the audio clock, stays in time with the
 * clips and renders identically in the offline export.
 */

export const LFO_TARGETS = [
  { id: "volume", label: "Volume" },
  { id: "pan", label: "Pan" },
];

export const LFO_SHAPES = [
  { id: "sine", label: "Sine" },
  { id: "triangle", label: "Triangle" },
  { id: "square", label: "Square" },
  { id: "rampUp", label: "Ramp up" },
  { id: "rampDown", label: "Ramp down" },
];

/** Cycle lengths in beats, shortest first. */
export const LFO_RATES = [
  { beats: 0.25, label: "1/16" },
  { beats: 0.5, label: "1/8" },
  { beats: 1, label: "1/4" },
  { beats: 2, label: "1/2" },
  { beats: 4, label: "1 bar" },
  { beats: 8, label: "2 bars" },
  { beats: 16, label: "4 bars" },
];

export const LFO_DEFAULT = { target: "volume", shape: "sine", beats: 1, depth: 0.5 };

const TABLE_SIZE = 4096;

/** Returns a clean LFO setting, or undefined when the value is unusable. */
export function sanitizeLfo(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  if (!LFO_TARGETS.some((t) => t.id === raw.target)) return undefined;
  const shape = LFO_SHAPES.some((s) => s.id === raw.shape) ? raw.shape : LFO_DEFAULT.shape;
  const beats = LFO_RATES.some((r) => r.beats === raw.beats) ? raw.beats : LFO_DEFAULT.beats;
  const depth = Number.isFinite(raw.depth) ? Math.max(0, Math.min(1, raw.depth)) : LFO_DEFAULT.depth;
  return { target: raw.target, shape, beats, depth };
}

/**
 * One cycle of the wave, from -1 to 1. Hard edges (square, ramp resets) get a
 * short slope of about `edgeSec` so the volume target does not click.
 */
function buildTable(shape, cycleSec) {
  const t = new Float32Array(TABLE_SIZE);
  const edge = Math.min(0.08, Math.max(0.002, 0.004 / cycleSec));
  for (let i = 0; i < TABLE_SIZE; i++) {
    const p = i / TABLE_SIZE;
    let v;
    switch (shape) {
      case "triangle":
        v = p < 0.5 ? 1 - 4 * p : -3 + 4 * p;
        break;
      case "square":
        if (p < edge / 2) v = p / (edge / 2);
        else if (p < 0.5 - edge / 2) v = 1;
        else if (p < 0.5 + edge / 2) v = 1 - 2 * (p - (0.5 - edge / 2)) / edge;
        else if (p < 1 - edge / 2) v = -1;
        else v = -1 + (p - (1 - edge / 2)) / (edge / 2);
        break;
      case "rampUp":
        v = p < 1 - edge ? -1 + 2 * p / (1 - edge) : 1 - 2 * (p - (1 - edge)) / edge;
        break;
      case "rampDown":
        v = p < 1 - edge ? 1 - 2 * p / (1 - edge) : -1 + 2 * (p - (1 - edge)) / edge;
        break;
      default:
        v = Math.cos(2 * Math.PI * p);
    }
    t[i] = v;
  }
  return t;
}

/**
 * Starts a track's LFO on its nodes. `startBeat` is the song position heard at
 * ctx time `when`, so the wave lines up with the bar grid wherever play starts.
 * Returns the source to stop later, or null when the track has no LFO.
 *
 * Volume moves `nodes.mod.gain` between 1 - depth and 1; pan adds up to
 * ±depth to the track's own pan.
 */
export function startTrackLfo(ctx, nodes, lfo, bpm, startBeat, when) {
  if (!lfo || !nodes || !(lfo.depth > 0)) return null;
  const param = lfo.target === "volume" ? nodes.mod && nodes.mod.gain : nodes.pan && nodes.pan.pan;
  if (!param) return null;

  const cycleSec = lfo.beats * (60 / bpm);
  const buffer = ctx.createBuffer(1, TABLE_SIZE, ctx.sampleRate);
  buffer.getChannelData(0).set(buildTable(lfo.shape, cycleSec));
  const tableSec = TABLE_SIZE / ctx.sampleRate;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = tableSec / cycleSec;
  const amount = ctx.createGain();
  amount.gain.value = lfo.target === "volume" ? lfo.depth / 2 : lfo.depth;
  src.connect(amount);
  amount.connect(param);

  if (lfo.target === "volume") {
    param.cancelScheduledValues(when);
    param.setValueAtTime(1 - lfo.depth / 2, when);
  }
  const phase = (((startBeat / lfo.beats) % 1) + 1) % 1;
  src.start(when, phase * tableSec);
  return { source: src, amount };
}

/** Stops an LFO started by startTrackLfo and puts the volume back to full. */
export function stopTrackLfo(ctx, nodes, handle) {
  if (!handle) return;
  try {
    handle.source.stop();
    handle.source.disconnect();
    handle.amount.disconnect();
  } catch (_) {}
  if (nodes && nodes.mod && ctx) {
    nodes.mod.gain.cancelScheduledValues(ctx.currentTime);
    nodes.mod.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
  }
}
