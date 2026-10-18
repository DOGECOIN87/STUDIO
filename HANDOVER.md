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
  - `app/public/app.js`: Web Audio API engine, 4 built-in synthesized demo stems, stem upload (`WAV`/`MP3`/`FLAC`/`OGG`/`M4A`), non-destructive Playlist clip slicing/slip/trim/paint, Step Sequencer, Piano Roll, 10-band Parametric EQ + Stereo FX Mixer, `WAV` Master/Stem export, and Browser `localStorage` (`audius_studio_projects_v1`) + `.dawproj.json` project persistence.
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
