/**
 * The song's tempo over time: project.bpm from the start, then each entry of
 * project.tempoChanges ([{ beat, bpm }]) from its beat on (steps, not ramps).
 * Every beat <-> seconds conversion in playback, export and recording goes
 * through here, so a song can change tempo partway through.
 */

export const MAX_TEMPO_CHANGES = 64;

/** Clean, sorted tempo changes (after beat 0, 40–260 BPM, one per beat). */
export function sanitizeTempoChanges(raw) {
  if (!Array.isArray(raw)) return [];
  const byBeat = new Map();
  for (const c of raw.slice(0, MAX_TEMPO_CHANGES)) {
    if (!c || !Number.isFinite(c.beat) || !Number.isFinite(c.bpm) || c.beat <= 0) continue;
    byBeat.set(Math.round(c.beat * 1000) / 1000, Math.max(40, Math.min(260, c.bpm)));
  }
  return Array.from(byBeat, ([beat, bpm]) => ({ beat, bpm })).sort((a, b) => a.beat - b.beat);
}

/** A map for one project; cheap to build, so build one per pass or per call. */
export function makeTempoMap(project) {
  const segs = [{ beat: 0, bpm: project.bpm, time: 0 }];
  for (const c of sanitizeTempoChanges(project.tempoChanges)) {
    const prev = segs[segs.length - 1];
    segs.push({ beat: c.beat, bpm: c.bpm, time: prev.time + ((c.beat - prev.beat) * 60) / prev.bpm });
  }
  const segAtBeat = (beat) => {
    let s = segs[0];
    for (let i = 1; i < segs.length && segs[i].beat <= beat; i++) s = segs[i];
    return s;
  };
  const segAtTime = (time) => {
    let s = segs[0];
    for (let i = 1; i < segs.length && segs[i].time <= time; i++) s = segs[i];
    return s;
  };
  return {
    constant: segs.length === 1,
    segments: segs,
    /** Seconds from the song start to `beat`. */
    timeAt(beat) {
      const s = segAtBeat(beat);
      return s.time + ((beat - s.beat) * 60) / s.bpm;
    },
    /** The beat heard `time` seconds after the song start. */
    beatAt(time) {
      const s = segAtTime(time);
      return s.beat + ((time - s.time) * s.bpm) / 60;
    },
    /** The tempo in force at `beat`. */
    bpmAt(beat) {
      return segAtBeat(beat).bpm;
    },
  };
}
