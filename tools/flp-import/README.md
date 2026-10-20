# `.flp` → built-in demo pipeline

Turns one of the owner's FL Studio sessions in `flp-imports/` into the DAW's
built-in demo. Everything musical (tempo, note timings/pitches/velocities/
lengths/pans, the playlist arrangement with its trimmed clips) is extracted
mechanically. The *sounds* are not in a `.flp` file — only references to
samples and plug-in presets — so each source channel is mapped by hand onto a
synthesized voice in `app/public/wav-codec.js` (`generateStemsFromSong`):
drum kit (kick/snare/clap/hat/tom/rim/fx), Reese sub bass, pluck, stab, lead.

## Re-run

```bash
python3 -m venv /tmp/flpvenv && /tmp/flpvenv/bin/pip install pyflp
/tmp/flpvenv/bin/python tools/flp-import/analyze_flp.py    # -> analysis/flp-demo/{metrics.json,REPORT.md}
/tmp/flpvenv/bin/python tools/flp-import/convert_demo.py   # -> app/public/demo-song.js (generated)
/tmp/flpvenv/bin/python tools/flp-import/export_midi.py    # -> flp-imports/exports/*.mid (all 3 sessions)
/tmp/flpvenv/bin/python tools/flp-import/export_lmms.py    # -> flp-imports/exports/Untitled (Demo Session).mmp[.z]
```

- `analyze_flp.py` expands every session's playlist (clip trims respected,
  disabled rack channels excluded — they never sound) and scores
  **demo suitability**: reconstructability from note data alone, musical
  content, arrangement completeness, first-bars groove/loopability/length,
  and session cleanliness. It is explicitly not a "best song" ranking.
- `convert_demo.py` converts the winner (`untitled.flp`, 138 BPM, 34 bars).
  The channel→voice mapping is the `STEM_MAP` table at the top of the script;
  that is the one creative/human step. To demo a different session, adjust
  `STEM_MAP`/`TRACKS` and pass the file path as an argument.
- After converting, `demo-song.js` is committed like any other source file;
  the app needs no Python at runtime. Bump `app.js?v=` in `index.html` if
  `app.js` changes too (repo convention).

Current demo mapping (`untitled.flp`): pattern 1 → drum kit (all enabled
sampler channels) + ostinato stab (channel 9, unison-doubled notes merged);
pattern 7 → synth arp (ch 8); pattern 8 → sub bass (ch 11); pattern 13 →
lead line (ch 10). Arrangement preserved 1:1, including the 3.5-bar trimmed
pattern clips — that is why some playlist clips are 14 beats, not 16.

## About the LMMS find

The owner flagged LMMS in two steps: first <https://github.com/LMMS/lmms.io>
(the *website* source — Symfony/PHP, GPL-2.0; useful only as a reference for
how a free DAW presents demo/showcase material), then the application itself,
<https://github.com/LMMS/lmms>. What checking the actual app repo established:

- LMMS (GPL-2.0, still active: latest stable 1.2.2, plus a fresh
  1.3.0-alpha.2 from 2026-09-06 with Linux AppImages) has **no `.flp`
  importer** — its plugin set includes `MidiImport`/`MidiExport` and
  `HydrogenImport`, nothing for FL sessions. So no LMMS code was taken and
  LMMS can't open the `.flp` files directly; PyFLP (GPL-3.0, local
  build-time tool only, not shipped) remains the parser.
- What LMMS *is* good for here: a free place to actually play these
  sessions. `export_midi.py` writes arranged MIDI for all three (LMMS:
  File → Import), and `export_lmms.py` writes a native, ready-to-play
  `.mmpz`/`.mmp` of the demo song using only factory samples
  (`drums/kick_hiphop01.ogg`, …) and TripleOscillator patches. See
  `flp-imports/exports/README.md` for usage, re-voicing suggestions, and
  exactly how the files were validated (structurally against LMMS's own
  bundled demos and source constants — a real LMMS render test wasn't
  possible because the sandbox cannot reach GitHub's release-asset host).
- To hear the two non-winning sessions *as mixed*, the original DAW with
  its sample libraries/plug-ins is still required; the MIDI exports give
  their full note/arrangement skeleton. See `analysis/flp-demo/REPORT.md`.
