#!/usr/bin/env python3
"""Export each `.flp` session in `flp-imports/` as a type-1 MIDI file.

Why: LMMS (github.com/LMMS/lmms) has no `.flp` importer, but it imports MIDI
(File > Import), as does every other DAW. These exports are the practical
bridge for hearing/editing the three sessions outside their original app.

What you get / don't get:
- The *arranged* song: playlist pattern clips are expanded in order, with
  clip trims respected and notes on disabled rack channels dropped (they
  never sound). Pattern-internal timing/pitch/velocity/length are exact.
- Instrument channels become melodic tracks (GM program picked from the
  part's pitch range). Sampler channels become GM drum tracks on channel 10,
  with the drum key chosen from the sample name (kick/snare/hat/...).
- Playlist *audio clips* (loops/stabs) and automation are NOT in MIDI — a
  session that leans on them (see analysis/flp-demo/REPORT.md) will export
  as its note skeleton only. Counts are printed so nothing vanishes silently.

Usage:
    python3 tools/flp-import/export_midi.py
Writes: flp-imports/exports/<session>.mid
"""

from __future__ import annotations

import pathlib
import struct
import sys

import pyflp

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "flp-imports"
OUT_DIR = SRC_DIR / "exports"

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MIDI_PPQ = 480
GM_DRUM = {  # sample-name keyword -> General MIDI drum key
    "kick": 36, "kik": 36, "bassdrum": 36,
    "snare": 38, "snr": 38,
    "clap": 39,
    "rim": 37,
    "hat": 42, "ixh": 42,
    "open": 46,
    "tom": 45, "bigbad_t": 45,
    "crash": 49, "ride": 51,
    "shaker": 70, "perc": 70, "ixp": 70,
    "fx": 56, "ixe": 56,
    "chop": 60,
}


def midi_of(key: str) -> int:
    s = str(key)
    if len(s) >= 2 and s[1] == "#":
        return (int(s[2:]) + 1) * 12 + NOTE_NAMES.index(s[:2])
    return (int(s[1:]) + 1) * 12 + NOTE_NAMES.index(s[:1])


def gm_drum_key(channel) -> int:
    name = (getattr(channel, "name", "") or "").lower()
    for kw in ("open",):  # "open hihat" must win over "hat"
        if kw in name:
            return GM_DRUM[kw]
    for kw, key in GM_DRUM.items():
        if kw in name:
            return key
    return 38


def vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


def track_chunk(events) -> bytes:
    """events: list of (tick, bytes) in absolute ticks; returns an MTrk chunk."""
    events.sort(key=lambda e: e[0])
    data = bytearray()
    last = 0
    for tick, payload in events:
        data += vlq(max(0, tick - last))
        data += payload
        last = tick
    data += vlq(0) + b"\xff\x2f\x00"  # end of track
    return b"MTrk" + struct.pack(">I", len(data)) + bytes(data)


def meta_name(text: str) -> bytes:
    raw = text.encode("utf-8", "replace")[:64]
    return b"\xff\x03" + vlq(len(raw)) + raw


def export(path: pathlib.Path) -> dict:
    proj = pyflp.parse(str(path))
    ppq = proj.ppq
    scale = MIDI_PPQ / ppq
    channels = {c.iid: c for c in proj.channels}
    patterns = {p.iid: p for p in proj.patterns}
    arrangement = list(proj.arrangements)[0] if list(proj.arrangements) else None

    per_channel_notes: dict[int, list] = {}
    n_pattern_items = n_audio_items = 0
    if arrangement is not None:
        for track in arrangement.tracks:
            for item in list(track):
                if type(item).__name__ == "PatternPLItem":
                    n_pattern_items += 1
                    pat = patterns[item.pattern.iid]
                    for note in pat.notes:
                        if note.position >= item.length:
                            continue
                        ch = channels.get(note.rack_channel)
                        if ch is None or not getattr(ch, "enabled", True):
                            continue
                        start = int(round((item.position + note.position) * scale))
                        length = int(round(max(note.length, 0) * scale))
                        per_channel_notes.setdefault(note.rack_channel, []).append(
                            (start, length, note))
                elif type(item.channel).__name__ != "Automation":
                    n_audio_items += 1

    tempo_us = int(round(60_000_000 / proj.tempo)) if proj.tempo else 500_000
    conductor = track_chunk([
        (0, meta_name(path.stem)),
        (0, b"\xff\x51\x03" + tempo_us.to_bytes(3, "big")),
        (0, b"\xff\x58\x04\x04\x02\x18\x08"),
    ])

    chunks = [conductor]
    report_tracks = []
    melodic_channel = 0
    total_notes = 0
    for ch_iid in sorted(per_channel_notes):
        ch = channels[ch_iid]
        notes = per_channel_notes[ch_iid]
        is_sampler = type(ch).__name__ == "Sampler"
        if is_sampler:
            midi_ch = 9  # GM drums
            drum_key = gm_drum_key(ch)
        else:
            if melodic_channel == 9:
                melodic_channel += 1
            midi_ch = melodic_channel
            melodic_channel += 1
            drum_key = None

        events = [(0, meta_name(f"{ch_iid}: {ch.name}"))]
        if not is_sampler:
            pitches = [midi_of(n.key) for _s, _l, n in notes]
            program = 38 if pitches and sorted(pitches)[len(pitches) // 2] < 52 else 80
            events.append((0, bytes([0xC0 | midi_ch, program])))
        try:
            vol7 = max(0, min(127, int(round((ch.volume or 10000) / 10000 * 100))))
        except Exception:
            vol7 = 100
        events.append((0, bytes([0xB0 | midi_ch, 7, vol7])))

        # Note on/off with overlap protection per key.
        open_until: dict[int, int] = {}
        for start, length, note in sorted(notes, key=lambda x: (x[0], x[1])):
            key = drum_key if is_sampler else midi_of(note.key)
            if length <= 0:
                length = 24
            if key in open_until and open_until[key] > start:
                events.append((start, bytes([0x80 | midi_ch, key, 0])))
            vel = max(1, min(127, int(note.velocity)))
            events.append((start, bytes([0x90 | midi_ch, key, vel])))
            events.append((start + length, bytes([0x80 | midi_ch, key, 0])))
            open_until[key] = start + length
            total_notes += 1
        chunks.append(track_chunk(events))
        report_tracks.append(
            f"ch{ch_iid} {ch.name!r} -> MIDI ch {midi_ch + 1}"
            + (f" drum key {drum_key}" if is_sampler else "")
            + f" ({len(notes)} notes)")

    smf = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), MIDI_PPQ) + b"".join(chunks)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / (path.stem + ".mid")
    out_path.write_bytes(smf)
    return {
        "file": path.name, "out": out_path.name, "tracks": report_tracks,
        "notes": total_notes, "pattern_items": n_pattern_items,
        "audio_items_omitted": n_audio_items, "bytes": len(smf),
    }


def main() -> int:
    files = sorted(SRC_DIR.glob("*.flp"))
    if not files:
        print(f"No .flp files in {SRC_DIR}", file=sys.stderr)
        return 1
    for f in files:
        r = export(f)
        print(f"\n{r['file']} -> exports/{r['out']}  ({r['bytes']} bytes, {r['notes']} notes, "
              f"{r['pattern_items']} pattern clips, {r['audio_items_omitted']} audio clips omitted)")
        for t in r["tracks"]:
            print(f"  {t}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
