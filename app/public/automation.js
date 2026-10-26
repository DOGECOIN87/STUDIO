/**
 * Automation lanes: a track setting that follows a drawn curve over the song.
 *
 *   project.automation = [{ id, trackId, target, points: [[beat, value], ...] }]
 *
 * `value` is 0..1 for every target; `target` is "volume", "pan" or
 * "fx:<slotId>:<paramId>" (a knob on one of the track's effects). Between two
 * points the value moves in a straight line; before the first point and after
 * the last it holds.
 *
 * Volume runs on its own gain stage (`nodes.auto`), so the fader keeps its
 * meaning; pan drives the track panner; effect knobs are sent to the effect,
 * which follows the curve on the audio clock (wasm-fx-processor.js).
 */

export const MAX_LANES = 64;
export const MAX_POINTS = 2000;

/** Volume lane value (0..1) -> gain; 1 is unity, 0.5 is about -12 dB, 0 is silence. */
export function volumeGain(v) {
  return v * v;
}

/** Pan lane value (0..1) -> pan (-1 left … 1 right). */
export function panValue(v) {
  return v * 2 - 1;
}

/** "fx:slot:param" -> { slotId, paramId }, or null. */
export function parseFxTarget(target) {
  const m = /^fx:([^:]+):(.+)$/.exec(String(target || ""));
  return m ? { slotId: m[1], paramId: m[2] } : null;
}

/** Clean lanes for the tracks that exist; points sorted, clamped and capped. */
export function sanitizeAutomation(raw, trackIds) {
  if (!Array.isArray(raw)) return [];
  const known = new Set(trackIds);
  const seen = new Set();
  const out = [];
  for (const lane of raw.slice(0, MAX_LANES)) {
    if (!lane || typeof lane !== "object" || !known.has(lane.trackId)) continue;
    const target = String(lane.target || "");
    if (target !== "volume" && target !== "pan" && !parseFxTarget(target)) continue;
    const key = `${lane.trackId}|${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const points = (Array.isArray(lane.points) ? lane.points : [])
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .slice(0, MAX_POINTS)
      .map((p) => [Math.max(0, Math.min(100000, p[0])), Math.max(0, Math.min(1, p[1]))])
      .sort((a, b) => a[0] - b[0]);
    out.push({
      id: typeof lane.id === "string" && lane.id ? lane.id.slice(0, 80) : `auto-${out.length + 1}`,
      trackId: lane.trackId,
      target: target.slice(0, 160),
      points,
    });
  }
  return out;
}

/** The lane's value (0..1) at a song position. */
export function laneValueAt(points, beat, fallback = 1) {
  if (!points || !points.length) return fallback;
  if (beat <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (beat >= last[0]) return last[1];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= beat) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b[0] - a[0];
  return span > 0 ? a[1] + (b[1] - a[1]) * ((beat - a[0]) / span) : b[1];
}

/**
 * Schedules a lane on an AudioParam for one pass: the value at `startBeat`
 * lands at ctx time `t0`, then a straight ramp to each later point.
 */
export function scheduleLane(param, points, map, { startBeat, t0, secPerBeat, timeOf }) {
  // `timeOf` (beat -> ctx time) follows tempo changes; without it the tempo is steady.
  const at = timeOf || ((beat) => t0 + (beat - startBeat) * secPerBeat);
  param.cancelScheduledValues(0);
  param.setValueAtTime(map(laneValueAt(points, startBeat)), t0);
  for (const [beat, v] of points) {
    if (beat <= startBeat) continue;
    param.linearRampToValueAtTime(map(v), at(beat));
  }
}

/** An effect knob's lane as audio-clock times for the effect to follow. */
export function laneTimes(points, { startBeat, t0, secPerBeat, timeOf }) {
  const at = timeOf || ((beat) => t0 + (beat - startBeat) * secPerBeat);
  const times = [];
  const values = [];
  times.push(t0);
  values.push(laneValueAt(points, startBeat));
  for (const [beat, v] of points) {
    if (beat <= startBeat) continue;
    times.push(at(beat));
    values.push(v);
  }
  return { times, values };
}

/** Lanes of one track that have points, by kind. */
export function trackLanes(project, trackId) {
  const lanes = (project && project.automation) || [];
  let volume = null;
  let pan = null;
  const fx = [];
  for (const lane of lanes) {
    if (lane.trackId !== trackId || !lane.points || !lane.points.length) continue;
    if (lane.target === "volume") volume = lane;
    else if (lane.target === "pan") pan = lane;
    else {
      const t = parseFxTarget(lane.target);
      if (t) fx.push({ lane, slotId: t.slotId, paramId: t.paramId });
    }
  }
  return { volume, pan, fx };
}
