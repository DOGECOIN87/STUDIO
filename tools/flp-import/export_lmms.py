#!/usr/bin/env python3
"""Export the built-in demo session as a native LMMS project (.mmp + .mmpz).

Reads the same generated data the web app plays (`app/public/demo-song.js`),
so the LMMS project is note-for-note the demo you hear in Audius Studio:

- Drum hits become AudioFileProcessor tracks pointing at factory samples
  that ship with every LMMS install (`drums/kick_hiphop01.ogg`, ...), played
  at the base note (key 69). The original session's FX one-shots have no
  factory equivalent and are mapped to an open hi-hat as a placeholder.
- Pitched stems become TripleOscillator tracks (wave shapes / envelopes
  chosen per role: sub bass, pluck arp, stab ostinato, lead).
- One Song-Editor pattern per playlist clip; 48 ticks per beat, key = MIDI
  note number (both verified against LMMS's own source and bundled demos).

Format notes: LMMS is GPL-2.0; no code or content is copied from it — this
generator only *writes* its documented-in-practice XML project format
(structure cross-checked against `data/projects/demos/TobyDox-Psycho.mmpz`
and `include/Oscillator.h` enum values). The `.mmpz` is the same XML run
through Qt-style qCompress framing (4-byte big-endian length + zlib), which
is how LMMS itself stores compressed projects.

Not render-tested with a real LMMS binary in the sandbox (release-asset
hosts are unreachable here) — validated structurally instead; please open
it in LMMS to confirm and to re-voice parts to taste.

Usage:
    python3 tools/flp-import/export_lmms.py
Writes: flp-imports/exports/Untitled (Demo Session).mmp[.z]
"""

from __future__ import annotations

import json
import pathlib
import struct
import xml.etree.ElementTree as ET
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEMO_JS = ROOT / "app" / "public" / "demo-song.js"
OUT_DIR = ROOT / "flp-imports" / "exports"

TICKS_PER_BEAT = 48
# Oscillator.h: Sine=0 Triangle=1 Saw=2 Square=3 MoogSaw=4 Exponential=5 WhiteNoise=6
# ModulationAlgo: SignalMix=2 (plain summing of the three oscillators)
WAVE = {"sine": 0, "triangle": 1, "saw": 2, "square": 3, "moog": 4}

DRUM_TRACKS = {  # hit type -> (track name, factory sample, note length ticks)
    "kick": ("Kick", "drums/kick_hiphop01.ogg", 48),
    "snare": ("Snare", "drums/snare_hiphop01.ogg", 36),
    "clap": ("Clap", "drums/clap01.ogg", 36),
    "hat": ("Hi-Hat", "drums/hihat_closed01.ogg", 12),
    "tom": ("Tom", "drums/tom_mid01.ogg", 36),
    "rim": ("Rim", "drums/rim01.ogg", 12),
    "fx": ("FX (open hat stand-in)", "drums/hihat_opened01.ogg", 48),
    "perc": ("Percussion", "drums/shaker01.ogg", 24),
}

# TripleOscillator patches per demo voice: 3 x (wave, vol, coarse semitones, fine detune cents L/R)
PATCHES = {
    "reese": [(WAVE["sine"], 100, 0, 0, 0), (WAVE["saw"], 32, 0, -6, 6), (WAVE["saw"], 32, 0, 6, -6)],
    "pluck": [(WAVE["triangle"], 100, 0, 0, 0), (WAVE["sine"], 45, 12, 0, 0), (WAVE["sine"], 0, 0, 0, 0)],
    "stab": [(WAVE["saw"], 90, 0, -5, 5), (WAVE["square"], 45, 0, 5, -5), (WAVE["sine"], 0, 0, 0, 0)],
    "lead": [(WAVE["saw"], 85, 0, -4, 4), (WAVE["saw"], 85, 0, 4, -4), (WAVE["sine"], 35, -12, 0, 0)],
}
ENVELOPES = {  # voice -> (att, hold, dec, sustain, rel) seconds/level for the volume envelope
    "reese": (0.01, 0.0, 0.25, 0.85, 0.08),
    "pluck": (0.002, 0.0, 0.28, 0.12, 0.05),
    "stab": (0.002, 0.0, 0.16, 0.35, 0.04),
    "lead": (0.03, 0.0, 0.3, 0.9, 0.12),
    "drums": (0.0, 0.0, 0.1, 1.0, 0.02),
}

EL_ENV_ATTRS = ["latt", "lamt", "lspd_numerator", "lspd_denominator", "userwavefile",
                "ctlenvamt", "lshp", "x100", "lpdel", "lspd", "pdel", "syncmode"]


def el(tag, parent=None, **attrs):
    node = ET.SubElement(parent, tag) if parent is not None else ET.Element(tag)
    for k, v in attrs.items():
        node.set(k, str(v))
    return node


def env(parent, tag, att=0, hold=0, dec=0.1, sustain=0.5, rel=0.1, amt=0):
    node = el(tag, parent, att=att, hold=hold, dec=dec, sustain=sustain, rel=rel, amt=amt)
    for k in EL_ENV_ATTRS:
        node.set(k, {"lspd_numerator": "1", "lspd_denominator": "1", "lspd": "0.1"}.get(k, "0"))
    return node


def instrument_track(track_el, instrument_el_fn, voice, vol_pct, pan_pct):
    it = el("instrumenttrack", track_el, pitch=0, fxch=0, basenote=69,
            usemasterpitch=1, pitchrange=1, vol=int(round(vol_pct)), pan=int(round(pan_pct)))
    ins = el("instrument", it)
    instrument_el_fn(ins)
    a, h, d, s, r = ENVELOPES[voice]
    eldata = el("eldata", it, ftype=0, fres=1, fcut=14000, fwet=1)
    env(eldata, "elvol", att=a, hold=h, dec=d, sustain=s, rel=r, amt=1)
    env(eldata, "elcut")
    env(eldata, "elres")
    el("chordcreator", it, chord=0, chordrange=1, **{"chord-enabled": 0})
    el("arpeggiator", it, arp=0, arptime_numerator=1, arptime_denominator=1, arprange=1,
       arpmode=0, arptime=100, arpdir=0, arpgate=100, syncmode=0, **{"arp-enabled": 0})
    el("midiport", it, outputchannel=1, outputcontroller=0, basevelocity=127, outputprogram=1,
       fixedinputvelocity=-1, fixedoutputvelocity=-1, fixedoutputnote=-1,
       inputchannel=0, inputcontroller=0, readable=0, writable=0)
    el("fxchain", it, enabled=0, numofeffects=0)
    return it


def tripleosc(fn_parent, patch):
    def build(ins):
        ins.set("name", "tripleoscillator")
        attrs = {}
        for i, (wave, vol, coarse, finel, finer) in enumerate(patch):
            attrs[f"wavetype{i}"] = wave
            attrs[f"vol{i}"] = vol
            attrs[f"coarse{i}"] = coarse
            attrs[f"finel{i}"] = finel
            attrs[f"finer{i}"] = finer
            attrs[f"pan{i}"] = 0
            attrs[f"phoffset{i}"] = 0
            attrs[f"stphdetun{i}"] = 0
            attrs[f"userwavefile{i}"] = "empty.wav"
            attrs[f"modalgo{i + 1}"] = 2  # SignalMix
        el("tripleoscillator", ins, **attrs)
    return build


def audiofileprocessor(src):
    def build(ins):
        ins.set("name", "audiofileprocessor")
        el("audiofileprocessor", ins, stutter=0, interp=1, reversed=0, looped=0,
           sframe=0, lframe=0, src=src, eframe=1, amp=100)
    return build


def add_pattern(track_el, name, start_beat, dur_beats, notes):
    pat = el("pattern", track_el, name=name,
             pos=int(round(start_beat * TICKS_PER_BEAT)),
             len=int(round(dur_beats * TICKS_PER_BEAT)), muted=0, type=0)
    for key, pos, length, vol, pan in notes:
        el("note", pat, key=int(key), pos=int(round(pos)), len=max(1, int(round(length))),
           vol=max(1, min(200, int(round(vol)))), pan=max(-100, min(100, int(round(pan)))))
    return pat


def main() -> int:
    text = DEMO_JS.read_text(encoding="utf-8")
    song = json.loads(text[text.index("= {") + 2: text.rindex("};") + 1])
    stems = {s["id"]: s for s in song["stems"]}
    track_info = {t["id"]: t for t in song["tracks"]}
    clips_by_stem: dict[str, list] = {}
    for c in song["clips"]:
        clips_by_stem.setdefault(c["stem"], []).append(c)

    root = el("lmms-project", None, version="1.0", creator="LMMS",
              creatorversion="1.2.2", type="song")
    el("head", root, timesig_numerator=4, timesig_denominator=4,
       bpm=song["bpm"], mastervol=100, masterpitch=0)
    song_el = el("song", root)
    container = el("trackcontainer", song_el, type="song", maximized=0, minimized=0,
                   visible=1, x=5, y=1, width=900, height=480)

    def db_to_pct(db):
        return 100 * (10 ** (db / 20))

    stats = []
    # Drums: one AudioFileProcessor track per drum type, patterns from drum clips.
    drum_stem = next(s for s in song["stems"] if s["voice"] == "drums")
    drum_track = next(c["track"] for c in song["clips"] if c["stem"] == drum_stem["id"])
    drum_vol = db_to_pct(track_info[drum_track]["volumeDb"])
    for hit_type, (tname, src, note_len) in DRUM_TRACKS.items():
        hits = [h for h in drum_stem["hits"] if h[1] == hit_type]
        if not hits:
            continue
        tr = el("track", container, name=tname, type=0, muted=0, solo=0)
        instrument_track(tr, audiofileprocessor(src), "drums", drum_vol, 0)
        placed = 0
        for c in clips_by_stem[drum_stem["id"]]:
            notes = [(69, h[0] * TICKS_PER_BEAT, note_len, 20 + h[2] * h[3] * 110, 0)
                     for h in hits if h[0] < c["dur"]]
            placed += len(notes)
            add_pattern(tr, c["name"], c["start"], c["dur"], notes)
        stats.append((tname, src, placed))

    # Pitched stems: TripleOscillator tracks in playlist-track order.
    order = {t["id"]: i for i, t in enumerate(song["tracks"])}
    pitched = [s for s in song["stems"] if s["voice"] != "drums"]
    pitched.sort(key=lambda s: order[clips_by_stem[s["id"]][0]["track"]])
    for stem in pitched:
        first_clip = clips_by_stem[stem["id"]][0]
        tinfo = track_info[first_clip["track"]]
        tr = el("track", container, name=tinfo["name"].split("· ")[-1], type=0, muted=0, solo=0)
        instrument_track(tr, tripleosc(None, PATCHES[stem["voice"]]), stem["voice"],
                         db_to_pct(tinfo["volumeDb"]) * stem.get("gain", 1), tinfo["pan"] * 100)
        placed = 0
        for c in clips_by_stem[stem["id"]]:
            notes = [(n[1], n[0] * TICKS_PER_BEAT, n[2] * TICKS_PER_BEAT,
                      20 + n[3] * 110, n[4] * 100)
                     for n in stem["notes"] if n[0] < c["dur"]]
            placed += len(notes)
            add_pattern(tr, c["name"], c["start"], c["dur"], notes)
        stats.append((tinfo["name"], f"tripleoscillator ({stem['voice']})", placed))

    fxmixer = el("fxmixer", song_el, maximized=0, minimized=0, visible=1,
                 x=802, y=329, width=530, height=332)
    fxch = el("fxchannel", fxmixer, muted=0, num=0, name="Master", volume=1, soloed=0)
    el("fxchain", fxch, enabled=0, numofeffects=0)
    el("controllers", song_el)

    ET.indent(root, space="  ")
    xml = ('<?xml version="1.0"?>\n<!DOCTYPE lmms-project>\n'
           + ET.tostring(root, encoding="unicode") + "\n")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    base = OUT_DIR / "Untitled (Demo Session)"
    mmp_path = base.with_suffix(".mmp")
    mmp_path.write_text(xml, encoding="utf-8")
    raw = xml.encode("utf-8")
    mmpz_path = base.with_suffix(".mmpz")
    mmpz_path.write_bytes(struct.pack(">I", len(raw)) + zlib.compress(raw, 9))

    # Self-validation: reparse, recount notes, verify .mmpz round-trips.
    reparsed = ET.fromstring(xml)
    n_notes = len(list(reparsed.iter("note")))
    expected = sum(s[2] for s in stats)
    assert n_notes == expected, (n_notes, expected)
    payload = mmpz_path.read_bytes()
    assert zlib.decompress(payload[4:]) == raw
    assert int.from_bytes(payload[:4], "big") == len(raw)

    print(f"Demo: {song['title']} @ {song['bpm']} BPM, {song['totalBeats']} beats")
    for name, kind, count in stats:
        print(f"  track {name:<26} {kind:<34} notes placed: {count}")
    print(f"Total notes in project: {n_notes} (validated by reparse)")
    print(f"Wrote {mmp_path.name} ({mmp_path.stat().st_size} B) and "
          f"{mmpz_path.name} ({mmpz_path.stat().st_size} B, round-trip verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
