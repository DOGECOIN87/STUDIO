#!/usr/bin/env python3
"""Convert the winning demo-source session into `app/public/demo-song.js`.

Timings, pitches, velocities, note lengths, pans and the playlist arrangement
are extracted mechanically from the `.flp` file. Sound design cannot be: the
original sessions use sample files and plug-in presets that are not available
here, so each source channel is mapped by hand (see STEM_MAP) onto one of this
app's synthesized voices (drum kit / Reese bass / pluck / stab / lead). Notes on
disabled rack channels are dropped because they never sound; exact duplicate
notes (unison doubling) are merged keeping the louder velocity.

Usage:
    python3 tools/flp-import/convert_demo.py [path/to/session.flp]
Default input is the analysis winner, `flp-imports/untitled.flp`.
Output: `app/public/demo-song.js` (generated; do not edit by hand).
"""

from __future__ import annotations

import json
import math
import pathlib
import sys

import pyflp

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_SRC = ROOT / "flp-imports" / "untitled.flp"
OUT = ROOT / "app" / "public" / "demo-song.js"

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Hand sound-design mapping for this session: (source pattern iid, stem spec).
# `channels: "samplers"` collects every sampler channel of the pattern into the
# drum kit; otherwise `channels` lists the rack-channel iids for the stem.
STEM_MAP = [
    (1, {"id": "stem-drums", "name": "Drum Kit 138bpm.wav", "voice": "drums",
         "label": "Drums", "track": "trk-1", "channels": "samplers"}),
    (1, {"id": "stem-ostinato", "name": "Ostinato Stab.wav", "voice": "stab",
         "label": "Ostinato", "track": "trk-4", "channels": [9]}),
    (7, {"id": "stem-arp", "name": "Synth Arp.wav", "voice": "pluck",
         "label": "Arp", "track": "trk-3", "channels": [8]}),
    (8, {"id": "stem-bass", "name": "Sub Bass Cm.wav", "voice": "reese",
         "label": "Bass", "track": "trk-2", "channels": [11]}),
    (13, {"id": "stem-lead", "name": "Lead Line.wav", "voice": "lead",
          "label": "Lead", "track": "trk-5", "channels": [10]}),
]

TRACKS = [
    {"id": "trk-1", "name": "1 · Drums", "color": "#3b82f6", "volumeDb": 0, "pan": 0,
     "eqLowDb": 1.5, "eqMidDb": 0, "eqHighDb": 1.0},
    {"id": "trk-2", "name": "2 · Sub Bass", "color": "#2dd4bf", "volumeDb": -1.0, "pan": 0,
     "eqLowDb": 2.0, "eqMidDb": -1.0, "eqHighDb": 0},
    {"id": "trk-3", "name": "3 · Synth Arp", "color": "#a855f7", "volumeDb": -2.0, "pan": -0.08,
     "eqLowDb": -1.0, "eqMidDb": 0.5, "eqHighDb": 1.5},
    {"id": "trk-4", "name": "4 · Ostinato", "color": "#38bdf8", "volumeDb": -3.0, "pan": 0.1,
     "eqLowDb": 0, "eqMidDb": 1.0, "eqHighDb": 1.5},
    {"id": "trk-5", "name": "5 · Lead", "color": "#f59e0b", "volumeDb": -1.5, "pan": 0,
     "eqLowDb": 0, "eqMidDb": 1.0, "eqHighDb": 1.0},
]


def midi_of(key: str) -> int:
    s = str(key)
    if len(s) >= 2 and s[1] == "#":
        return (int(s[2:]) + 1) * 12 + NOTE_NAMES.index(s[:2])
    return (int(s[1:]) + 1) * 12 + NOTE_NAMES.index(s[:1])


def note_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def drum_type(channel) -> str:
    name = (getattr(channel, "name", "") or "").lower()
    if "kick" in name or "kik" in name:
        return "kick"
    if "snare" in name or name.startswith("snr"):
        return "snare"
    if "clap" in name:
        return "clap"
    if "hat" in name or "ixh" in name:
        return "hat"
    if "ixe" in name or "fx" in name:
        return "fx"
    if "rim" in name:
        return "rim"
    if "bigbad_t" in name or "tom" in name:
        return "tom"
    return "perc"


def channel_gain(channel) -> float:
    """Relative rack-channel level; 10000 is the untouched default = unity."""
    try:
        return max(0.2, min(1.25, (channel.volume or 10000) / 10000))
    except Exception:
        return 1.0


def r3(x: float) -> float:
    return round(float(x), 3)


def main() -> int:
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    proj = pyflp.parse(str(src))
    ppq = proj.ppq
    channels = {c.iid: c for c in proj.channels}
    patterns = {p.iid: p for p in proj.patterns}
    arrangement = list(proj.arrangements)[0]

    playlist = []  # (pattern_iid, startBeat, durBeats)
    for track in arrangement.tracks:
        for item in list(track):
            if type(item).__name__ == "PatternPLItem":
                playlist.append((item.pattern.iid, item.position / ppq, item.length / ppq))
    playlist.sort(key=lambda x: (x[1], x[0]))
    used_pattern_ids = {pid for pid, _s, _d in playlist}

    stems = []
    pattern_to_stems: dict[int, list[dict]] = {}
    for pattern_iid, spec in STEM_MAP:
        if pattern_iid not in used_pattern_ids:
            raise SystemExit(f"STEM_MAP pattern {pattern_iid} is not used in the playlist")
        pat = patterns[pattern_iid]
        notes = sorted(pat.notes, key=lambda n: (n.position, n.rack_channel))
        stem = {"id": spec["id"], "name": spec["name"], "voice": spec["voice"]}
        max_end_beat = 0.0
        if spec["voice"] == "drums":
            hits = []
            for n in notes:
                ch = channels[n.rack_channel]
                if type(ch).__name__ != "Sampler" or not getattr(ch, "enabled", True):
                    continue
                beat = n.position / ppq
                max_end_beat = max(max_end_beat, beat)
                hits.append([r3(beat), drum_type(ch), r3(n.velocity / 127), r3(channel_gain(ch))])
            stem["gain"] = 1.0
            stem["hits"] = hits
        else:
            merged: dict[tuple, list] = {}
            gain = 1.0
            for ch_iid in spec["channels"]:
                gain = channel_gain(channels[ch_iid])
                for n in notes:
                    if n.rack_channel != ch_iid:
                        continue
                    ch = channels[n.rack_channel]
                    if not getattr(ch, "enabled", True):
                        continue
                    beat = n.position / ppq
                    length = max(0.08, n.length / ppq)
                    max_end_beat = max(max_end_beat, beat + length)
                    midi = midi_of(n.key)
                    pan = max(-1.0, min(1.0, (n.pan - 64) / 64)) if n.pan is not None else 0.0
                    key = (round(beat, 3), midi)
                    vel = n.velocity / 127
                    if key in merged:  # unison doubling: keep louder/longer take
                        merged[key][2] = max(merged[key][2], r3(length))
                        merged[key][3] = max(merged[key][3], r3(vel))
                    else:
                        merged[key] = [r3(beat), midi, r3(length), r3(vel), r3(pan)]
            stem["gain"] = r3(gain)
            stem["notes"] = sorted(merged.values())
        stem["lengthBeats"] = int(math.ceil(max_end_beat / 4.0) * 4) or 4
        stems.append(stem)
        pattern_to_stems.setdefault(pattern_iid, []).append(
            {"stem": spec["id"], "track": spec["track"], "label": spec["label"]})

    clips = []
    for pattern_iid, start, dur in playlist:
        for ref in pattern_to_stems.get(pattern_iid, []):
            bar = int(start // 4) + 1
            clips.append({
                "stem": ref["stem"], "track": ref["track"],
                "start": r3(start), "dur": r3(dur),
                "name": f"{ref['label']} · Bar {bar}",
            })
    clips.sort(key=lambda c: (c["start"], c["track"]))
    total_beats = int(math.ceil(max(c["start"] + c["dur"] for c in clips)))

    # Markers where a new stem layer enters for the first time.
    markers = [{"beat": 0, "name": "Intro"}]
    seen: set[str] = set()
    by_start: dict[float, set[str]] = {}
    for c in clips:
        by_start.setdefault(c["start"], set()).add(c["stem"])
    label_of = {s["id"]: next(sp["label"] for _p, sp in STEM_MAP if sp["id"] == s["id"]) for s in stems}
    for start in sorted(by_start):
        new = by_start[start] - seen
        seen |= by_start[start]
        if start > 0 and new:
            markers.append({"beat": r3(start), "name": "+ " + " & ".join(sorted(label_of[s] for s in new))})

    # 16-step rack / piano-roll patterns from bar 1 of each pitched stem.
    def steps_for(onsets):
        grid = [0] * 16
        for b in onsets:
            idx = int(round(b / 0.25))
            if 0 <= idx < 16:
                grid[idx] = 1
        return grid

    drum_onsets = [h[0] for s in stems if s["voice"] == "drums" for h in s["hits"] if h[0] < 4]
    rack_patterns = []
    pattern_defs = [
        ("Pattern 1 — Beat & Arp", "stem-arp"),
        ("Pattern 2 — Ostinato", "stem-ostinato"),
        ("Pattern 3 — Bassline", "stem-bass"),
    ]
    stem_by_id = {s["id"]: s for s in stems}
    for pname, focus_id in pattern_defs:
        focus = stem_by_id[focus_id]
        steps = {"stem-drums": steps_for(drum_onsets)}
        for s in stems:
            if s["voice"] != "drums":
                steps[s["id"]] = steps_for([n[0] for n in s["notes"] if n[0] < 4])
        pr_notes = []
        for beat, midi, length, vel, _pan in focus["notes"]:
            if beat >= 4:
                continue
            m = midi
            while m > 76:
                m -= 12
            while m < 60:
                m += 12
            pr_notes.append({
                "row": 76 - m,
                "startStep": int(round(beat / 0.25)),
                "lenSteps": max(1, min(16, int(round(length / 0.25)))),
                "vel": r3(vel),
                "label": note_name(m),
            })
        rack_patterns.append({"name": pname, "steps": steps, "notes": pr_notes})

    song = {
        "title": "Untitled — Demo Session",
        "bpm": int(round(proj.tempo)),
        "totalBeats": total_beats,
        "tracks": TRACKS,
        "markers": markers,
        "stems": stems,
        "clips": clips,
        "rackPatterns": rack_patterns,
    }

    text = (
        "/**\n"
        " * Audius Studio — built-in demo session data (GENERATED FILE).\n"
        " *\n"
        " * Generated by tools/flp-import/convert_demo.py from the project owner's own\n"
        " * session file (kept outside this folder, in flp-imports/). Note timings,\n"
        " * pitches, velocities and the clip arrangement below are the session's real\n"
        " * data; the sounds are re-synthesized by generateStemsFromSong() in\n"
        " * wav-codec.js because the original samples and plug-in presets are not\n"
        " * bundled with this app. Do not edit by hand — re-run the converter.\n"
        " */\n"
        f"export const DEMO_SONG = {json.dumps(song, indent=1)};\n"
    )
    for banned in ("FL Studio", "Fruity", "Image-Line"):
        assert banned not in text, f"banned string in app/public output: {banned}"
    OUT.write_text(text, encoding="utf-8")

    print(f"Source: {src.name}  tempo={song['bpm']}  totalBeats={total_beats} "
          f"({total_beats / 4:g} bars, {total_beats * 60 / song['bpm']:.1f}s)")
    for s in stems:
        count = len(s.get("hits", s.get("notes", [])))
        print(f"  {s['id']:<14} voice={s['voice']:<6} length={s['lengthBeats']:>3} beats  events={count}  gain={s['gain']}")
    print(f"  clips={len(clips)}  markers={markers}")
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
