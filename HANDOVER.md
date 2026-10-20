# Audius Studio (`audius-studio.online`) — Agent Handover Document

## 1. Project Overview & Completed Work
- **Repository:** `DOGECOIN87/DAW` (Private repository — **must remain private** because release `flstudio-archive-2026-10-14` stores the user's personal `FLSTUDIO.zip` archive in two split release assets: `FLSTUDIO.zip.part-00` and `FLSTUDIO.zip.part-01`, verified SHA-256 `843750711a8036919668dc833d3bac21cd5ea159c9c13e160843e6ccdab0f40e`).
- **Application Name & Domain:** **Audius Studio** (`audius-studio.online`) — located in `/home/user/DAW/app/`.
  - All references to "FL Studio", "Fruity", "PulseForge", and "Audius Ranked DAW" have been removed from the application UI.
- **Core Architecture (`app/`):**
  - `app/server.mjs`: Zero-dependency Node.js HTTP & REST API server (`0.0.0.0:3000` plus live preview ports `3005`, `3008`–`3012`) with `Cache-Control: no-store` headers.
  - `app/public/index.html`: 5-window DAW interface (**Tool Bar**, **Library / Stems Browser**, **Step / Channel Rack**, **Piano Roll**, **Playlist Arrangement**, **Studio Mixer**) + collapsible **Trellis 8×8 Pad Dock**.
  - `app/public/audius-fonts.css` & `app/public/fonts/avenir-*.woff2`: Official Audius Harmony `Avenir Next LT Pro` WOFF2 font family (weights 100–900).
  - `app/public/assets/audius/`:
    - 16 official Audius brand lockups & `$AUDIO` tier badges extracted from `@audius/harmony@0.5.3` (`LogoHorizontal-Color.png`, `LogoHorizontal-Color-Alt.png`, `LogoGlyph-Color.png`, `LogoCircle-Audio.png`, `AudiusLogoWhiteBg.png`, `TokenAUDIO.png`, `TokenPlatinum.png`, `TokenGold.png`, `TokenSilver.png`, `TokenBronze.png`, and monochrome SVGs), strictly complying with `https://brand.audius.co/logo` (full-color lockup on light backgrounds only; single-color white lockup on dark backgrounds; wordmark always paired with glyph; clear-space rules enforced).
    - `app/public/assets/audius/wallpapers/`: 4 official Audius Wallpaper packs (`Aurora-Glow`, `The-Grid`, `Wireframe-Peaks`, `Pastel-Icons`) in responsive Desktop (`1920×1080`), Tablet (`1024×1366`), and Mobile/Note 3 (`720×1558`) resolutions, wired to `#wallpaper-select` and `#theme-select`.
  - `app/public/styles.css`: Complete stylesheet (`15px`–`16px` readable Manus AI typography, Samsung Galaxy Note 3 & tablet multi-touch optimization, 1:1 track header-to-lane alignment, glassmorphic wallpaper support).
  - `app/public/app.js`: Web Audio API engine, built-in demo session "Untitled" (138 BPM; note data in generated `app/public/demo-song.js`, re-synthesized by `generateStemsFromSong` in `wav-codec.js`; pipeline in `tools/flp-import/`), stem upload (`WAV`/`MP3`/`FLAC`/`OGG`/`M4A`), non-destructive Playlist clip slicing/slip/trim/paint, Step Sequencer, Piano Roll, 10-band Parametric EQ + Stereo FX Mixer, `WAV` Master/Stem export, and Browser `localStorage` (`audius_studio_projects_v1`) + `.dawproj.json` project persistence.
- **Cloudflare Pages Deployment Configuration:**
  - `wrangler.toml`: Configured for Cloudflare Pages (`name = "audius-studio"`, `pages_build_output_dir = "app/public"`).
  - `app/public/_headers`: Sets CORS and content-type security headers for static assets.
  - `.github/workflows/deploy-cloudflare-pages.yml`: Deploys `app/public` to the `audius-studio` Pages project as production (`--branch=main`) with Wrangler on every push to `main` that changes the site (or manually), then checks `audius-studio.pages.dev`, `audius-studio.online` and `www.audius-studio.online` with `tools/cloudflare/verify_pages.sh` (JS/CSS must match `app/public` byte for byte). It refuses to run from any ref but `main` and fails unless the Pages project's production branch is `main` and Wrangler reports a production deployment. Needs the repository secret `CLOUDFLARE_API_TOKEN` (API token with Account → Cloudflare Pages → Edit; never a `cfk_` Global API Key).
  - `audius-studio-cloudflare-pages.zip`: Ready-to-upload Direct Upload ZIP (`3.09 MB`) of `app/public/` (also uploaded to the user's Google Drive: File ID `1kXwjSbTeY1wNopcg2VW2EPEPFLbat0Bf`).
  - Cloudflare Agent Setup (`https://developers.cloudflare.com/agent-setup/prompt.md`): `.agents/skills/`, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, and `AGENTS.md`.

## 2. Standing User Constraints (Must Be Preserved)
1. **Keep `DOGECOIN87/DAW` private** at all times.
2. **Default View:** Keep **Stems + Playlist** as the default open view (`#right-panel` Mixer and `#trellis-dock` closed on startup), with explicit `✕` close buttons on panels and 1-click delete buttons (`×` / `🗑` / `🧹`).
3. **Layout & Controls:** Keep the 3-column layout, 1:1 track header-to-lane alignment, 5-window interface, keyboard mappings, and `15px`–`16px` readable typography optimized for Samsung Galaxy Note 3 and tablet screens.
4. **Branding:** Strictly follow `https://brand.audius.co/` guidelines and keep the name **Audius Studio** (`audius-studio.online`).

## 3. UI edge-case pass — 2026-10-20

Closes out the seven known-wrong items in `NEXT_ASSISTANT_PROMPT.md` §1 and works through the §4 edge-case list.

- **Typography.** Every DOM label now respects the 15px floor (hint bar, workflow panel, Vol/Pan labels, ruler, section markers, status line, `kbd` chips). Canvas text — ruler numbers, section markers, piano-roll labels, the `CUT` badge and the gate-shaper empty state — is drawn at 15px with fit guards, so a long name is shortened only where it would otherwise collide.
- **Touch targets.** Under `(pointer: coarse), (hover: none)` every control is at least 44×44px: M/S/× track buttons, clip ⋯/× buttons, section-marker ×, channel LEDs, and the sliders' hit areas. Loop-handle and marker-× zones span the full ruler height, so a thumb cannot miss them.
- **Long press.** On touch, a long press on a clip opens the clip menu and a long press on a track header starts rename; there is no hover-only path left.
- **Names.** Library cards clamp to two lines, track titles use the flexible title slot, and mixer strips show vertical names; the full name stays available in the tooltip/long-press.
- **Layout.** `.fl-upper-dock.all-collapsed` reclaims the dead band above the Playlist, pan sliders fit the header grid, the Note 3 portrait header is one compact transport row plus one window-tab row, the piano-roll dock clamps to `min(340px, 44vh)`, and short screens shrink the chrome instead of scrolling.
- **Vertical scrolling.** A custom playlist rail (`#vscroll-rail`, `role="scrollbar"`, pointer drag plus arrow/Page/Home/End keys) replaces native vertical range inputs, which render inconsistently on Chrome 95-class devices. It is the only way to reach tracks 33+ in tall projects.
- **Clip menu.** Grouped sections (Edit Segment / Arrange / Flags) with accurate shortcut chips (`Ctrl+D`, `R`, `Del`) and a new Chop 1-Bar action; hints are only shown where the key does exactly the same thing.
- **Robustness.** A malformed `.dawproj.json` no longer throws, `saveProject()` reports honestly when `localStorage` refuses the write, the pattern-preview interval no longer stacks, `snapshot()` deep-copies assets so undo restores channel mute state, BPM input clamps `0` / negative / `999` / text into 20–260, shortcuts stay quiet while a dialog is open, a `storage` event refreshes the project list in a second tab, and the AudioContext resumes on `visibilitychange`.

**Verification in this sandbox.** `node --check` on every module; DOM cross-check (262 ids, 172 `getElementById` references, 0 missing, no duplicates, balanced `<div>`s); CSS brace/paren balance; and a jsdom harness at `/home/user/daw-smoke/smoke.mjs` (run with `cd /home/user/daw-smoke && node smoke.mjs`) that clicks all 268 buttons, cycles 11 selects, moves 28 ranges, types 60+ character / emoji / CJK names, exercises every shortcut, exports master WAV and five stems, saves and reopens projects, imports files, abuses the BPM field, corrupts `localStorage`, and drives the scroll rail — with no runtime errors.

**Not verified here.** Playwright could not be installed (its download CDN is unreachable from this sandbox), so there are no real-browser measurements or before/after screenshots, and **Safari and Firefox were not tested**. The live check is the deploy workflow's `tools/cloudflare/verify_pages.sh`, which compares every deployed asset byte for byte.

## 4. Toolbar row repair and merge recovery — 2026-10-20

The GitHub web-editor conflict request named `arena/3078a2e2-daw`, which is not a fetched ref. The actual open PR #8 feature branch is `arena/3078a2ec-daw` (`cee6f37`); its audio changes were inspected and retained without replacing the newer toolbar/UI wholesale. Restored the PR #8 `wav-codec.js` synth/drum work, de-clicked metronome and preview changes in `audio-engine.js` / `app.js`, and preserved the current PR #10 `#popover-scrim`, explanatory comment, and newer `app.js?v=36`. Repository-wide marker scan of app HTML/JS/CSS is clean.

The toolbar is now assigned deliberate rows instead of depending on accidental flex wrapping:

- **Phone ≤430px:** controls stay ≥44px. At 390–430px the tool strip is 8×44px with zero inter-tool gap and 8px of internal gutter (360px total); below 390px it becomes a four-column, two-line grid (188px per line + gutter). Snap is capped at 96px; snap/history/✂ share a row (292px budget); the 284px six-window strip is a separate, full-width, evenly distributed navigation row. This is three visual lines below 390px because the tools occupy two lines, plus the action and window rows; at 390–430px it is three toolbar rows. The separate window row is intentional: its 284px strip cannot share the action line at phone widths.
- **Narrow tablet 431–760px:** tool strip row, snap/history/✂ action row, right-aligned window row. The action row is budgeted at 304px; 44px targets and the 112px snap cap remain fixed.
- **Tablet 761–1360px:** one combined icon/action row (694px budget including gaps), then the window strip as its own right-aligned navigation row.
- **Desktop ≥1361px:** explicit labelled-tool widths make the one-row threshold measurable (1320px control budget including toolbar gaps, before 16px outer padding). Shortcut chips are deferred to ≥1801px and only fine-pointer hover devices.
- **Resize state:** crossing into compact mode now reapplies `focusWorkspaceWindow()` after closing popovers, so the single visible window and lit strip stay synchronized.

The snap select no longer stretches to 100%. The window buttons retain the existing `#btn-toggle-*` ids/handlers, and `#popover-scrim`, its comments, and the `v=2` gate module import are retained. Cache versions after changed content: fonts `v=18` (unchanged), styles `v=39`, app `v=36`, gate-shaper UI `v=2` (unchanged).

**Verification in this sandbox.** `node --check` passed for every app module and `app/server.mjs`; 271 unique DOM ids, 174 literal `getElementById` references all resolve, no orphan SVG symbols, balanced HTML tags, and no conflict markers in `app/public`. `css-tree` parses `styles.css` with 0 errors. `node tools/smoke.mjs` passes **66/66 checks**, including the required row-budget table for 320, 360, 390, 430, 640, 760, 768, 1024, 1366 and 1920px plus 640×360, 1366×600 and the 360×640 / 360×740 flat-pane widths. The budget is arithmetic from the CSS target, gap and snap declarations; it verifies designed row widths, not browser-rendered positions.

**Not verified.** Playwright was added as a dev dependency and `npx playwright install --with-deps` plus `npx playwright install chromium` were attempted. The browser CDN (`cdn.playwright.dev`) reset the TLS connection, and the sandbox package repositories could not supply Chromium system libraries; therefore there are **no Chromium measurements, screenshots, or real-browser interaction results**. The prior `/home/user/daw-smoke/smoke.mjs` harness was not present in this checkout, so it could not be extended or run; the new repository-local `tools/smoke.mjs` is a static/arithmetical gate, not a replacement claim for that jsdom interaction harness. **Safari and Firefox were not tested.** Live Cloudflare verification cannot run from this sandbox; the deployment workflow's own *Verify live URLs and assets* step remains the gate.
