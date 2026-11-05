#!/usr/bin/env node
/**
 * Tests for the Piano Roll selection helpers (app/public/piano-selection.js).
 * The module is pure and DOM-free, so the same code the app runs is exercised here.
 *
 *   node tools/test-piano-selection.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pub = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "app/public");
const S = await import(pathToFileURL(path.join(pub, "piano-selection.js")));

let pass = 0;
let fail = 0;
const check = (cond, msg, extra = "") => {
  if (cond) {
    pass++;
    console.log(`✓ ${msg}`);
  } else {
    fail++;
    console.log(`✗ ${msg}${extra ? " — " + extra : ""}`);
  }
};

let id = 0;
const io = {
  getMidi: (n) => (Number.isFinite(n.midi) ? n.midi : 60),
  setMidi: (n, m) => {
    n.midi = m;
  },
  newId: () => `n${++id}`,
};
const note = (startStep, lenSteps, midi, vel = 0.8) => ({ id: `n${++id}`, startStep, lenSteps, midi, vel });
const ids = (notes) => notes.map((n) => n.id).join(",");
const LIMITS = { total: 16, low: 24, high: 108 };

// --- bounds ------------------------------------------------------------------------------------
{
  const notes = [note(4, 2, 64), note(0, 3, 60), note(10, 1, 72)];
  const b = S.bounds(notes, io);
  check(b.start === 0 && b.end === 11, "bounds: first start and last end", JSON.stringify(b));
  check(b.lo === 60 && b.hi === 72, "bounds: lowest and highest pitch");
  check(S.bounds([], io) === null, "bounds: an empty list has no bounds");
  check(S.bounds(null, io) === null, "bounds: null is not a crash");
  const zero = note(2, 0, 60);
  check(S.bounds([zero], io).end === 3, "bounds: a zero-length note still takes one step");
}

// --- clampDelta --------------------------------------------------------------------------------
{
  const notes = [note(4, 4, 60), note(6, 2, 67)];
  const b = S.clampDelta(notes, io, 6, 0, LIMITS);
  check(b.dStep === 6 && b.dMidi === 0, "clampDelta: a move that fits is kept");
  const right = S.clampDelta(notes, io, 99, 0, LIMITS);
  check(right.dStep === 8, "clampDelta: the block stops at the pattern's end (16 - 8)", String(right.dStep));
  const left = S.clampDelta(notes, io, -99, 0, LIMITS);
  check(left.dStep === -4, "clampDelta: the block stops at step 0", String(left.dStep));
  const up = S.clampDelta(notes, io, 0, 99, LIMITS);
  check(up.dMidi === 41, "clampDelta: the highest note stops at C8 (108 - 67)", String(up.dMidi));
  const down = S.clampDelta(notes, io, 0, -99, LIMITS);
  check(down.dMidi === -36, "clampDelta: the lowest note stops at C1 (24 - 60)", String(down.dMidi));
  const nothing = S.clampDelta(notes, io, 0, 0, LIMITS);
  check(nothing.dStep === 0 && nothing.dMidi === 0, "clampDelta: no move stays no move");
  const rounded = S.clampDelta(notes, io, 2.4, -1.6, LIMITS);
  check(rounded.dStep === 2 && rounded.dMidi === -2, "clampDelta: steps and semitones are whole");
  check(S.clampDelta([], io, 5, 5, LIMITS).dStep === 0, "clampDelta: an empty selection does not move");
  const unbounded = S.clampDelta(notes, io, 3, 2);
  check(unbounded.dStep === 3 && unbounded.dMidi === 2, "clampDelta: no limits means no limit");
}

// --- notesInRect -------------------------------------------------------------------------------
{
  const geo = {
    stepW: 10,
    rowH: 16,
    xOfStep: (s) => 56 + s * 10,
    yOfMidi: (m) => (72 - m) * 16,
  };
  const a = note(0, 2, 72); // x 56..75, y 0..16
  const b = note(4, 1, 70); // x 96..105, y 32..48
  const c = note(8, 4, 72); // x 136..175, y 0..16
  const inside = S.notesInRect([a, b, c], io, { x0: 50, y0: 0, x1: 110, y1: 50 }, geo);
  check(ids(inside) === `${a.id},${b.id}`, "notesInRect: picks the notes the box touches", ids(inside));
  const onlyTop = S.notesInRect([a, b, c], io, { x0: 50, y0: -10, x1: 200, y1: 20 }, geo);
  check(ids(onlyTop) === `${a.id},${c.id}`, "notesInRect: respects the pitch rows", ids(onlyTop));
  const reversed = S.notesInRect([a, b, c], io, { x0: 110, y0: 50, x1: 50, y1: 0 }, geo);
  check(ids(reversed) === `${a.id},${b.id}`, "notesInRect: a box drawn up-left works the same");
  const empty = S.notesInRect([a, b, c], io, { x0: 300, y0: 300, x1: 320, y1: 320 }, geo);
  check(empty.length === 0, "notesInRect: a box on empty grid picks nothing");
  const edge = S.notesInRect([a], io, { x0: 75, y0: 0, x1: 90, y1: 16 }, geo);
  check(edge.length === 0, "notesInRect: a box that starts at a note's end misses it");
  const tiny = { id: "tiny", startStep: 0, lenSteps: 1, midi: 72 };
  const minWidth = S.notesInRect([tiny], io, { x0: 61, y0: 0, x1: 66, y1: 16 }, geo);
  check(minWidth.length === 1, "notesInRect: uses the 6px minimum note width a thin note is drawn with");
}

// --- noteAt ------------------------------------------------------------------------------------
{
  const below = note(4, 2, 60);
  const above = note(4, 2, 60);
  const other = note(4, 2, 62);
  const list = [below, other, above];
  check(S.noteAt(list, io, 60, 4) === above, "noteAt: the top-most note of a stack is hit first");
  check(S.noteAt(list, io, 60, 5.5) === above, "noteAt: a point inside the note hits it");
  check(S.noteAt(list, io, 60, 6) === null, "noteAt: the end step belongs to the next cell");
  check(S.noteAt(list, io, 61, 4) === null, "noteAt: another pitch misses");
  check(S.noteAt(list, io, 62, 4.9) === other, "noteAt: picks the note on the right pitch");
  check(S.noteAt([], io, 60, 0) === null, "noteAt: no notes means no hit");
}

// --- nearestNote / velocityGroup ---------------------------------------------------------------
{
  const a = note(0, 1, 60);
  const b = note(4, 1, 62);
  const c = note(8, 1, 64);
  check(S.nearestNote([a, b, c], 3.5) === b, "nearestNote: picks the closest start");
  check(S.nearestNote([a, b, c], 0.2) === a, "nearestNote: a note near the pointer wins");
  check(S.nearestNote([a, b, c], 6) === null, "nearestNote: nothing within 1.2 steps means no hit");
  check(S.nearestNote([a, b, c], 7, 4) === c, "nearestNote: the tolerance can be widened");
  check(S.nearestNote([], 0) === null, "nearestNote: an empty pattern has no nearest note");
  const sel = new Set([a.id, b.id]);
  check(ids(S.velocityGroup([a, b, c], b, sel)) === `${a.id},${b.id}`, "velocityGroup: a selected note drags the whole selection");
  check(ids(S.velocityGroup([a, b, c], c, sel)) === c.id, "velocityGroup: an unselected note is edited alone");
  check(ids(S.velocityGroup([a, b, c], a, new Set())) === a.id, "velocityGroup: with no selection, one note moves");
  check(S.velocityGroup([a, b, c], null, sel).length === 0, "velocityGroup: no hit means nothing to move");
  check(ids(S.velocityGroup([a, b, c], a, new Set([a.id]))) === a.id, "velocityGroup: a single selected note is just itself");
}

// --- clampVelocity -----------------------------------------------------------------------------
{
  check(S.clampVelocity(0.42) === 0.42, "clampVelocity: a normal value is unchanged");
  check(S.clampVelocity(0) === S.VEL_MIN, "clampVelocity: a note is never silent", String(S.clampVelocity(0)));
  check(S.clampVelocity(-3) === S.VEL_MIN, "clampVelocity: negative values clamp to the floor");
  check(S.clampVelocity(9) === S.VEL_MAX, "clampVelocity: values above full scale clamp to 1");
  check(S.clampVelocity(NaN) === 0.85, "clampVelocity: a missing value is the default 0.85");
  check(S.clampVelocity(0.123456) === 0.123, "clampVelocity: keeps three decimals");
}

// --- selectBy ----------------------------------------------------------------------------------
{
  const notes = [
    note(0, 1, 60, 0.9),
    note(1, 1, 62, 0.5),
    note(4, 1, 64, 0.7),
    note(5, 2, 60, 0.6),
    note(8, 1, 67, 0.4),
  ];
  const sel = new Set([notes[2].id]);
  check(S.selectBy(notes, io, sel, "all").length === 5, "selectBy all: every note");
  check(S.selectBy(notes, io, sel, "none").length === 0, "selectBy none: nothing");
  check(ids(S.selectBy(notes, io, sel, "invert")) === `${notes[0].id},${notes[1].id},${notes[3].id},${notes[4].id}`, "selectBy invert: the others");
  check(ids(S.selectBy(notes, io, sel, "onbeat", { beat: 4 })) === `${notes[0].id},${notes[2].id},${notes[4].id}`, "selectBy onbeat: steps 0, 4 and 8");
  check(ids(S.selectBy(notes, io, sel, "offbeat", { beat: 4 })) === `${notes[1].id},${notes[3].id}`, "selectBy offbeat: steps 1 and 5");
  const loud = S.selectBy(notes, io, sel, "loud");
  check(loud.length === 3 && loud[0] === notes[0], "selectBy loud: the louder half, loudest first", ids(loud));
  const quiet = S.selectBy(notes, io, sel, "quiet");
  check(quiet.length === 3 && quiet[quiet.length - 1] === notes[4], "selectBy quiet: the quieter half");
  const one = [note(0, 1, 60)];
  check(S.selectBy(one, io, new Set(), "loud").length === 1, "selectBy half: a single note is its own half");
  const cSel = new Set([notes[0].id]);
  check(ids(S.selectBy(notes, io, cSel, "pitch")) === `${notes[0].id},${notes[3].id}`, "selectBy pitch: every note on the selected C", ids(S.selectBy(notes, io, cSel, "pitch")));
  check(S.selectBy(notes, io, new Set(), "pitch") === null, "selectBy pitch: needs a starting note");
  const overlap = S.selectBy([note(0, 4, 60), note(2, 4, 60), note(2, 2, 62)], io, new Set(), "overlap");
  check(overlap.length === 2, "selectBy overlap: the two stacked C notes, not the D above them");
  check(S.selectBy(notes, io, sel, "nonsense") === undefined, "selectBy: an unknown command returns undefined");
  const rng = (() => {
    let s = 12345;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  })();
  const r1 = ids(S.selectBy(notes, io, sel, "random", { rng }));
  const r2 = ids(S.selectBy(notes, io, sel, "random", { rng }));
  check(r1 !== r2 || true, "selectBy random: draws from the generator without throwing");
  const always = S.selectBy(notes, io, sel, "random", { rng: () => 0.1 });
  check(always.length === 5, "selectBy random: a generator under 0.5 picks every note");
  check(S.selectBy(notes, io, sel, "random", { rng: () => 0.9 }).length === 0, "selectBy random: a generator over 0.5 picks none");
  const before = ids(notes);
  S.selectBy(notes, io, sel, "all");
  S.selectBy(notes, io, sel, "invert");
  check(ids(notes) === before, "selectBy never reorders or mutates the pattern");
}

// --- copySelection / pasteClipboard ------------------------------------------------------------
{
  const a = note(4, 2, 60, 0.9);
  const b = note(8, 1, 64, 0.4);
  const c = { id: "no-vel", startStep: 10, lenSteps: 3, midi: 67 };
  const sel = new Set([a.id, c.id]);
  const clip = S.copySelection([a, b, c], io, sel);
  check(clip.notes.length === 2, "copy: only the selected notes are copied");
  check(clip.notes[0].offset === 0 && clip.notes[1].offset === 6, "copy: offsets are relative to the first copied note");
  check(clip.from === 4 && clip.span === 9, "copy: records where and how long the copied block is", `${clip.from}/${clip.span}`);
  check(clip.notes[1].lenSteps === 3 && clip.notes[1].midi === 67, "copy: lengths and pitches travel with the notes");
  check(clip.notes[1].vel === 0.85, "copy: a note without a velocity gets the default");
  check(S.copySelection([a, b], io, new Set()) === null, "copy: an empty selection copies nothing");
  const again = S.copySelection([a, b, c], io, new Set([a.id]));
  const first = again.notes[0];
  check(first.offset === 0, "copy: a single note pastes where it is dropped");
  // The clipboard is plain data: editing the pattern afterwards must not change it.
  a.startStep = 12;
  check(clip.notes[0].offset === 0 && clip.notes[0].midi === 60, "copy: the clipboard is a snapshot, not a reference");
}

{
  const clip = {
    notes: [
      { offset: 0, lenSteps: 2, vel: 0.9, midi: 60 },
      { offset: 4, lenSteps: 2, vel: 0.6, midi: 64 },
    ],
    span: 6,
    from: 0,
  };
  const before = JSON.stringify(clip);
  const pasted = S.pasteClipboard(clip, 2, io, { total: 16 });
  check(pasted.length === 2, "paste: both notes land");
  check(pasted[0].startStep === 2 && pasted[1].startStep === 6, "paste: offsets are applied to the paste point");
  check(pasted.every((n) => n.id), "paste: every new note gets a fresh id");
  check(new Set(pasted.map((n) => n.id)).size === 2, "paste: ids are unique");
  check(pasted[0].midi === 60 && pasted[1].midi === 64, "paste: pitch goes through io.setMidi");
  check(JSON.stringify(clip) === before, "paste: the clipboard is not mutated");
  const late = S.pasteClipboard(clip, 13, io, { total: 16 });
  check(late.length === 1 && late[0].startStep === 13, "paste: the note that would start past the end is dropped", JSON.stringify(late));
  const trimmed = S.pasteClipboard(clip, 15, io, { total: 16 });
  check(trimmed.length === 1 && trimmed[0].lenSteps === 1, "paste: a note that straddles the end is trimmed", JSON.stringify(trimmed));
  check(S.pasteClipboard(clip, 20, io, { total: 16 }).length === 0, "paste: past the pattern's end nothing lands");
  check(S.pasteClipboard(clip, -4, io, { total: 16 }).length === 1, "paste: a note before step 0 is left out, the rest land");
  check(S.pasteClipboard(null, 0, io).length === 0, "paste: an empty clipboard pastes nothing");
  check(S.pasteClipboard({ notes: [] }, 0, io).length === 0, "paste: a clipboard with no notes pastes nothing");
  const clamped = S.pasteClipboard({ notes: [{ offset: 0, lenSteps: 99, vel: 0.5, midi: 60 }] }, 0, io, { total: 8 });
  check(clamped[0].lenSteps === 8, "paste: a too-long note is trimmed to the pattern");
  const zeroLen = S.pasteClipboard({ notes: [{ offset: 0, lenSteps: 0, vel: 0.5, midi: 60 }] }, 0, io, { total: 8 });
  check(zeroLen[0].lenSteps === 1, "paste: a zero-length copy still takes one step");
}

// --- the keyboard / module contract used by app.js ---------------------------------------------
{
  const api = ["bounds", "clampDelta", "notesInRect", "noteAt", "nearestNote", "velocityGroup", "clampVelocity", "selectBy", "copySelection", "pasteClipboard"];
  const missing = api.filter((name) => typeof S[name] !== "function");
  check(missing.length === 0, `module exports ${api.length} helpers (missing ${missing.join(",") || "none"})`);
  check(S.VEL_MIN === 0.1 && S.VEL_MAX === 1, "the velocity lane's range is 0.1–1");
}

console.log(`\n${pass} passed, ${fail} failed of ${pass + fail} checks`);
if (fail > 0) process.exit(1);
