/**
 * STUDIO — Standard MIDI File (SMF) reader and writer. Zero dependencies.
 *
 * Read (`parseSmf`) accepts format 0 and format 1 (format 2 is reported and
 * read as if it were format 1). It returns plain data — tracks, channels,
 * notes with absolute ticks, tempo changes and warnings — so the app can map
 * notes onto patterns without the codec touching the project.
 *
 * Write (`buildSmf`) produces a format 1 file: one SMF track per Audius track
 * (or per loose pattern), tempo from the project BPM, 480 ticks per beat,
 * 16th-note positions preserved exactly.
 *
 * Robustness rules (each one is exercised by tools/test-midi-codec.mjs):
 *  - empty / short / non-SMF input throws a `MidiCodecError` with a readable message;
 *  - a truncated track returns what was read plus a warning, never throws;
 *  - running status, SysEx, meta events and real-time bytes are handled;
 *  - a note-off without a note-on is ignored and counted;
 *  - 32-bit tempo values are clamped to the 20–260 BPM range and reported;
 *  - more channels than the caller allows are counted, not silently dropped.
 */

export const MIDI_PPQ = 480;
export const MAX_MIDI_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_PARTS = 10;
export const BPM_MIN = 20;
export const BPM_MAX = 260;

export class MidiCodecError extends Error {
  constructor(message, code = "invalid") {
    super(message);
    this.name = "MidiCodecError";
    this.code = code;
  }
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiNoteNameOf(note) {
  const n = Math.round(Number(note));
  if (!Number.isFinite(n) || n < 0 || n > 127) return "--";
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export const clampBpm = (bpm) => Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));

/* ------------------------------------------------------------------ */
/* Reader                                                              */
/* ------------------------------------------------------------------ */

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }

  get remaining() {
    return this.bytes.length - this.pos;
  }

  /** Reads n bytes; throws MidiCodecError if the file ends first. */
  take(n) {
    if (this.pos + n > this.bytes.length) {
      throw new MidiCodecError("The file ends in the middle of an event.", "truncated");
    }
    const start = this.pos;
    this.pos += n;
    return this.bytes.subarray(start, this.pos);
  }

  u8() {
    return this.take(1)[0];
  }

  u16() {
    const b = this.take(2);
    return (b[0] << 8) | b[1];
  }

  u32() {
    const b = this.take(4);
    return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  }

  ascii(n) {
    const b = this.take(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  /** Skips n bytes, stopping at the end of the file (a truncated tail is not fatal). */
  skip(n) {
    this.pos = Math.min(this.bytes.length, this.pos + Math.max(0, n));
  }
}

/** Variable-length quantity: 7 bits per byte, MSB set on every byte but the last. */
function readVlq(reader) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const byte = reader.u8();
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  return value;
}

function readText(reader, length) {
  const start = reader.pos;
  const bytes = reader.take(Math.min(length, reader.remaining));
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  reader.pos = Math.max(reader.pos, Math.min(start + length, reader.bytes.length));
  return text;
}

/**
 * Parses a Standard MIDI File.
 *
 * @param {ArrayBuffer|Uint8Array} input
 * @param {{maxBytes?: number}} options
 */
export function parseSmf(input, { maxBytes = MAX_MIDI_FILE_BYTES } = {}) {
  let bytes;
  if (input instanceof Uint8Array) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (input && input.buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength ?? input.length);
  } else {
    throw new MidiCodecError("No file data was provided.", "empty");
  }

  if (bytes.length === 0) throw new MidiCodecError("The file is empty (0 bytes).", "empty");
  if (bytes.length > maxBytes) {
    throw new MidiCodecError(
      `The file is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${Math.round(maxBytes / 1048576)} MB.`,
      "too-large"
    );
  }

  const reader = new Reader(bytes);
  const warnings = [];

  // --- header chunk ---
  let id;
  try {
    id = reader.ascii(4);
  } catch (_) {
    throw new MidiCodecError("The file is too short to be a MIDI file.", "short");
  }
  if (id !== "MThd") {
    throw new MidiCodecError("This is not a Standard MIDI File (missing MThd header).", "not-midi");
  }
  let headerLength = 0;
  try {
    headerLength = reader.u32();
  } catch (_) {
    throw new MidiCodecError("The MIDI header is incomplete.", "bad-header");
  }
  if (headerLength < 6) throw new MidiCodecError("The MIDI header is incomplete.", "bad-header");
  const format = reader.u16();
  const declaredTracks = reader.u16();
  const division = reader.u16();
  reader.skip(headerLength - 6);

  if (format === 2) {
    warnings.push("Format 2 (independent sequences) was read as format 1; only the common timeline is kept.");
  } else if (format > 2) {
    warnings.push(`Unknown SMF format ${format}; read as format 1.`);
  }

  let smpte = false;
  let ppq = division;
  if (division & 0x8000) {
    smpte = true;
    ppq = MIDI_PPQ;
    warnings.push("SMPTE time division is not supported; timing was read as 480 ticks per beat.");
  }
  if (!ppq || ppq < 1 || ppq > 0x7fff) ppq = MIDI_PPQ;

  // --- track chunks ---
  const tracks = [];
  const tempoChanges = [];
  let index = 0;
  let truncated = false;

  while (reader.remaining >= 8) {
    id = reader.ascii(4);
    const length = reader.u32();
    if (id !== "MTrk") {
      warnings.push(`Skipped an unknown chunk "${id.replace(/[^\x20-\x7e]/g, "?")}" (${length} bytes).`);
      reader.skip(length);
      continue;
    }
    const start = reader.pos;
    const result = readTrack(reader, index, warnings, tempoChanges);
    if (result.truncated) {
      truncated = true;
      warnings.push(`Track ${index + 1} is truncated; everything before the cut was read.`);
    }
    // Trust the declared chunk length for the next position, never the event walk.
    const declaredEnd = start + length;
    if (declaredEnd <= bytes.length) reader.pos = declaredEnd;
    else {
      reader.pos = bytes.length;
      truncated = true;
    }
    if (length === 0) warnings.push(`Track ${index + 1} has a zero-length body.`);
    tracks.push({ index, ...result });
    index += 1;
  }

  if (tracks.length === 0) warnings.push("The file has no readable track chunks (header only).");
  if (declaredTracks !== tracks.length) {
    warnings.push(`The header declares ${declaredTracks} track(s); ${tracks.length} were read.`);
  }
  if (truncated) warnings.push("The file is truncated; it was imported up to the cut.");

  // --- tempo ---
  for (const change of tempoChanges) {
    change.bpm = clampBpm(60_000_000 / Math.max(1, change.microseconds));
    const raw = 60_000_000 / Math.max(1, change.microseconds);
    if (raw < BPM_MIN || raw > BPM_MAX) {
      warnings.push(`Tempo ${raw.toFixed(1)} BPM was clamped to ${change.bpm.toFixed(1)} BPM (the ${BPM_MIN}–${BPM_MAX} range).`);
    }
  }
  tempoChanges.sort((a, b) => a.tick - b.tick || a.track - b.track);
  const firstTempo = tempoChanges[0] || null;
  if (tempoChanges.length > 1) {
    warnings.push(`${tempoChanges.length} tempo changes found; version 1 keeps the first tempo.`);
  }

  return {
    format,
    division,
    ppq,
    smpte,
    bpm: firstTempo ? firstTempo.bpm : null,
    tempoChanges,
    tracks,
    warnings,
    bytes: bytes.length,
    truncated,
  };
}

/** Full parser for one MTrk body. Throws MidiCodecError when the body runs out mid-event. */
function readTrack(reader, index, warnings, tempoChanges) {
  const nameMeta = [];
  const channels = new Map();
  const open = new Map(); // "channel:note" -> { tick, velocity, midi }
  let tick = 0;
  let runningStatus = 0;
  let truncated = false;

  const state = (ch) => {
    if (!channels.has(ch)) {
      channels.set(ch, { channel: ch, program: null, notes: [], droppedNoteOffs: 0 });
    }
    return channels.get(ch);
  };
  const close = (key, atTick) => {
    const prev = open.get(key);
    if (!prev) return false;
    open.delete(key);
    const ch = Number(key.split(":")[0]);
    state(ch).notes.push({
      tick: prev.tick,
      durationTicks: Math.max(1, atTick - prev.tick),
      midi: prev.midi,
      velocity: prev.velocity,
      channel: ch,
    });
    return true;
  };

  for (;;) {
    try {
      tick += readVlq(reader);
    } catch (err) {
      if (!(err instanceof MidiCodecError)) throw err;
      warnings.push(`Track ${index + 1} ends in the middle of a delta time.`);
      truncated = true;
      break;
    }
    let status;
    try {
      status = reader.u8();
    } catch (err) {
      if (!(err instanceof MidiCodecError)) throw err;
      warnings.push(`Track ${index + 1} ends in the middle of an event.`);
      truncated = true;
      break;
    }

    if (status < 0x80) {
      if (!runningStatus) {
        warnings.push(`Track ${index + 1}: a data byte appeared with no running status and was skipped.`);
        continue;
      }
      reader.pos -= 1;
      status = runningStatus;
    } else if (status < 0xf0) {
      runningStatus = status;
    }

    if (status === 0xff) {
      const type = reader.u8();
      const length = readVlq(reader);
      if (type === 0x2f) break; // end of track
      if (type === 0x03) {
        const text = readText(reader, length).trim();
        if (text) nameMeta.push(text);
        continue;
      }
      if (type === 0x51) {
        const start = reader.pos;
        const payload = reader.take(Math.min(length, reader.remaining));
        if (payload.length >= 3) {
          const micros = (payload[0] << 16) | (payload[1] << 8) | payload[2];
          // 24-bit microseconds per quarter note; 0 is meaningless and is ignored.
          if (micros > 0) tempoChanges.push({ tick, microseconds: micros, track: index });
        }
        reader.pos = Math.max(reader.pos, Math.min(start + length, reader.bytes.length));
        continue;
      }
      reader.skip(length);
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      reader.skip(readVlq(reader));
      continue;
    }

    const hi = status & 0xf0;
    const ch = status & 0x0f;

    if (hi === 0x80 || hi === 0x90) {
      let note;
      let velocity;
      try {
        note = reader.u8() & 0x7f;
        velocity = reader.u8() & 0x7f;
      } catch (err) {
        if (!(err instanceof MidiCodecError)) throw err;
        warnings.push(`Track ${index + 1} ends in the middle of a note event.`);
        truncated = true;
        break;
      }
      const key = `${ch}:${note}`;
      if (hi === 0x90 && velocity > 0) {
        // A repeated note-on without a note-off closes the previous one here.
        close(key, tick);
        open.set(key, { tick, velocity, midi: note });
        state(ch);
      } else if (!close(key, tick)) {
        state(ch).droppedNoteOffs += 1;
      }
      continue;
    }
    if (hi === 0xa0) {
      reader.skip(2);
      continue;
    }
    if (hi === 0xb0) {
      reader.skip(2);
      continue;
    }
    if (hi === 0xc0) {
      let program;
      try {
        program = reader.u8() & 0x7f;
      } catch (err) {
        if (!(err instanceof MidiCodecError)) throw err;
        truncated = true;
        break;
      }
      const s = state(ch);
      if (s.program === null) s.program = program;
      continue;
    }
    if (hi === 0xd0) {
      reader.skip(1);
      continue;
    }
    if (hi === 0xe0) {
      reader.skip(2);
      continue;
    }
    if (status >= 0xf8) continue; // real-time bytes do not interrupt anything
    warnings.push(`Track ${index + 1}: unsupported status byte 0x${status.toString(16)} (skipped).`);
  }

  // Notes still open at the end of the track are closed at the final tick.
  for (const key of Array.from(open.keys())) close(key, tick);
  for (const s of channels.values()) s.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);

  return {
    name: nameMeta[0] || "",
    channels: Array.from(channels.values()).filter((c) => c.notes.length > 0),
    droppedNoteOffs: Array.from(channels.values()).reduce((n, c) => n + c.droppedNoteOffs, 0),
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* Mapping: SMF -> Audius patterns                                     */
/* ------------------------------------------------------------------ */

/** Piano Roll rows, top to bottom: E5 (semi +4) down to C4 (semi -12), C5 = 72. */
export const ROW_SEMITONES = [4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12];

/** MIDI note -> nearest Piano Roll row (0 = E5 … 16 = C4). */
export function rowForMidi(midi) {
  const semi = Math.max(-12, Math.min(4, Math.round(Number(midi) - 72)));
  const index = ROW_SEMITONES.indexOf(semi);
  return index >= 0 ? index : 4;
}

/** The pitch a pattern note sounds at: its stored MIDI number, else its row. */
export function noteMidi(note, rows = ROW_SEMITONES) {
  if (note && Number.isFinite(note.midi)) return Math.max(0, Math.min(127, Math.round(note.midi)));
  const semi = rows[note?.row] ?? 0;
  return 72 + semi;
}

/**
 * Turns a parsed SMF into importable parts: one part per SMF track/channel
 * pair that contains notes (format 0 usually has one track and several
 * channels; format 1 usually has one channel per track).
 *
 * Notes are quantized to the pattern's 16th-note grid (0.25 beat) and split
 * into bars of `stepsPerBar` steps (16 in 4/4, 12 in 3/4) — one pattern per bar
 * that has notes. Every note keeps its `midi` number, so export is exact even
 * for pitches outside the roll.
 */
export function smfToParts(smf, { rowFor = rowForMidi, maxParts = MAX_IMPORT_PARTS, stepsPerBar = 16 } = {}) {
  const barSteps = Math.max(1, Math.round(stepsPerBar) || 16);
  const ppq = smf.ppq || MIDI_PPQ;
  const parts = [];
  const warnings = [];
  let skippedChannels = 0;
  let totalNotes = 0;
  let offGrid = 0;
  let outsideRoll = 0;

  for (const track of smf.tracks) {
    for (const ch of track.channels) {
      if (!ch.notes || ch.notes.length === 0) continue;
      if (parts.length >= maxParts) {
        skippedChannels += 1;
        continue;
      }
      const base = (track.name || `Track ${track.index + 1}`).trim();
      const name = ch.channel !== 0 || (track.channels.length === 1 && smf.tracks.length > 1)
        ? base
        : `${base} · Ch ${ch.channel + 1}`;
      const partName = track.channels.length > 1 ? `${base} · Ch ${ch.channel + 1}` : base;

      const bars = new Map(); // barIndex -> notes
      for (const note of ch.notes) {
        const stepExact = (note.tick / ppq) * 4;
        const step = Math.round(stepExact);
        if (Math.abs(stepExact - step) > 0.001) offGrid += 1;
        const barIndex = Math.floor(step / barSteps);
        const startStep = step - barIndex * barSteps;
        if (note.midi < 60 || note.midi > 76) outsideRoll += 1;
        const mapped = {
          row: rowFor(note.midi),
          startStep: Math.max(0, Math.min(barSteps - 1, startStep)),
          lenSteps: Math.max(1, Math.min(barSteps, Math.round((note.durationTicks / ppq) * 4) || 1)),
          vel: Math.max(0.1, Math.min(1, note.velocity / 127)),
          label: midiNoteNameOf(note.midi),
          midi: note.midi,
        };
        if (!bars.has(barIndex)) bars.set(barIndex, []);
        bars.get(barIndex).push(mapped);
      }
      totalNotes += ch.notes.length;

      const barList = Array.from(bars.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([barIndex, notes]) => ({
          barIndex,
          name: `${partName} · Bar ${barIndex + 1}`,
          notes,
        }));

      parts.push({
        name: partName,
        channel: ch.channel,
        program: ch.program,
        smfTrack: track.index,
        bars: barList,
        noteCount: ch.notes.length,
      });
      void name;
    }
  }

  if (offGrid > 0) {
    warnings.push(`${offGrid} note(s) were off the 16th-note grid and were quantized to it.`);
  }
  if (outsideRoll > 0) {
    warnings.push(
      `${outsideRoll} note(s) lie outside the roll's visible C4–E5 range: they sit on the nearest key but keep their real pitch for playback and export.`
    );
  }
  if (skippedChannels > 0) {
    warnings.push(`${skippedChannels} channel(s) beyond the first ${maxParts} were not imported.`);
  }
  return { parts, warnings, skippedChannels, totalNotes, offGrid };
}

/* ------------------------------------------------------------------ */
/* Writer                                                              */
/* ------------------------------------------------------------------ */

function writeVlq(value) {
  const bytes = [Math.max(0, Math.floor(value)) & 0x7f];
  let v = Math.max(0, Math.floor(value)) >>> 7;
  while (v > 0) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes.reverse();
}

function chunk(type, payload) {
  const out = new Uint8Array(8 + payload.length);
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  const len = payload.length;
  out[4] = (len >>> 24) & 0xff;
  out[5] = (len >>> 16) & 0xff;
  out[6] = (len >>> 8) & 0xff;
  out[7] = len & 0xff;
  out.set(payload, 8);
  return out;
}

function textBytes(text, max = 100) {
  const clean = String(text || "").slice(0, max);
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    out.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return [...writeVlq(out.length), ...out];
}

/**
 * Builds a format-1 SMF.
 *
 * @param {{
 *   name?: string, bpm?: number, timeSig?: { num: number, den: number },
 *   tracks: Array<{
 *     name?: string, channel?: number,
 *     notes: Array<{ tick: number, midi: number, velocity?: number, durationTicks?: number, channel?: number }>
 *   }>
 * }} song
 * @returns {Uint8Array}
 */
export function buildSmf(song) {
  const ppq = MIDI_PPQ;
  const bpm = clampBpm(Number(song.bpm) || 120);
  const micros = Math.round(60_000_000 / bpm);
  const tracks = Array.isArray(song.tracks) ? song.tracks : [];

  const header = new Uint8Array(6);
  header[0] = 0;
  header[1] = 1; // format 1
  const trackCount = tracks.length + 1; // + conductor track
  header[2] = (trackCount >> 8) & 0xff;
  header[3] = trackCount & 0xff;
  header[4] = (ppq >> 8) & 0xff;
  header[5] = ppq & 0xff;

  const chunks = [chunk("MThd", header)];

  // Conductor track: project name, tempo, time signature (4/4 unless given).
  // The signature stores the denominator as a power of two and a click every
  // counted beat (24 MIDI clocks per quarter note).
  const sig = song.timeSig || {};
  const sigNum = Math.max(1, Math.min(32, Math.round(Number(sig.num) || 4)));
  const sigDen = [2, 4, 8, 16].includes(Number(sig.den)) ? Number(sig.den) : 4;
  const conductor = [
    0x00, 0xff, 0x03, ...textBytes(song.name || "STUDIO"),
    0x00, 0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff,
    0x00, 0xff, 0x58, 0x04, sigNum, Math.log2(sigDen), (96 / sigDen) | 0, 8,
    0x00, 0xff, 0x2f, 0x00,
  ];
  chunks.push(chunk("MTrk", new Uint8Array(conductor)));

  for (const track of tracks) {
    const channel = Math.max(0, Math.min(15, Number(track.channel ?? 0)));
    const notes = (Array.isArray(track.notes) ? track.notes : [])
      .filter((n) => n && Number.isFinite(n.tick) && Number.isFinite(n.midi))
      .map((n) => ({
        tick: Math.max(0, Math.round(n.tick)),
        midi: Math.max(0, Math.min(127, Math.round(n.midi))),
        velocity: Math.max(1, Math.min(127, Math.round((n.velocity ?? 0.8) * 127))),
        durationTicks: Math.max(1, Math.round(n.durationTicks ?? ppq / 4)),
        channel: Math.max(0, Math.min(15, Number(n.channel ?? channel))),
      }))
      .sort((a, b) => a.tick - b.tick || a.midi - b.midi);

    const events = [];
    events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...textBytes(track.name || "Track")] });
    events.push({ tick: 0, order: 0, bytes: [0xff, 0x04, ...textBytes(`STUDIO · ${track.name || "Track"}`)] });
    for (const n of notes) {
      events.push({ tick: n.tick, order: 1, bytes: [0x90 | n.channel, n.midi, n.velocity] });
      events.push({ tick: n.tick + n.durationTicks, order: 0, bytes: [0x80 | n.channel, n.midi, 0x40] });
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const payload = [];
    let lastTick = 0;
    for (const ev of events) {
      payload.push(...writeVlq(ev.tick - lastTick), ...ev.bytes);
      lastTick = ev.tick;
    }
    payload.push(0x00, 0xff, 0x2f, 0x00);
    chunks.push(chunk("MTrk", new Uint8Array(payload)));
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
