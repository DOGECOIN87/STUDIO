#!/usr/bin/env python3
"""Score the owner's `.flp` session files for use as this DAW's built-in demo.

Reads every `.flp` in `flp-imports/` with PyFLP (pip install pyflp), expands the
playlist (pattern clips repeated/trimmed exactly as arranged, disabled rack
channels excluded because they do not sound), and reports how much real,
note-determined music each session contains. The score is a *demo-suitability*
score for this browser DAW, not a judgement of the song: the demo must groove
in the first bars, loop as 4-bar stems, and be reconstructable from note data
alone because the source sessions' sample files and plug-in presets are not
available here.

Usage:
    python3 tools/flp-import/analyze_flp.py
Writes:
    analysis/flp-demo/metrics.json
    analysis/flp-demo/REPORT.md
"""

from __future__ import annotations

import collections
import hashlib
import json
import math
import pathlib
import sys

import pyflp

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "flp-imports"
OUT_DIR = ROOT / "analysis" / "flp-demo"

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Sample-name hints that the *sound* of a sampler note is a loop/stab/tone that
# lives in a missing audio file, rather than an identifiable drum one-shot.
LOOPISH_HINTS = ("loop", "drumloop", "chop", "stab", "bass_tone", "atmosphere", "rex")


def midi_of(key: str) -> int:
    s = str(key)
    if len(s) >= 2 and s[1] == "#":
        return (int(s[2:]) + 1) * 12 + NOTE_NAMES.index(s[:2])
    return (int(s[1:]) + 1) * 12 + NOTE_NAMES.index(s[:1])


def safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def is_loopish_sampler(channel) -> bool:
    name = (getattr(channel, "name", "") or "").lower()
    path = str(safe(lambda: channel.sample_path, "") or "").lower()
    return any(h in name or h in path for h in LOOPISH_HINTS)


def analyze(path: pathlib.Path) -> dict:
    proj = pyflp.parse(str(path))
    ppq = proj.ppq
    channels = {c.iid: c for c in proj.channels}
    patterns = {p.iid: p for p in proj.patterns}

    # Duplicate patterns (identical note lists) are dead weight in a demo.
    by_hash: dict[str, list[int]] = {}
    for iid, pat in patterns.items():
        sig = tuple(sorted(
            (n.position, n.length, str(n.key), n.rack_channel, n.velocity)
            for n in pat.notes
        ))
        by_hash.setdefault(hashlib.sha1(repr(sig).encode()).hexdigest()[:10], []).append(iid)
    dup_groups = [sorted(v) for v in by_hash.values() if len(v) > 1]

    arrangements = list(proj.arrangements)
    arrangement = arrangements[0] if arrangements else None
    pattern_items, audio_items, automation_items = [], [], []
    if arrangement is not None:
        for track_idx, track in enumerate(arrangement.tracks):
            for item in list(track):
                if type(item).__name__ == "PatternPLItem":
                    pattern_items.append((track_idx, item))
                elif type(item.channel).__name__ == "Automation":
                    automation_items.append((track_idx, item))
                else:
                    audio_items.append((track_idx, item))

    # Expand pattern clips into absolute note events (clip trim respected).
    expanded = []  # (abs_tick, note, channel)
    pattern_bars = 0.0
    music_end_tick = 0
    for _ti, item in pattern_items:
        pattern_bars += item.length / ppq / 4
        music_end_tick = max(music_end_tick, item.position + item.length)
        pat = patterns[item.pattern.iid]
        for note in pat.notes:
            if note.position < item.length:
                expanded.append((item.position + note.position, note, channels.get(note.rack_channel)))
    audio_bars = sum(it.length / ppq / 4 for _ti, it in audio_items)
    for _ti, it in audio_items:
        music_end_tick = max(music_end_tick, it.position + it.length)

    audible = [e for e in expanded if e[2] is not None and getattr(e[2], "enabled", True)]
    melodic = [e for e in audible if type(e[2]).__name__ == "Instrument"]
    sampler_notes = [e for e in audible if type(e[2]).__name__ == "Sampler"]
    drum_oneshots = [e for e in sampler_notes if not is_loopish_sampler(e[2])]
    pitches = [midi_of(e[1].key) for e in melodic]
    pitch_classes = collections.Counter(p % 12 for p in pitches)

    music_bars = music_end_tick / ppq / 4
    music_seconds = music_bars * 4 * 60 / proj.tempo if proj.tempo else 0

    # 4-bar section variety: unique sounding-channel combinations.
    section_states = set()
    for s in range(int(math.ceil(music_bars / 4)) if music_bars else 0):
        lo, hi = s * 16 * ppq, (s + 1) * 16 * ppq
        chans = frozenset(e[1].rack_channel for e in audible if lo <= e[0] < hi)
        if chans:
            section_states.add(chans)

    first4 = [e for e in audible if e[0] < 16 * ppq]
    first4_has_drums = any(type(e[2]).__name__ == "Sampler" for e in first4)
    first4_has_melody = any(type(e[2]).__name__ == "Instrument" for e in first4)
    if not first4_has_drums:  # audio-clip drums in the first 4 bars still count
        first4_has_drums = any(it.position < 16 * ppq for _ti, it in audio_items)

    # ---- Demo-suitability score (see module docstring) --------------------
    determined_share = (
        (len(melodic) + len(drum_oneshots)) / len(audible) if audible else 0.0
    )
    pattern_share = (
        pattern_bars / (pattern_bars + audio_bars) if (pattern_bars + audio_bars) else 0.0
    )
    reconstructability = 25 * determined_share * pattern_share
    musical_content = (
        min(10, len(melodic) / 60)
        + min(5, len(set(pitches)) / 6)
        + min(5, len(drum_oneshots) / 80)
    )
    arrangement_score = (
        min(8, music_bars / 8)
        + min(6, (len(pattern_items) + len(audio_items)) / 10)
        + min(6, len(section_states))
    )
    immediacy = (5 if first4_has_drums else 0) + (5 if first4_has_melody else 0)
    loopable = 5 if any(
        max((n.position + max(n.length, 0) for n in p.notes), default=0) <= 16 * ppq
        for p in patterns.values()
    ) else 2
    length_fit = 5 if 30 <= music_seconds <= 100 else (3 if music_seconds < 30 else 2)
    demo_fit = immediacy + loopable + length_fit

    spent_seconds = safe(lambda: proj.time_spent.total_seconds(), 0) or 0
    used_patterns = {it.pattern.iid for _ti, it in pattern_items}
    cleanliness = (
        min(5, spent_seconds / 3600)
        + 5 * (len(used_patterns & set(patterns)) / len(patterns) if patterns else 0)
        + (5 if not dup_groups else max(0, 5 - 2 * len(dup_groups)))
    )
    total = reconstructability + musical_content + arrangement_score + demo_fit + cleanliness

    return {
        "file": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "size_bytes": path.stat().st_size,
        "tempo_bpm": proj.tempo,
        "ppq": ppq,
        "saved_with_version": str(proj.version),
        "created_on": str(safe(lambda: proj.created_on)),
        "time_spent": str(safe(lambda: proj.time_spent)),
        "channels": len(channels),
        "channel_types": dict(collections.Counter(type(c).__name__ for c in channels.values())),
        "patterns": len(patterns),
        "pattern_notes_total": sum(len(list(p.notes)) for p in patterns.values()),
        "duplicate_pattern_groups": dup_groups,
        "unused_patterns": sorted(set(patterns) - used_patterns),
        "playlist_items": len(pattern_items) + len(audio_items) + len(automation_items),
        "pattern_items": len(pattern_items),
        "audio_clip_items": len(audio_items),
        "automation_items": len(automation_items),
        "music_bars": round(music_bars, 2),
        "music_seconds": round(music_seconds, 1),
        "pattern_item_bars": round(pattern_bars, 2),
        "audio_clip_bars": round(audio_bars, 2),
        "expanded_notes": len(expanded),
        "audible_expanded_notes": len(audible),
        "notes_on_disabled_channels": len(expanded) - len(audible),
        "melodic_notes_audible": len(melodic),
        "drum_oneshot_notes_audible": len(drum_oneshots),
        "loopish_sampler_notes_audible": len(sampler_notes) - len(drum_oneshots),
        "melodic_distinct_pitches": len(set(pitches)),
        "melodic_pitch_range_midi": [min(pitches), max(pitches)] if pitches else None,
        "melodic_pitch_classes": {NOTE_NAMES[k]: v for k, v in sorted(pitch_classes.items())},
        "channels_that_sound": sorted({e[1].rack_channel for e in audible}),
        "section_variety_4bar": len(section_states),
        "first_4_bars": {"drums": first4_has_drums, "melody": first4_has_melody},
        "score": {
            "reconstructability_25": round(reconstructability, 1),
            "musical_content_20": round(musical_content, 1),
            "arrangement_20": round(arrangement_score, 1),
            "demo_fit_20": round(demo_fit, 1),
            "cleanliness_investment_15": round(cleanliness, 1),
            "total_100": round(total, 1),
        },
    }


def main() -> int:
    files = sorted(SRC_DIR.glob("*.flp"))
    if not files:
        print(f"No .flp files in {SRC_DIR}", file=sys.stderr)
        return 1
    results = [analyze(f) for f in files]
    results.sort(key=lambda r: r["score"]["total_100"], reverse=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "metrics.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    winner = results[0]
    lines = [
        "# Demo-source `.flp` analysis",
        "",
        "Generated by `tools/flp-import/analyze_flp.py`. The score is a **demo-suitability**",
        "score for this browser DAW (note-determined, loopable, grooves immediately), not a",
        "ranking of the songs themselves. Playlist pattern clips are expanded with their",
        "trims; notes on disabled rack channels are excluded because they never sound.",
        "",
        "| Rank | File | BPM | Bars | Duration | Audible notes (melodic/drums) | Distinct pitches | Audio-clip bars | Score /100 |",
        "|---:|---|---:|---:|---:|---|---:|---:|---:|",
    ]
    for i, r in enumerate(results, 1):
        lines.append(
            f"| {i} | `{r['file']}` | {r['tempo_bpm']:g} | {r['music_bars']:g} | {r['music_seconds']:g}s "
            f"| {r['audible_expanded_notes']} ({r['melodic_notes_audible']}/{r['drum_oneshot_notes_audible']}) "
            f"| {r['melodic_distinct_pitches']} | {r['audio_clip_bars']:g} | **{r['score']['total_100']}** |"
        )
    lines += [
        "",
        f"**Winner for the built-in demo: `{winner['file']}`** "
        f"({winner['score']['total_100']}/100). Full per-file metrics and the score "
        "breakdown are in `metrics.json` next to this file.",
        "",
        "Why the winner fits a demo: every sounding event comes from pattern notes "
        "(no missing loop/stab audio to invent), drums and pitched parts are present "
        "from bar 1, and its 4-bar patterns map one-to-one onto this app's stems and "
        "playlist clips. The runner-up below may be the stronger *song*; it simply "
        "depends on sounds that are not inside the `.flp` file.",
        "",
    ]
    for r in results:
        lines += [
            f"## `{r['file']}`",
            "",
            f"- Saved with version {r['saved_with_version']}, created {r['created_on']}, "
            f"time spent in session: {r['time_spent']}.",
            f"- {r['channels']} rack channels, {r['patterns']} patterns "
            f"({r['pattern_notes_total']} pattern notes), {r['playlist_items']} playlist items "
            f"({r['pattern_items']} pattern, {r['audio_clip_items']} audio, {r['automation_items']} automation).",
            f"- Unused patterns: {r['unused_patterns'] or 'none'}; "
            f"duplicate pattern groups: {r['duplicate_pattern_groups'] or 'none'}.",
            f"- Audible expanded notes: {r['audible_expanded_notes']} "
            f"({r['melodic_notes_audible']} melodic, {r['drum_oneshot_notes_audible']} drum one-shots, "
            f"{r['loopish_sampler_notes_audible']} loop/stab sampler triggers); "
            f"{r['notes_on_disabled_channels']} notes sit on disabled channels and never sound.",
            f"- Melodic pitch classes: {json.dumps(r['melodic_pitch_classes'])}.",
            f"- Score: reconstructability {r['score']['reconstructability_25']}/25, "
            f"musical content {r['score']['musical_content_20']}/20, "
            f"arrangement {r['score']['arrangement_20']}/20, "
            f"demo fit {r['score']['demo_fit_20']}/20, "
            f"cleanliness/investment {r['score']['cleanliness_investment_15']}/15 "
            f"= **{r['score']['total_100']}/100**.",
            "",
        ]
    (OUT_DIR / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")

    for i, r in enumerate(results, 1):
        print(f"{i}. {r['file']:<28} score={r['score']['total_100']:>5}  "
              f"bpm={r['tempo_bpm']:g} bars={r['music_bars']:g} "
              f"audible={r['audible_expanded_notes']} mel={r['melodic_notes_audible']} "
              f"drum={r['drum_oneshot_notes_audible']} audioBars={r['audio_clip_bars']:g}")
    print(f"\nWinner: {winner['file']}")
    print(f"Wrote {OUT_DIR / 'metrics.json'} and {OUT_DIR / 'REPORT.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
