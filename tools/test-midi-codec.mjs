#!/usr/bin/env node
/**
 * Audius Studio — MIDI codec test suite (no browser, no dependencies).
 *
 *   node tools/test-midi-codec.mjs
 *
 * Covers the import edge cases in the Feature B brief (empty, header-only,
 * truncated, 16 channels, one note at tick 0, oversize, non-SMF bytes,
 * 32-bit tempo, note-off without note-on), format 0 and 1 parsing, the
 * 20–260 BPM clamp, and the demo-project export -> import round trip.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSmf,
  buildSmf,
  smfToParts,
  noteMidi,
  rowForMidi,
  MidiCodecError,
  MAX_MIDI_FILE_BYTES,
  MIDI_PPQ,
} from "../app/public/midi-codec.js";
import { DEMO_SONG } from "../app/public/demo-song.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`✓ ${m}`); };
const bad = (m) => { fail++; console.log(`✗ ${m}`); };
const check = (cond, m, extra = "") => (cond ? ok(m) : bad(`${m}${extra ? ` — ${extra}` : ""}`));

/* ---------- raw SMF fixture builder (independent of buildSmf) ---------- */

const vlq = (n) => {
  const out = [n & 0x7f];
  n >>>= 7;
  while (n > 0) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
  return out.reverse();
};
const be16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const text = (s) => Array.from(s).map((c) => c.charCodeAt(0) & 0x7f);

function smf({ format = 1, ppq = MIDI_PPQ, tracks }) {
  const header = [...text("MThd"), ...be32(6), ...be16(format), ...be16(tracks.length), ...be16(ppq)];
  const body = [];
  for (const t of tracks) body.push(...text("MTrk"), ...be32(t.length), ...t);
  return Uint8Array.from([...header, ...body]);
}

const meta = (type, payload) => [0xff, type, ...vlq(payload.length), ...payload];
const eot = [0x00, 0xff, 0x2f, 0x00];
const tempoMeta = (micros) => meta(0x51, [(micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff]);
const nameMeta = (s) => meta(0x03, text(s));

/* ---------- 1. edge cases ---------- */

{
  let threw = null;
  try { parseSmf(new Uint8Array(0)); } catch (e) { threw = e; }
  check(threw instanceof MidiCodecError && threw.code === "empty", "empty file throws a readable MidiCodecError");
}
{
  let threw = null;
  try { parseSmf(smf({ tracks: [] })); } catch (e) { threw = e; }
  const parsed = threw ? null : parseSmf(smf({ tracks: [] }));
  check(!threw && parsed.tracks.length === 0 && parsed.warnings.some((w) => /header only/i.test(w)),
    "header-only file parses with a 'no readable tracks' warning");
}
{
  // Declares 240 events but the chunk ends after one note-on.
  const truncatedTrack = [0x00, 0x90, 60, 100];
  const bytes = smf({ tracks: [truncatedTrack] });
  const parsed = parseSmf(bytes);
  const notes = parsed.tracks[0].channels.reduce((n, c) => n + c.notes.length, 0);
  check(parsed.truncated === true && parsed.warnings.some((w) => /truncated/i.test(w)),
    "truncated track is reported, not thrown");
  check(notes <= 1, `truncated track keeps what it could read (${notes} note(s))`);
}
{
  const bytes = smf({ tracks: [[...eot]] });
  const parsed = parseSmf(bytes);
  const parts = smfToParts(parsed);
  check(parsed.tracks.length === 1 && parts.parts.length === 0 && parts.totalNotes === 0,
    "zero-length / empty track body imports nothing, without error");
}
{
  // 16 tracks, each one channel with one note -> 16 parts, first 10 imported.
  const tracks = [];
  for (let ch = 0; ch < 16; ch++) {
    tracks.push([0x00, ...nameMeta(`Part ${ch + 1}`), 0x00, 0x90 | ch, 60 + ch, 100, 0x83, 0x60, 0x80 | ch, 60 + ch, 0, ...eot]);
  }
  const parsed = parseSmf(smf({ tracks }));
  const mapped = smfToParts(parsed);
  check(mapped.parts.length === 10 && mapped.skippedChannels === 6,
    `16 channels -> first 10 imported, ${mapped.skippedChannels} reported (parts ${mapped.parts.length})`);
  check(mapped.warnings.some((w) => /beyond the first 10/.test(w)), "the skipped channels are named in the warning");
}
{
  // One note at tick 0, length 480 ticks (= 1 beat = 4 steps).
  const parsed = parseSmf(smf({ tracks: [[0x00, 0x90, 64, 127, 0x83, 0x60, 0x80, 64, 0, ...eot]] }));
  const mapped = smfToParts(parsed);
  const note = mapped.parts[0].bars[0].notes[0];
  check(note.startStep === 0 && note.lenSteps === 4 && note.midi === 64 && Math.abs(note.vel - 1) < 0.01,
    "one note at tick 0 maps to step 0 with a 4-step length", JSON.stringify(note));
}
{
  let threw = null;
  try { parseSmf(new Uint8Array(1024), { maxBytes: 512 }); } catch (e) { threw = e; }
  check(threw && threw.code === "too-large" && /limit is/.test(threw.message), "a file over the cap is refused with its size and the limit");
  check(MAX_MIDI_FILE_BYTES === 50 * 1024 * 1024, "the cap is 50 MB");
}
{
  const notMidi = Uint8Array.from(text("This is a text file, not a MIDI file at all........"));
  let threw = null;
  try { parseSmf(notMidi); } catch (e) { threw = e; }
  check(threw && threw.code === "not-midi" && /not a Standard MIDI File/.test(threw.message),
    "non-SMF bytes with a .mid extension are rejected honestly");
}
{
  // 32-bit-ish tempo values: 1 µs/beat and 0xFFFFFF µs/beat both clamp to 20–260.
  const fast = parseSmf(smf({ tracks: [[0x00, ...tempoMeta(1), ...eot]] }));
  const slow = parseSmf(smf({ tracks: [[0x00, ...tempoMeta(0xffffff), ...eot]] }));
  check(fast.bpm === 260 && slow.bpm === 20, `tempo extremes clamp into 20–260 (${fast.bpm}, ${slow.bpm})`);
  check(fast.warnings.some((w) => /clamped/.test(w)) && slow.warnings.some((w) => /clamped/.test(w)),
    "clamped tempos are reported");
}
{
  const bytes = smf({ tracks: [[0x00, 0x80, 60, 0, 0x00, 0x90, 62, 100, 0x81, 0x40, 0x80, 62, 0, ...eot]] });
  const parsed = parseSmf(bytes);
  const ch = parsed.tracks[0].channels[0];
  check(ch.notes.length === 1 && ch.notes[0].midi === 62 && ch.droppedNoteOffs === 1,
    "note-off without a matching note-on is counted and ignored", JSON.stringify(ch));
}
{
  // Running status: one 0x90 then three note pairs.
  const bytes = smf({ tracks: [[0x00, 0x90, 60, 100, 0x00, 62, 90, 0x00, 64, 80, 0x83, 0x60, 60, 0, 0x00, 62, 0, 0x00, 64, 0, ...eot]] });
  const parsed = parseSmf(bytes);
  check(parsed.tracks[0].channels[0].notes.length === 3, "running status reads every note of the run",
    String(parsed.tracks[0].channels[0].notes.length));
}
{
  // Format 0: one track, two channels.
  const bytes = smf({ format: 0, tracks: [[
    0x00, 0x90, 60, 100, 0x00, 0x91, 67, 100,
    0x83, 0x60, 0x80, 60, 0, 0x00, 0x81, 67, 0, ...eot,
  ]] });
  const parsed = parseSmf(bytes);
  const mapped = smfToParts(parsed);
  check(parsed.format === 0 && mapped.parts.length === 2 && mapped.totalNotes === 2,
    "format 0 track splits into one part per channel", JSON.stringify(mapped.parts.map((p) => p.name)));
}
{
  // Tempo 138 BPM and a mid-file change.
  const bytes = smf({ tracks: [
    [0x00, ...tempoMeta(Math.round(60_000_000 / 138)), ...eot],
    [0x00, 0x90, 60, 100, 0x81, 0x40, ...tempoMeta(Math.round(60_000_000 / 90)), 0x00, 0x80, 60, 0, ...eot],
  ] });
  const parsed = parseSmf(bytes);
  check(Math.abs(parsed.bpm - 138) < 0.01 && parsed.tempoChanges.length === 2,
    `first tempo wins (${parsed.bpm.toFixed(1)} BPM) and mid-file changes are reported`,
    parsed.warnings.join(" | "));
}
{
  // Note outside C4–E5 keeps its real MIDI number for export.
  const bytes = smf({ tracks: [[0x00, 0x90, 36, 100, 0x83, 0x60, 0x80, 36, 0, ...eot]] });
  const mapped = smfToParts(parseSmf(bytes));
  const note = mapped.parts[0].bars[0].notes[0];
  check(note.midi === 36 && mapped.parts[0].bars[0].notes[0].label === "C2" && mapped.warnings.some((w) => /outside the roll/.test(w)),
    "a low note keeps its MIDI number (row folded) and is reported");
  check(rowForMidi(72) === 4 && rowForMidi(120) === 0 && rowForMidi(0) === 16, "row mapping clamps to the 17 visible keys");
}

/* ---------- 2. writer ---------- */

{
  const bytes = buildSmf({ name: "Test Song", bpm: 138, tracks: [{ name: "Lead", notes: [
    { tick: 0, midi: 60, velocity: 1, durationTicks: 480 },
    { tick: 960, midi: 67, velocity: 0.5, durationTicks: 240 },
  ] }] });
  const parsed = parseSmf(bytes);
  check(parsed.format === 1 && Math.abs(parsed.bpm - 138) < 0.01, "buildSmf writes format 1 with the project tempo");
  check(parsed.tracks.length === 2, "one conductor track + one note track");
  const notes = parsed.tracks[1].channels[0].notes;
  check(notes.length === 2 && notes[0].midi === 60 && notes[1].midi === 67 && notes[1].tick === 960,
    "written notes read back at the same ticks", JSON.stringify(notes.map((n) => [n.tick, n.midi])));
  check(parsed.tracks[1].name === "Lead", "track name meta survives");
}

/* ---------- 3. real files from the FLP toolchain ---------- */

{
  const dir = path.join(root, "flp-imports/exports");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mid")) : [];
  check(files.length >= 3, `found ${files.length} exporter .mid files to test`);
  for (const f of files) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    try {
      const parsed = parseSmf(bytes);
      const mapped = smfToParts(parsed);
      const notes = mapped.totalNotes;
      const imported = mapped.parts.reduce((n, p) => n + p.bars.length, 0);
      check(notes > 0 && mapped.parts.length > 0,
        `${f}: ${parsed.tracks.length} SMF tracks, ${mapped.parts.length} parts, ${notes} notes, ${imported} bar patterns`);
      // Every mapped note must be inside its bar.
      const inRange = mapped.parts.every((p) => p.bars.every((b) => b.notes.every((n) => n.startStep >= 0 && n.startStep <= 15 && n.lenSteps >= 1)));
      check(inRange, `${f}: every mapped note fits its 16-step bar`);
    } catch (e) {
      bad(`${f}: ${e.message}`);
    }
  }
}

/* ---------- 4. demo project round trip ---------- */

{
  // The same mapping app.js uses: patterns -> SMF tracks -> notes.
  const rows = [4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12];
  const patterns = DEMO_SONG.rackPatterns;
  const song = {
    name: "Untitled — Demo Session",
    bpm: DEMO_SONG.bpm,
    tracks: patterns.map((p) => ({
      name: p.name,
      notes: p.notes.map((n) => ({
        tick: Math.round(n.startStep * (MIDI_PPQ / 4)),
        midi: Number.isFinite(n.midi) ? n.midi : 72 + (rows[n.row] ?? 0),
        velocity: n.vel ?? 0.85,
        durationTicks: Math.max(1, Math.round(n.lenSteps * (MIDI_PPQ / 4))),
      })),
    })),
  };
  const before = patterns.map((p) => p.notes.map((n) => [n.row, n.startStep, n.lenSteps, Math.round((n.vel ?? 0.85) * 127)]));
  const bytes = buildSmf(song);
  const parsed = parseSmf(bytes);
  const mapped = smfToParts(parsed, { maxParts: 99 });
  const after = mapped.parts.map((part) =>
    part.bars.flatMap((b) => b.notes).sort((a, b) => a.startStep - b.startStep || a.row - b.row)
      .map((n) => [n.row, n.startStep, n.lenSteps, Math.round(n.vel * 127)])
  );
  // Compare as multisets per part (bar order is preserved by the writer).
  const norm = (list) => list.map((notes) => notes.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]).map(String).join("|")).join(" :: ");
  check(mapped.parts.length === patterns.length, `round trip keeps ${patterns.length} patterns (got ${mapped.parts.length})`);
  check(norm(before) === norm(after), "demo project export -> import is note-for-note identical", `${norm(before).slice(0, 120)} vs ${norm(after).slice(0, 120)}`);
  check(Math.abs(parsed.bpm - DEMO_SONG.bpm) < 0.01, `round trip keeps tempo (${parsed.bpm.toFixed(1)} BPM)`);
  const noteCountBefore = before.reduce((n, p) => n + p.length, 0);
  const noteCountAfter = after.reduce((n, p) => n + p.length, 0);
  check(noteCountBefore === noteCountAfter && noteCountBefore > 0, `note count preserved (${noteCountBefore})`);
}

/* ---------- 5. helper ---------- */

{
  check(noteMidi({ row: 4, midi: 60 }) === 60 && noteMidi({ row: 4 }) === 72 && noteMidi({ row: 16 }) === 60,
    "noteMidi prefers the stored MIDI number, else the row's pitch");
}

console.log(`\n${pass} passed, ${fail} failed of ${pass + fail} checks`);
process.exit(fail ? 1 : 0);
