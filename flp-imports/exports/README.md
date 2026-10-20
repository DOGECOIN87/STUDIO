# Exports for LMMS (and every other DAW)

LMMS (<https://github.com/LMMS/lmms>, free, Win/macOS/Linux) cannot open
`.flp` files — it has MIDI import but no `.flp` importer. These exports are
the bridge. Regenerate them any time with the scripts in
`tools/flp-import/` (`export_midi.py`, `export_lmms.py`).

## Files

| File | What it is |
|---|---|
| `Untitled (Demo Session).mmpz` / `.mmp` | **Native LMMS project of the demo song.** Just open it in LMMS and press play: 9 tracks (Kick/Snare/Hi-Hat/Tom/FX on factory samples, Sub Bass/Synth Arp/Ostinato/Lead on TripleOscillator), same notes and 34-bar arrangement as the web demo. `.mmpz` and `.mmp` are the same project, compressed/uncompressed. |
| `untitled.mid` | Arranged MIDI of the full session (973 notes, drums on ch. 10). Nothing omitted — this session has no audio clips. |
| `feb16thflat rite_2.mid` | Arranged MIDI (985 melodic notes, 5 tracks). The session's two drum-*loop* audio clips can't exist in MIDI — see tips below. |
| `Project 1 - mattrick_5.mid` | Arranged MIDI (807 notes) — **skeleton only**: the original is built from audio loops/stabs and FX automation, none of which MIDI can carry (65 audio clips omitted). Use it for the groove/structure, not the sound. |

MIDI import in LMMS: **File → Import**, pick the `.mid`; each source channel
arrives as its own track, then swap the default instrument per track.

## Suggested LMMS instruments when re-voicing the MIDI imports

The originals used commercial plug-ins/samples; these built-in LMMS
instruments get you in the neighbourhood:

- **untitled** — “Diva” parts: TripleOscillator or ZynAddSubFX
  (bass track → LB302 or TripleOscillator sine+saw). Drums already map to a
  GM kit; the `.mmpz` above is the ready-made version of this session.
- **feb16thflat rite_2** — Omnisphere track → ZynAddSubFX pluck/pad preset;
  Hive tracks → Watsyn or a detuned TripleOscillator saw stack; Massive
  track → Monstro. Add your own beat from bar 33 (that's where the original
  175 BPM drum loops entered; the project tempo is 152).
- **Project 1** — Kick/Snare/Hats tracks → Kicker + factory `drums/*.ogg`
  samples via AudioFileProcessor. The “Stabs_&_Chords” and drum-loop tracks
  were exported as placeholder drum hits (GM key 38) because the real sounds
  are missing audio files — replace or delete them.

## Validation (no LMMS binary was available in the build sandbox)

- MIDI files were re-parsed with `mido`; note-on counts match the audible
  note counts in `analysis/flp-demo/metrics.json` exactly (973 / 985 / 807),
  and durations match the sessions (59 s / 101 s / 192 s).
- The `.mmp` was audited against LMMS's own bundled demo
  (`data/projects/demos/TobyDox-Psycho.mmpz`): no unknown elements or
  attributes, note keys/lengths in range, patterns end exactly at the song
  length. Format constants (48 ticks/beat, key = MIDI note,
  TripleOscillator wave/modulation enums) were verified in LMMS source
  (`include/Note.h`, `include/Oscillator.h`). It has **not** been
  render-tested, because GitHub release-asset downloads are blocked in the
  sandbox — first open in LMMS is the final check.
