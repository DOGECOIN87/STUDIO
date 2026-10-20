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

## About the LMMS / lmms.io find

The owner flagged <https://github.com/LMMS/lmms.io> during this work. For the
record, so nobody goes hunting in the wrong place later:

- That repository is the **source of the LMMS website** (Symfony/PHP,
  GPL-2.0), not the LMMS application. Its showcase pages embed the community's
  "Best of LMMS" Bandcamp albums; its LSP section is a sharing platform for
  LMMS projects/presets. Useful as a reference for how a free DAW presents
  demo material and community projects — which is the spirit this pipeline
  follows (a real session shipped as the in-app demo).
- It contains nothing that reads `.flp` files, so no code was taken from it
  (also respecting its GPL-2.0 licence — links and ideas only).
- The LMMS application itself (<https://github.com/LMMS/lmms>) currently has
  **no `.flp` importer** (code search for `FLP` returns nothing; very old
  LMMS versions had an unmaintained experimental one). So LMMS can't open
  these three sessions either — PyFLP (GPL-3.0, used here only as a local
  build-time tool, not shipped with the app) is the practical parser.
- To *hear* the two non-winning sessions as their author made them, the
  original DAW with its sample libraries/plug-ins is still required; see
  `analysis/flp-demo/REPORT.md` for what each file depends on.
