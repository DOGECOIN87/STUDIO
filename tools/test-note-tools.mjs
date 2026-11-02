#!/usr/bin/env node
/**
 * Tests for the Piano Roll note tools (app/public/note-tools.js), the stock
 * "Classic" drum voices (app/public/stock-drums.js) and the WAV dither.
 *
 *   node tools/test-note-tools.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pub = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "app/public");
const T = await import(pathToFileURL(path.join(pub, "note-tools.js")));
const D = await import(pathToFileURL(path.join(pub, "stock-drums.js")));

let pass = 0, fail = 0;
const check = (cond, msg, extra = "") => {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.log(`✗ ${msg}${extra ? " — " + extra : ""}`); }
};

let id = 0;
const io = { getMidi: (n) => n.midi, setMidi: (n, m) => { n.midi = m; }, newId: () => `t${++id}` };
const note = (startStep, lenSteps, midi, vel = 0.8) => ({ id: `n${++id}`, startStep, lenSteps, midi, vel });
const C_MAJOR = [note(0, 8, 60), note(0, 8, 64), note(0, 8, 67)];

{
  const up = T.arpeggiate(C_MAJOR, io, { step: 2, direction: "up" });
  check(up.map((n) => n.midi).join() === "60,64,67,60", "arpeggiate up: C E G C over 8 steps at 2", up.map((n) => n.midi).join());
  check(up.map((n) => n.startStep).join() === "0,2,4,6", "arpeggiate places one note per step");
  const down = T.arpeggiate(C_MAJOR, io, { step: 2, direction: "down" });
  check(down.map((n) => n.midi).join() === "67,64,60,67", "arpeggiate down");
  const ud = T.arpeggiate([...C_MAJOR.map((n) => ({ ...n, lenSteps: 16 }))], io, { step: 2, direction: "updown" });
  check(ud.slice(0, 5).map((n) => n.midi).join() === "60,64,67,64,60", "arpeggiate up-down bounces without repeating the ends");
  const oct = T.arpeggiate([note(0, 8, 60)], io, { step: 2, octaves: 2 });
  check(oct.map((n) => n.midi).join() === "60,72,60,72", "a single note with 2 octaves arpeggiates over octaves");
  const single = T.arpeggiate([note(0, 4, 60)], io, { step: 1 });
  check(single.length === 1 && single[0].lenSteps === 4, "a single note with 1 octave is left alone");
}
{
  const notes = [note(0, 2, 60), note(4, 4, 67)];
  const h = T.flip(notes, io, { horizontal: true });
  check(h[0].startStep === 6 && h[1].startStep === 0, "flip in time mirrors within the span");
  const v = T.flip(notes, io, { vertical: true });
  check(v[0].midi === 67 && v[1].midi === 60, "flip pitches mirrors around the range");
  check(notes[0].startStep === 0 && notes[0].midi === 60, "tools never mutate their input");
}
{
  const notes = [note(0, 1, 60), note(4, 1, 62), note(4, 1, 65), note(10, 1, 67)];
  const l = T.legato(notes, { total: 16 });
  check(l.map((n) => n.lenSteps).join() === "4,6,6,1", "legato stretches to the next start (chords together)");
}
{
  check(T.snapToScale(61, 0, [0, 2, 4, 5, 7, 9, 11]) === 60, "snap C# to C major → C (ties go down)");
  check(T.snapToScale(66, 0, [0, 2, 4, 5, 7, 9, 11]) === 65, "snap F# to C major → F");
}
{
  const notes = Array.from({ length: 16 }, (_, i) => note(i, 1, 60, 0.8));
  const a = T.humanize(notes, { velocity: 0.2, seed: 7 });
  const b = T.humanize(notes, { velocity: 0.2, seed: 7 });
  check(a.map((n) => n.vel).join() === b.map((n) => n.vel).join(), "humanize is deterministic for a seed");
  check(a.some((n) => n.vel !== 0.8) && a.every((n) => n.vel >= 0.05 && n.vel <= 1), "humanize changes velocities within range");
  const onBeat = a.filter((n) => n.startStep % 4 === 0).reduce((s, n) => s + n.vel, 0) / 4;
  const off = a.filter((n) => n.startStep % 4 !== 0).reduce((s, n) => s + n.vel, 0) / 12;
  check(onBeat > off, "humanize makes off-beats a little softer", `${onBeat.toFixed(2)} vs ${off.toFixed(2)}`);
}
{
  const r = T.repeatNotes([note(0, 8, 60, 1)], io, { rate: 2, decay: 0.5 });
  check(r.length === 4 && r.map((n) => n.startStep).join() === "0,2,4,6", "note repeat fills the length at the rate");
  check(r[1].vel === 0.5 && r[2].vel === 0.25, "note repeat decays the velocity");
}
{
  const e = T.euclidean(io, { steps: 8, pulses: 3, total: 16, midi: 36 });
  check(e.length === 6 && e.every((n) => n.midi === 36), "euclidean 3 of 8 over 16 steps gives 6 hits");
  check(e.slice(0, 3).map((n) => n.startStep).join() === "0,3,6", "euclidean 3 of 8 is the tresillo (0, 3, 6)");
  check(e[0].vel > e[1].vel, "the first hit of each cycle is accented");
}
{
  for (const t of Object.keys(D.STOCK_DRUM_VOICES)) {
    const a = D.renderStockDrum(t, 44100);
    let peak = 0;
    for (const x of a) peak = Math.max(peak, Math.abs(x));
    check(a.length > 1000 && a.length < 44100 * 2 && peak > 0.2 && peak <= 1 && a.every(Number.isFinite), `Classic ${t}: ${a.length} samples, peak ${peak.toFixed(2)}`);
  }
  const k1 = D.renderStockDrum("kick", 44100), k2 = D.renderStockDrum("kick", 44100);
  check(k1.every((v, i) => v === k2[i]), "stock drums render identically every time");
  check(D.renderStockDrum("nope") === null, "an unknown voice renders nothing");
}
{
  // The WAV encoder needs a Blob and an AudioBuffer-like object only.
  const W = await import(pathToFileURL(path.join(pub, "wav-codec.js")));
  const n = 44100;
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = 0.25 * Math.sin((2 * Math.PI * 1000 * i) / 44100) * (1 - i / n);
  const buf = { numberOfChannels: 2, sampleRate: 44100, length: n, getChannelData: () => ch };
  const plain = new Int16Array((await W.encodeWavFromAudioBuffer(buf, 16).arrayBuffer()).slice(44));
  const shaped = new Int16Array((await W.encodeWavFromAudioBuffer(buf, 16, { dither: "shaped" }).arrayBuffer()).slice(44));
  const shaped2 = new Int16Array((await W.encodeWavFromAudioBuffer(buf, 16, { dither: "shaped" }).arrayBuffer()).slice(44));
  check(plain.length === shaped.length, "dithered WAV has the same size");
  check(shaped.every((v, i) => v === shaped2[i]), "dither is deterministic");
  let maxDiff = 0, diffs = 0;
  for (let i = 0; i < plain.length; i++) { const d = Math.abs(plain[i] - shaped[i]); maxDiff = Math.max(maxDiff, d); if (d) diffs++; }
  check(diffs > plain.length / 4 && maxDiff <= 6, "dither only moves samples by a few LSB", `max ${maxDiff}, changed ${diffs}`);
  const f32 = new Float32Array((await W.encodeWavFromAudioBuffer(buf, 32, { dither: "shaped" }).arrayBuffer()).slice(44));
  check(f32[0] === ch[0] && f32[2] === ch[1], "32-bit float is never dithered");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
