# DAW — PulseForge Ubuntu Playlist DAW & FL Studio Linux Review

> **Keep this repository private.** It holds a personal backup of FL Studio (commercial software © Image-Line) as release assets. Redistributing it violates the FL Studio EULA.

---

## 1. PulseForge DAW (Native Ubuntu Playlist & Audio Arrangement Workstation)

A fast, zero-Wine, Ubuntu-compatible Digital Audio Workstation focused on **multi-track playlist arrangement, slicing/cutting segments, rearranging, and importing/exporting music** (works on both **Ubuntu Wayland** and **Xorg**).

### Run on Ubuntu

```bash
# Launch directly in a standalone desktop window (or browser):
./run-ubuntu.sh

# Optional: add PulseForge DAW to your Ubuntu Applications menu:
./install-ubuntu-desktop.sh

# Or run the server directly on port 3000:
npm start
```

### Core Capabilities

- **Import Music (`+ Import Audio` or Drag & Drop):**
  - Drop `.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`, `.aac`, or `.webm` files from Ubuntu's `Files` manager directly onto the Audio Pool or any track in the Playlist.
  - Ships with a built-in **demo session, "Untitled" (138 BPM, 34 bars)** — a real production of the project owner, converted from its original session file and re-synthesized in the browser as 5 stems (Drums, Sub Bass, Synth Arp, Ostinato, Lead) that layer in every 4 bars, so you can test cutting and rearranging immediately. Tap **Demo** any time to restore it. How it was chosen and converted: `analysis/flp-demo/REPORT.md` and `tools/flp-import/README.md`.
- **FL-Style Playlist Editing & Slicing Tools:**
  - **Draw / Move / Trim (`P` or `1`):** Drag clips across time and tracks; drag left/right clip edges to non-destructively trim start/end points; drag top-left/top-right corners for visual **Fade In / Fade Out** curves; double-click a clip to split it on the spot; right-click a clip to delete it.
  - **Cut / Razor Slice (`C` or `2`):** Hover over any clip to preview the red razor cut line (snapped to the grid, or hold `Alt` for free-hand cutting) and click to slice it into two independent segments.
  - **Slip Audio (`S` or `3`):** Drag inside a sliced segment to slide its underlying audio earlier/later without moving the segment's boundaries on the timeline.
  - **Mute Segment (`T` or `4`):** Mute/unmute individual segments on the playlist.
  - **Box Select (`E` or `5`):** Marquee-select multiple segments to move, duplicate (`Ctrl+D`), split, or delete together.
  - **One-Click Chop & Rearrange Helpers:**
    - `Split @ Playhead (K)` — cut selected clip(s) (or all clips) at the playhead
    - `Chop 1-Beat` / `Chop 1-Bar` / `Slice 1/2 Bar` / `Slice 1/8 Note` — automatically slice any clip into uniform segments
    - `Auto-Slice Hits` — detect drum/note transients and slice into hit segments
    - `Duplicate (Ctrl+D)` & `Reverse (R)` — flip individual slices in place
- **Per-Segment Inspector & Per-Track Mixer/EQ:**
  - Per-segment Gain (`-24` to `+12 dB`), Pitch/Speed (`-12` to `+12` semitones), Pan, Fade-In/Out, Reverse, and Color.
  - Per-track Mute (`M`), Solo (`S`), Volume, Pan, Peak Meter, and 3-Band EQ (Low Shelf 120 Hz, Mid Peak 1.1 kHz, High Shelf 6.5 kHz) + Master Limiter & Stereo Peak Meter.
- **Export Music (`⬇ Export Music`):**
  - Faster-than-realtime offline render to **16-bit PCM WAV**, **24-bit Studio Master WAV**, or **32-bit IEEE Float WAV** (`44.1 kHz` or `48 kHz`).
  - Export either the **Master Stereo Mixdown** or **All Active Tracks as Separate Stems**, for the full song or the selected loop region.

---

## 2. FL Studio → Linux Porting Review

📄 **[docs/FLSTUDIO_LINUX_PORTING_REVIEW.md](docs/FLSTUDIO_LINUX_PORTING_REVIEW.md)**: what the `FLSTUDIO` archive contains, what "semi-ported" means for it, the startup blocker (`WINTRUST_DefaultVerify returning 80096004` / Wine bug 60273), and effort estimates for each route:

| Route | Effort |
|---|---|
| A. Make the existing Wine setup work (e.g. via [`Torbuntu/fl-studio-linux-setup`](https://github.com/Torbuntu/fl-studio-linux-setup)) | 0.5–2 days |
| A+. Reproducible Wine package | 2–4 weeks + upkeep |
| B. True native port (Image-Line only, needs source) | ~1–2 years to beta |
| C. Port from binaries (reverse engineering) | not viable |
| D. Clean-room FL-like DAW (started in `app/`) | MVP in repo; full parity many person-years |

Supporting analysis (text only, generated from the archive):
- [`analysis/flstudio/REPORT.md`](analysis/flstudio/REPORT.md): inventory, toolchains, signatures, porting signals
- [`analysis/flstudio/PREFIX_DETAILS.md`](analysis/flstudio/PREFIX_DETAILS.md): launcher script and allowlisted Wine configuration
- [`analysis/flstudio/RELEASE_VERIFICATION.md`](analysis/flstudio/RELEASE_VERIFICATION.md): end-to-end checksum verification of the release
- `analysis/flstudio/{manifest,binaries}.tsv`, `summary.json`: full listings

---

## 3. FL Studio Archive Backup (`FLSTUDIO.zip`)

Stored as assets of the release **[`flstudio-archive-2026-10-14`](https://github.com/DOGECOIN87/DAW/releases/tag/flstudio-archive-2026-10-14)**. GitHub limits each asset to under 2 GiB, so the zip is split into two byte-exact parts:

| File | Size (bytes) | SHA-256 |
|---|---:|---|
| `FLSTUDIO.zip.part-00` | 1,394,723,771 | `9e6fa0dff0616d78f79c3354e98455768600d6ce339e019d9ce67e52fd8cb671` |
| `FLSTUDIO.zip.part-01` | 1,394,723,771 | `3cc8cfe1a3c2202048d272ee27f46766973cce5e6069562aef6e3b2b91b111c9` |
| `FLSTUDIO.zip` (re-joined) | 2,789,447,542 | `843750711a8036919668dc833d3bac21cd5ea159c9c13e160843e6ccdab0f40e` |

### Restore

```sh
gh release download flstudio-archive-2026-10-14 -R DOGECOIN87/DAW   # or download the 3 files from the release page

# Linux / macOS
cat FLSTUDIO.zip.part-00 FLSTUDIO.zip.part-01 > FLSTUDIO.zip
sha256sum -c SHA256SUMS.txt          # macOS: shasum -a 256 -c SHA256SUMS.txt
```

```bat
:: Windows (Command Prompt)
copy /b FLSTUDIO.zip.part-00 + FLSTUDIO.zip.part-01 FLSTUDIO.zip
certutil -hashfile FLSTUDIO.zip SHA256
```
## Tooling

- [`tools/transfer/analyze_zip.py`](tools/transfer/analyze_zip.py): text-only archive inventory and porting-signal analyzer (PE/ELF/Mach-O, Delphi/MSVC/.NET fingerprints, Authenticode, plugin entry points).
- [`tools/transfer/inspect_prefix.py`](tools/transfer/inspect_prefix.py): allowlisted Wine-prefix inspector. It never prints licence, registration or account data.
- [`.github/workflows/drive-transfer.yml`](.github/workflows/drive-transfer.yml): the one-off Google Drive → Release transfer. It downloaded the file, verified it, analyzed it, waited for approval, then split and published it. Now manual-only, and it needs a new `.github/transfer/request.json` to run again.
- [`.github/workflows/inspect-release.yml`](.github/workflows/inspect-release.yml): re-verifies the release end to end and regenerates the analysis. Manual-only; run it from the Actions tab once this branch is merged into the default branch.
