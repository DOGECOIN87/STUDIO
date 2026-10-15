# FL Studio on Linux: porting review (complexity and time estimates)

| | |
|---|---|
| **Date** | 2026-10-15 |
| **Scope** | Review only. No port was attempted. This document records what is in the `FLSTUDIO` archive, what "semi-ported" means for it, and how much work each route to FL Studio on Linux would take. |
| **Inputs** | `FLSTUDIO.zip` (2,789,447,542 bytes, SHA-256 `8437…f40e`), its automated analysis in [`analysis/flstudio/`](../analysis/flstudio/), and public sources (linked inline). |
| **Method** | Static analysis only: zip inventory, PE/Authenticode inspection of all 1,781 Windows binaries, and allowlisted Wine-registry extraction. Nothing was executed. No licence or registration data was read into reports. |

---

## 1. Executive summary

**What the archive is.** It is **not source code and not a native port.** It contains a **Wine prefix** (`FLSTUDIO/.wine/`) with the official **FL Studio 2026 v26.1.7.5654** installed, as built and signed by Image-Line. It also contains the official installer (`FLStudioDemo.exe`, Image Line NV signature intact) and a launcher script (`launch_flstudio_demo.sh`). The prefix was created on Ubuntu with the distro's **Wine 9.0** on 2026-10-14. "Semi-ported" therefore means *installed under Wine on Linux*. The program code is the unmodified Windows build.

**Main finding: the setup almost certainly does not start yet.** FL Studio **26.1.4 and later refuses to start under stock Wine** with *"The validity of the program could not be verified"*. Wine fails to verify Image-Line's new code signature. The fix is an **open, unmerged** Wine merge request ([!11824](https://gitlab.winehq.org/wine/wine/-/merge_requests/11824), [bug 60273](https://bugs.winehq.org/show_bug.cgi?id=60273)). The archive's version, 26.1.7, is affected, and the registry contains no per-user FL settings, which fits FL never having completed a first launch. Other gaps:
- no low-latency audio (no WineASIO);
- the **WebView2 runtime failed to install**, which breaks FL Cloud, sign-in and the web panels;
- an old Wine (9.0 vs the current 11.x);
- a launcher that refuses Wayland sessions.

**Estimates:**

| Route | What you get | Effort | Feasible for you? |
|---|---|---|---|
| **A. Fix this Wine setup** (recommended) | FL Studio 2026 usable on your Ubuntu machine | **0.5–2 days** | ✅ Yes |
| **A+. Reproducible Wine package** | Scripted installer, pinned Wine runner, audio, launcher and docs others can use (no FL binaries redistributed) | **2–4 weeks** + ongoing upkeep after each FL/Wine release | ✅ Yes |
| **B. True native Linux port** | Real Linux build of FL Studio | **~1–2 years to beta, 2–3 to parity** for a dedicated Image-Line team | ❌ Only Image-Line (requires source code) |
| **C. Port from these binaries** | Nothing usable | Effectively unbounded; prohibited by the EULA | ❌ No |
| **D. Build an FL-like native DAW** | A different product with an FL-style workflow | MVP **6–12 months** (2–3 devs); parity is many person-years | ⚠️ Possible, but not "FL Studio" |

---

## 2. What is in the archive (evidence)

Full machine-generated details: [`REPORT.md`](../analysis/flstudio/REPORT.md), [`PREFIX_DETAILS.md`](../analysis/flstudio/PREFIX_DETAILS.md), [`binaries.tsv`](../analysis/flstudio/binaries.tsv), [`manifest.tsv`](../analysis/flstudio/manifest.tsv).

| Part | Files | Size (uncompressed) | Notes |
|---|---:|---:|---|
| `FLSTUDIO/.wine/drive_c/Program Files/Image-Line/FL Studio 2026/` | 27,401 | 2.15 GB | FL Studio 26.1.7.5654: engine, 161 native plugins, presets, demo projects, samples |
| `FLSTUDIO/.wine/drive_c/windows/` | 1,687 | 1.29 GB | Wine 9.0 built-in DLLs (Ubuntu package build date 2024-04-01) |
| `FLSTUDIO/FLStudioDemo.exe` | 1 | 1.11 GB | Official FL Studio installer (NSIS); Image Line NV signature, digest intact |
| `…/users/mattrick/Temp/MicrosoftEdgeWebView2RuntimeInstallerX64.exe` | 1 | 0.20 GB | Leftover WebView2 installer (its install failed, see §3) |
| `FLSTUDIO/launch_flstudio_demo.sh` | 1 | 1.2 KB | User-written launcher (see §3) |
| registry (`system.reg`, `user.reg`, `userdef.reg`), `dosdevices/`, misc | ~90 | ~4 MB | Standard Wine prefix files |
| **Total** | **29,181** | **4.44 GiB** | Zip: 2.60 GiB |

**Integrity and legitimacy checks (passed):**
- `FLEngine_x64.dll` (*FL Studio engine*, 26.1.7.5654, built 2026-10-08) and the installer are Authenticode-signed by **Image Line NV (Gent, BE)**, and their **digests match**, so the binaries are unmodified.
- After false positives (sample names such as "FPC Ice Crack.wav", FL's own *Patcher* plugin) were filtered out, **there were no crack, keygen or patch artifacts**. `.reg` files were listed but never read. Only allowlisted Wine configuration keys were extracted.
- No user projects or user data are included. Wine maps `Documents`/`Music` to the Linux home folder, which is outside the archive.

---

## 3. What "semi-ported" means here

**Timeline reconstructed from file times (2026-10-14, local time):**

| Time | Event |
|---|---|
| 21:56 | Fresh 64-bit Wine prefix created (`wineboot`); FL installer started (NSIS temp files) |
| 21:59 | FL Studio 2026 installed; Start-menu shortcuts written |
| 21:59–22:02 | Bundled **WebView2 runtime install fails**: Edge Update reports `Main failed`, `0x80040902`, then rolls back ("Uninstall complete") |
| 22:06 | Last registry write |
| 22:07 | `launch_flstudio_demo.sh` written |

**The launcher** ([full text](../analysis/flstudio/PREFIX_DETAILS.md)):
- refuses to run without a real X display;
- refuses the fake Xvfb display `:99`, which hints that earlier attempts ran headless;
- **refuses Wayland/XWayland sessions** and asks for "Ubuntu on Xorg";
- sets `WINEPREFIX` and `WINEARCH=win64`, then `exec wine FL64.exe`.

It sets no audio configuration, DLL overrides, DXVK, fonts or debug/perf variables.

**Wine configuration (allowlisted):**
- Emulated OS: Windows 10 Pro (build 19043), the Wine default.
- `DllOverrides`: empty.
- No `Software\Wine\Drivers` audio override, so the audio driver is Wine's default (PulseAudio/PipeWire via `winepulse`).
- No WineASIO, DXVK or vkd3d-proton; all D3D DLLs are Wine built-ins.
- No Mono/.NET, although FL ships a .NET assembly (`FLMManaged.dll`).
- No WebView2 runtime.
- Only installer-written Image-Line registry keys exist. There are **no per-user FL Studio settings**, which suggests FL64.exe has not completed a first run.

**Most likely blocker:**
1. FL Studio 26.1.4+ binaries carry signatures whose signed attributes are not in canonical DER order.
2. Wine's `crypt32` re-sorts those attributes while verifying, so the digest no longer matches.
3. Wine then reports `TRUST_E_CERT_SIGNATURE`, and FL refuses to start.

The FL engine imports `wintrust.dll`/`crypt32.dll`, which is consistent with this self-check. The fix is [Wine MR !11824](https://gitlab.winehq.org/wine/wine/-/merge_requests/11824). It is still open, and a user comment from 2026-09-30 confirms it lets current FL Studio run. The community [FL Studio Linux setup guide](https://github.com/Torbuntu/fl-studio-linux-setup) documents the same breakage, and two workarounds: a patched runner ([DAW-GE-Proton11-6c](https://github.com/KitsuneDev/daw-proton-ge)), or staying on FL ≤ 26.1.3.

---

## 4. Technical anatomy of FL Studio 2026 (from the binaries)

Of the 311 PE files under `Program Files/Image-Line` (1.06 GB):

| Component | Count | Size | Toolchain / notes |
|---|---:|---:|---|
| FL engine + native plugins + tools | **154** | 720 MB | **Embarcadero Delphi 12** (compiler 36.0, Win64/Win32). 153 reference **VCL** units, which are Windows-only. Streamed Delphi forms in most. |
| DSP / engines / runtimes | 106 | 237 MB | **MSVC C/C++**: Intel IPP (`dsp_ippv2*`), zplane élastique, Newtone engine, FLEX engine, FL Studio Mobile, NDI, Python 3.12, OpenSSL |
| Managed code | 2 | ~9 MB | **.NET** (`FLMManaged.dll`) |
| Bundled tools | ~49 | — | LilyPond (score export) with GLib/Pango/Guile/Ghostscript, FFmpeg 4.x (`avcodec-58`), SQLite |
| Architectures | 259 x64 / 52 x86 | | 32-bit parts are bridges, installers and legacy components |

- **Plugin interfaces:** 161 modules export `CreatePlugInstance` (FL native plugin format). 9 export `VSTPluginMain` (VST2 builds of FL plugins). The engine contains VST3 and ASIO hosting strings.
- **Windows API surface** (number of FL's own binaries importing each library):
  - UI: `user32` 207, `gdi32` 179, `comctl32` 152, `uxtheme` 147, `dwmapi` 156, `shcore` 147 (DPI), `imm32` 151, `msimg32` 149, `windowscodecs` 154.
  - COM and shell: `ole32` 192, `oleaut32` 158, `shell32` 192.
  - Audio: `winmm` 167, `msacm32` 149; also DirectSound, ASIO and WASAPI.
  - Graphics: `opengl32`, `d3d9`, `d3d11`.
  - Security and network: `wintrust`/`crypt32` (self-verification), `wininet`, `ws2_32`.
  - Web UI: WebView2 (FL Cloud, sign-in, news/help panels).
- **Codebase scale** (public): FL Studio had **more than 2.5 million lines of Delphi and 300+ assembler functions** already when Embarcadero wrote its case study ([Embarcadero](https://www.embarcadero.com/case-study/image-line-software-case-study)).
- **Portability already proven by Image-Line:**
  - a native **macOS** build since FL 20 (2018) ([The Verge](https://www.theverge.com/2018/5/23/17384580/music-production-software-fruity-loops-20-mac-compatible));
  - native **ARM64** code on Apple Silicon since FL 20.8.4 (2021) ([Morningdew Media](https://www.morningdewmedia.com/fl-studio-on-m1-mac/)).

  So the codebase already compiles with LLVM-based Delphi back ends and has non-x86 fallbacks for its assembly. The Windows build still uses VCL, which means the Mac build must use a separate UI/platform layer.

---

## 5. Route A: make the Wine setup work (recommended)

| # | Task | Why | Effort |
|---|---|---|---|
| 1 | Fix the startup blocker. Use a Wine runner that includes MR !11824 (e.g. DAW-GE-Proton11-6c via Bottles), build Wine 11.x with the patch, or install FL ≤ 26.1.3 until the fix lands upstream. | FL 26.1.4+ refuses to start on stock Wine | 1–4 h |
| 2 | Move from Ubuntu's Wine 9.0 to **Wine 11.x** (WineHQ packages or a Bottles runner). | Wine 11 adds NTSYNC and the finished new WoW64 ([WineHQ](https://www.winehq.org/news/2026011301)); Wine 9.0 lacks nearly two years of fixes | 0.5–1 h (included if you use a patched 11.x runner) |
| 3 | Fonts: `winetricks corefonts` (or Bottles "allfonts") plus `msgothic` for ♯/♭ glyphs. | Missing glyphs and UI text | 15–30 min |
| 4 | Audio: PipeWire with `pipewire-jack`, plus **WineASIO 1.3.0** registered in the prefix ([wineasio](https://github.com/wineasio/wineasio)). Alternatively, "FL Studio ASIO" over `winepulse` (simpler, higher latency). | Low latency recording and playback | 1–3 h |
| 5 | WebView2: install a known-working runtime or accept no FL Cloud; register with an offline unlock file if in-app login fails. | FL Cloud, sign-in and web panels; known to be flaky under Wine | 1–4 h, may not fully succeed |
| 6 | Launcher: drop the Wayland refusal (XWayland works for most setups). Add `WINEDEBUG=-all`, a PipeWire latency hint, a `.desktop` file and `.flp` MIME association. | Usability | ~1 h |
| 7 | Test: demo projects, render WAV/MP3, MIDI controller, plugin scan, latency, HiDPI scaling. | Confidence | 2–4 h |

**Total: about 0.5–2 days** of focused work for a reliable personal setup.

**A+ (a reproducible package for others):** 2–4 weeks for one engineer. That covers a scripted prefix build that downloads the **official** installer (FL binaries must not be redistributed), a pinned runner and FL version, audio setup, a launcher, a headless smoke test in CI, and troubleshooting docs. Plan on **ongoing maintenance**: Image-Line does not test on Wine, and one signing change in 26.1.4 broke every Wine user.

Plugins: Windows VST/VST3 plugins load inside FL under Wine as usual. **yabridge** only matters for native Linux hosts such as Bitwig or REAPER. Its last release was 5.1.1 (Nov 2024), and its Wine ≥ 9.22 editor-embedding issue ([#409](https://github.com/robbert-vdh/yabridge/issues/409)) is still open.

---

## 6. Route B: a true native port (only Image-Line can do it)

**Why only Image-Line:** a native port needs the source code, which is proprietary. The archive contains compiled binaries only.

**What it would involve** (in their codebase):
- A Linux backend for their UI and platform layer (X11 and/or Wayland, input, clipboard, drag-and-drop, file dialogs via xdg-desktop-portal, fonts, HiDPI), plus replacing the remaining VCL-only parts.
- Audio and MIDI backends: ALSA, JACK and PipeWire instead of ASIO, WASAPI, DirectSound and WinMM.
- Plugin hosting for Linux formats (VST3 on Linux, CLAP, optionally LV2), and Linux builds of all 161 native plugins.
- Replacing WebView2 (WebKitGTK or CEF), Media Foundation and Direct3D (FFmpeg/GStreamer, OpenGL/Vulkan), COM and registry use.
- Licensing/activation, packaging (Flatpak/AppImage/deb/rpm), and QA across distros.

**What helps:**
- Delphi 13.2 ships an **LLVM 20 based Linux64 compiler** ([Embarcadero](https://blogs.embarcadero.com/rad-studio-13-2-florence-is-here/)).
- FMX GUI apps can target Linux through FmxLinux, though **VCL is Windows-only** ([docwiki](https://docwiki.embarcadero.com/RADStudio/Florence/en/Delphi_Considerations_for_Multi-Device_Applications)).
- The macOS/ARM64 work already removed most Windows and x86 assumptions.
- The third-party C/C++ libraries in use (IPP, élastique, FFmpeg, Python, NDI, OpenSSL) all have Linux builds.

**Precedent:** the macOS port started around 2013, and Embarcadero's case study predicted "something within six months". A 2014 Mac beta never left testing, and the native Mac version shipped in **May 2018** with FL 20, **about 4–5 years** later. Part of that delay was waiting on Delphi's macOS toolchain, which is no longer a blocker.

**Estimate** (speculative; no access to source):
- **~12–24 months to a public beta** for a dedicated team of ~4–6 engineers plus QA, assuming the macOS platform layer is reusable;
- **~2–3 years to feature parity** (all plugins, cloud features);
- then the permanent cost of supporting a third platform.

The gate is commercial, not technical. Image-Line has no public plans, and on its forum the stated bar is roughly 10% Linux market share ([Image-Line forum megathread](https://forum.image-line.com/viewtopic.php?t=259129&start=650)). Their support knowledge base points Linux users to Wine ([Image-Line KB](https://support.image-line.com/action/knowledgebase?ans=140)).

---

## 7. Route C: porting the binaries (reverse engineering): not viable

- The FL Studio EULA prohibits reverse engineering, and tampering with licensing raises anti-circumvention issues (e.g. DMCA §1201).
- Technically, Delphi decompilers recover class and form structure, not maintainable source. Rebuilding 2.5M+ lines that way would be a multi-person-decade effort.
- **Wine already *is* the binary-compatibility route,** and it is legal for licensed users.

---

## 8. Route D: a clean-room FL-like DAW for Linux

**MVP (6–12 months for 2–3 experienced audio developers):** a pattern-based sequencer (channel rack, step sequencer, piano roll, playlist), a mixer with basic effects, CLAP/VST3/LV2 hosting, JACK/PipeWire I/O, project save/load and audio export. This assumes a framework such as JUCE or Tracktion Engine.

**Feature parity with FL Studio** (20+ years of development and dozens of instruments and effects) would take **many person-years**.

**Shortcuts:**
- **LMMS** is GPL and already has an FL-like workflow. Its last stable release is 1.2.2 from 2020, and 1.3 is in active development ([LMMS](https://github.com/LMMS/lmms)).
- **PyFLP** ([GitHub](https://github.com/demberto/PyFLP)) can parse parts of `.flp` files to support project import, but only partial compatibility is realistic.

## 9. Alternatives if "Linux-native" is the real goal

Native Linux DAWs:
- **Bitwig Studio** (commercial; closest in modern workflow);
- **REAPER** (native Linux builds, inexpensive);
- **Ardour** and **Zrythm** (open source);
- **LMMS** (FL-like);
- **Renoise** and **Tracktion Waveform**.

A Windows VM (QEMU/KVM with USB audio passthrough) is the most compatible way to run FL Studio on a Linux host, at the cost of latency and setup complexity.

## 10. Risks and unknowns

- **Not runtime-tested.** This review is based on static analysis of the archive, with no GPU, audio device or display available. The startup blocker is inferred from the FL version, the Wine version and the open Wine MR, not observed.
- **Each FL release can break Wine compatibility** (26.1.4 did). Pin known-good FL/Wine combinations.
- **WebView2 and FL Cloud** remain the least reliable parts under Wine; a memory leak in FL Cloud Plugins has also been reported.
- **Third-party plugin DRM** (iLok, etc.) is hit-and-miss under Wine.
- The native-port estimate in §6 is an outside view. Image-Line's actual codebase could make it shorter or longer.

---

## Appendix: archive transfer and verification

- **Release (private repo):** [`flstudio-archive-2026-10-14`](https://github.com/DOGECOIN87/DAW/releases/tag/flstudio-archive-2026-10-14)
  - `FLSTUDIO.zip.part-00`: 1,394,723,771 bytes, SHA-256 `9e6fa0dff0616d78f79c3354e98455768600d6ce339e019d9ce67e52fd8cb671`
  - `FLSTUDIO.zip.part-01`: 1,394,723,771 bytes, SHA-256 `3cc8cfe1a3c2202048d272ee27f46766973cce5e6069562aef6e3b2b91b111c9`
  - `SHA256SUMS.txt`
- **Original:** `FLSTUDIO.zip`, 2,789,447,542 bytes, SHA-256 `843750711a8036919668dc833d3bac21cd5ea159c9c13e160843e6ccdab0f40e`
- **End-to-end check:** the parts were downloaded back from the release and re-joined, and the result matches the Google Drive SHA-256. Verdict **PASS** ([`RELEASE_VERIFICATION.md`](../analysis/flstudio/RELEASE_VERIFICATION.md)).
- **Restore:** `cat FLSTUDIO.zip.part-00 FLSTUDIO.zip.part-01 > FLSTUDIO.zip`. On Windows: `copy /b FLSTUDIO.zip.part-00 + FLSTUDIO.zip.part-01 FLSTUDIO.zip`. Then verify with `sha256sum -c SHA256SUMS.txt`.
- **Google Drive sharing:** a link-only "Viewer" share existed for about 1 minute (2026-10-15 ≈04:09:55–04:10:45 UTC) while the GitHub runner downloaded the file. It was revoked immediately, and the file is back to owner-only access.
- **Keep this repository private.** FL Studio is commercial software © Image-Line. The archive is a personal backup and must not be redistributed.
