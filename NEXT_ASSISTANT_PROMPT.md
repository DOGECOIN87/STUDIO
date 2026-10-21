# Prompt for the next assistant: finish the Audius Studio UI

Paste everything below the line into a new session, or tell the next assistant:
"Read `NEXT_ASSISTANT_PROMPT.md` on branch `claude/sleepy-volta-w4m74z` of DOGECOIN87/DAW and follow it."

---

You are working on **Audius Studio** (https://audius-studio.online), a browser DAW in the private GitHub repo `DOGECOIN87/DAW`. It is my own **unofficial, community-built app for the Audius community** (I'm a member). It is not an official Audius product: never call it "official" or imply Audius made, owns or endorses it.

Your job: **finish the UI so the whole app fits properly in one single view on every screen, fix every remaining mistake including edge cases, and move the layout closer to my FL Studio references.** Start from `main`.

Read these first:
- `HANDOVER.md`, section 2: standing constraints that still apply.
- `docs/design-reference/README.md`: my FL Studio reference screenshots, the target layout diagram, and how each FL window maps to Audius Studio. The images are in that folder; it is reference only and never deployed.
- `analysis/audius-ui-baseline-audit.md`: measurements taken before the last redesign.

## 1. Where things stand (`main` @ `8b6c894`, live on Cloudflare)

The last session's redesign (`0e368de`, `8b6c894`) fixed the biggest problem. I re-measured the build with Playwright at 1920×1080, 1366×768, 1024×1366 (touch), 360×640 and 640×360 (Note 3, touch, scale 3):

| Viewport | Doc width = viewport | Sideways-scrolling strips | Controls off-screen | Controls < 44px | Text < 15px | Clipped text | Mixer / Trellis at start | Console errors |
|---|---|---|---|---|---|---|---|---|
| 1920×1080 | yes | none | 0 | 63 of 63 | 107 | 7 | closed / closed | none |
| 1366×768 | yes | none | 0 | 63 of 63 | 107 | 7 | closed / closed | none |
| 1024×1366 touch | yes | none | 0 | 48 of 63 | 107 | 4 | closed / closed | none |
| 360×640 touch | yes | none | 0 | 22 of 43 | 42 | 0 | closed / closed | none |
| 640×360 touch | yes | none | 0 | 24 of 45 | 39 | 0 | closed / closed | none |

So the top bar no longer slides sideways, and the Mixer and Trellis start closed. Still wrong, from the numbers and my screenshots:

1. **Text smaller than the required 15–16px** on every size (107 elements on desktop and tablet, about 40 on Note 3): hint bar, the "Audius Studio Workflow" help panel, Vol/Pan labels, ruler numbers, section markers, the status line.
2. **Touch targets under 44×44px** on tablet (48 controls) and Note 3 (about 23): M/S/× track buttons, clip ⋯/× buttons, section-marker ×, sliders. Desktop can stay compact, but touch devices can't.
3. **Truncated names** on desktop and tablet: library stems ("Breakbeat …", "Reese Sub …", "Warm Electr…"), track headers ("2 · Sub Reese B…", "3 · Electric Cho…"), the section marker "Cho…", and chopped clip titles ("Dru…") jammed against their ⋯ and × buttons. Give names room, or show the full name on hover/long-press (and use vertical names in mixer strips, as in the references).
4. **Dead space on desktop:** an empty band about 160px tall sits above the Playlist (to the right of the library categories, below the tool bar) where the Step Rack and Piano Roll used to be. The Playlist should take that space when those windows are closed.
5. **Pan sliders cut off** at the right edge of every track header, at all sizes.
6. **Note 3 portrait wastes height:** the logo row, the transport (wrapping onto 2 rows, with "Meter" alone on its own row), the Tools/More row and the window tabs use about 265 of 640px (~41%), leaving about 2.5 tracks visible. Track headers take ~45% of the width. "Timeline Scroll" wraps onto 2 lines. Aim for one compact transport row and one window-tab row.
7. **Not yet checked** (my audit was stopped to save credits), so you must test it: every button, menu, tool and shortcut; export WAV (master/stem); save/load (localStorage `audius_studio_projects_v1` and `.dawproj.json`); what `fetch("/api/projects")` (in `app.js`) does on static Cloudflare hosting; the logo variant in every theme; no FL Studio/"Fruity" names anywhere; and all edge cases in section 4.

## 2. The #1 requirement: everything fits in one view

- **No horizontal scrolling of any kind,** at any size: no page scroll, and no sideways-scrolling strips inside the top bar or tool bar. Controls fit, wrap tidily, or collapse into a "⋯" menu. Nothing clipped, overlapping, or off-screen.
- **Target sizes:**
  - desktop 1920×1080, 1440×900, 1366×768;
  - tablet 1024×1366 and 1366×1024;
  - Samsung Galaxy Note 3 at 360×640 CSS px, scale 3, touch, plus 640×360.

## 3. Layout target (FL Studio as inspiration only)

Follow `docs/design-reference/README.md`:

- **Tool Bar:** one compact band across the top, two thin rows.
  - Row 1: menus, PAT/SONG, transport, tempo, song position.
  - Row 2: project name and the **hint bar** (shows the live value of whatever you touch, e.g. `-18.0dB 40Hz 61% · Band 1`), snap, tools, pattern, and window toggle buttons.
- **Library** down the left; **Step/Channel Rack** and **Mixer** (with a docked FX-slot panel) across the top; a large **Playlist** below; the **Piano Roll** docked or floating over the Playlist.
- **Shortcuts:** F5 Playlist, F6 Channel Rack, F7 Piano Roll, F9 Mixer, Alt+F8 Library.
- **Default first load:** Library + Playlist only.
- **Phones:** one main window at a time with a window switcher; the transport is always visible.
- **Mixer:** narrow strips with **vertical names**, colour-coded numbers, a selected-strip outline, a layout preset (Compact/Wide), and a docked FX-slot panel (on/off + mix per slot).
- **Effect windows** (Parametric EQ, Master Limiter, $AUDIO Multiband Clipper, Clip Inspector):
  - a title bar with presets ◂ ▸, a menu and close;
  - labelled sections, each with a bypass toggle;
  - knobs with the label below and a value arc;
  - a curve/meter visualisation where it helps;
  - full-screen sheets on phones.
- **Context menus** (right-click, or long-press on touch): grouped sections with headers, right-aligned shortcuts, submenus, checkmarks, greyed-out disabled items.
- **Use FL Studio for layout and behaviour only.** Never use its names ("FL Studio", "Fruity…", "Image-Line"), logos, icons, skins, knob graphics or plugin names anywhere in `app/public`. The look stays Audius: brand colours, Avenir Next, and the official assets in `app/public/assets/audius/`, per https://brand.audius.co/ (white single-colour lockup on dark backgrounds, full colour only on light ones). Only build new features where Audius Studio already has a matching one; don't add new instruments unless I ask.

## 4. Edge cases you must test

- **Screen extremes:**
  - every width from 320 to 1920 in 40px steps (at heights 800 and 500);
  - browser zoom 80/125/150/200%;
  - short screens (1366×600, 1280×649, 1024×600);
  - split-screen (960×1080, 683×768);
  - ultrawide and 4K (2560×1440, 3440×1440, 3840×2160);
  - rotating or resizing while windows are open;
  - all windows open at once.
- **Content and themes:**
  - 60+ character, emoji and CJK names;
  - 32+ tracks and 50+ clips;
  - an empty project after Clear;
  - every theme (Audius Dark, Neue Dark, Audius Day, Matrix, Trending #1, Platinum, Acc, BG) × each wallpaper;
  - reduced motion and forced colours.
- **Inputs:**
  - uploads: a fake .wav, an empty file, a header-only file, mono and stereo, 16/24/32-float, 8–96 kHz, 1 s to 10 min, about 50 MB, 10 files at once, unsupported types;
  - export of an empty project, an all-muted project and a long project;
  - storage blocked, full or corrupted, and a malformed `.dawproj.json`;
  - two tabs open at once;
  - BPM 0, negative, 999, empty or text;
  - typing tool-shortcut letters inside the BPM box (it must type, not switch tools);
  - rapid play/stop taps;
  - slicing or chopping tiny clips and at clip edges;
  - deleting all tracks and then adding one;
  - Clear while playing;
  - multi-touch on pads and faders;
  - the tab hidden and shown again (AudioContext resume).
- **Browsers:** Chromium via Playwright is enough for automation, but say clearly that Safari and Firefox weren't tested if you can't run them.

## 5. Standing constraints (from `HANDOVER.md`)

- Keep the repo **private**; it has a release holding my personal archive.
- Default view **Stems + Playlist**, with the Mixer (`#right-panel`) and Trellis (`#trellis-dock`) closed. **✕ close** on every panel; **1-click delete** buttons (`×`, `🗑`, `🧹`).
- Keep the 3-column desktop layout, **1:1 track header ↔ lane alignment** (every size and scroll position), the 5 windows plus the Trellis 8×8 dock, and the keyboard mappings.
- **15–16px readable text** and **44×44px touch targets** on Note 3 and tablets; multi-touch must keep working.
- Keep every feature working: Web Audio engine, demo stems, uploads (WAV/MP3/FLAC/OGG/M4A), clip slice/slip/trim/paint, step sequencer, piano roll, 10-band EQ + FX mixer, WAV master/stem export, project save/load.
- Keep the name **Audius Studio** and the domain `audius-studio.online`.

## 6. How to work and ship

1. **Audit first.** Serve `app/public` statically (production is static Cloudflare Pages with no `/api`) and drive it with Playwright. Measure:
   - page width vs viewport, and any element with `overflow-x` scrolling;
   - controls off-screen, clipped text, font sizes under 15px, touch targets under 44px on touch sizes;
   - header ↔ lane alignment.

   Look at screenshots, and exercise every control while watching the console. Write the findings down before you change code.
2. **Fix and redesign.** Show me before/after screenshots at desktop, tablet and Note 3 sizes.
3. **Branch and deploy:** work on your own branch off `main` and open a PR. Merging to `main` deploys `app/public` automatically through `.github/workflows/deploy-cloudflare-pages.yml` (the `CLOUDFLARE_API_TOKEN` repo secret is already set) and checks every file on the live hosts. Check that run after merge, or re-check with `tools/cloudflare/verify_pages.sh app/public https://audius-studio.pages.dev https://audius-studio.online https://www.audius-studio.online`.
4. **Never ask me to paste API tokens or keys into chat.** Don't change DNS (the domain is on Cloudflare and works). GitHub Pages is unpublished with its custom domain removed; don't re-enable it.

## 7. Done means

- No horizontal scrolling and nothing clipped or overlapping, at every target size and edge case, in every theme.
- 15–16px text, and 44px touch targets on touch devices.
- Every control works, with no console errors.
- The layout matches the reference target, and all standing constraints hold.
- The PR is merged, the deploy run is green, and the live site passes `verify_pages.sh`.

## 8. Status after the 2026-10-20 passes

The seven items in §1 and the §4 checklist are addressed; see `HANDOVER.md` §3 for that pass and its verification record.

The toolbar rebuild is in `HANDOVER.md` §4: the tools are a permanent strip, the six studio windows are a permanent 44px icon row (`#window-strip`), one ✂ menu holds only the destructive clip actions, Options is a sectioned sheet (bottom sheet on phones) that never moves between rows, and every panel is anchored, scrimmed and closed by Escape / tap-outside with focus returning to its trigger. The duplicate `#mobile-window-switcher`, the non-functional `Tools`/`More` popovers and the stale `.topbar-menu-popover` CSS are gone.

Two gaps remain for the same reason: this sandbox has no browser, so there are **no Playwright measurements or before/after screenshots**, and **Safari and Firefox are untested**. The jsdom harness (`/home/user/daw-smoke`, `node smoke.mjs`, 31 checks) covers behaviour and static CSS invariants, not real layout. Re-run the §6 audit with Playwright at 320–1920px (including 640×360 and 1366×600) before calling the fit work visually confirmed.

---

## 2026-10-21 — MIDI roadmap (A shipped, B and C pending)

The owner's MIDI brief is now the live plan; `HANDOVER.md` §6 is the record for **Feature A (Web MIDI keyboard input)**. It shipped with: `midi-input.js` (byte parser + device manager), `AudioEngine.startLiveVoice/panicLiveVoices`, the `#pr-midi-bar` in the Piano Roll, held-key highlighting, and a record mode that captures performance into the active pattern. It was verified in Chromium 153 over CDP with mocked MIDI events (`t1-midi.mjs` 27/27, `t1b-midi-edges.mjs` 9/9, `t2-layout.mjs` 8/8 viewports, `t3-regress.mjs` 12/12, `tools/smoke.mjs` 67/67). **No physical MIDI hardware was available, so live-hardware testing is the owner's; Safari and Firefox were not tested (and have no Web MIDI API).**

Next, in order, each shipping independently:

1. **Feature B — MIDI file import/export** (`midi-codec.js`, SMF format 0/1 import, format-1 export, round-trip-identical acceptance test), plus gated live MIDI control (CC7/CC10 to the selected insert, program change to pattern select, MIDI clock in/out) only if import/export are green.
2. **Feature C — WASM effect plugin host** in the mixer FX slot panel (add/remove/reorder/bypass per insert and master, two reference effects, per-slot error isolation, project persistence). Raw `.vst`/`.vst3` binaries cannot load in a browser — say so in the UI copy and the README.
