# Prompt for the next assistant: fix and redesign the Audius Studio UI

Paste everything below the line into a new session, or tell the next assistant:
"Read `NEXT_ASSISTANT_PROMPT.md` on branch `claude/sleepy-volta-w4m74z` of DOGECOIN87/DAW and follow it."

---

You are working on **Audius Studio** (https://audius-studio.online), a browser DAW in the private GitHub repo `DOGECOIN87/DAW`. It is my own **unofficial, community-built app for the Audius community** (I'm a member). It is not an official Audius product: never call it "official" or imply Audius made, owns or endorses it.

Your job: **fix every UI mistake and redesign the layout so the whole app fits properly in one single view**, using FL Studio's interface as the layout inspiration. Read `HANDOVER.md` first; its section 2 lists standing constraints that still apply.

## 1. The #1 requirement: everything fits in one view

- **No horizontal scrolling, ever.** Right now the top bar slides to the left (the page scrolls sideways) because the header, theme buttons and transport are wider than the screen. At every target size, `document.documentElement.scrollWidth` must equal `window.innerWidth`, and no control may sit past the right edge.
- **Target sizes:** desktop 1920×1080 (also 1366×768 and 1440×900); tablet 1024×1366 portrait and 1366×1024 landscape; Samsung Galaxy Note 3 = 360×640 CSS px at device scale 3 (touch), plus 640×360 landscape.
- **How:** follow FL Studio's approach. The top toolbar is one strip of panels (menu, transport, Pat/Song, song position, snap, window buttons, hint bar). Panels are reordered, collapsed into an overflow "⋯" menu, or hidden as the screen narrows; they never overflow. Theme and wallpaper choices belong in a dropdown or the OPTIONS menu, not as a row of 8 buttons in the header.
- Windows (Library, Step/Channel Rack, Piano Roll, Playlist, Mixer, Trellis dock) must share the screen without overlapping or clipping each other. On phones, show one main window at a time with a tab/switcher, and keep the transport always visible.

## 2. FL Studio as layout inspiration only

- Search Google Images for **"FL Studio 2025 UI"**, **"FL Studio interface"** and **"FL Studio toolbar"**. Also read Image-Line's manual pages:
  - https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/basics_interface.htm
  - https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/toolbar_panels.htm
  - https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/main_windows.htm
  - https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/menu_view.htm
- If you run in a Claude cloud environment and `image-line.com` is blocked, say so; I'll add it under the environment's Allowed domains. If I attach screenshots, treat them as the main reference.
- Borrow the **layout and workflow ideas** only: one fixed top toolbar, everything else in windows; Pat/Song switch; hint bar; window shortcuts **F5 Playlist, F6 Channel Rack, F7 Piano Roll, F9 Mixer, Alt+F8 Browser**.
- **Never** use FL Studio's name, logos, icons, skins or artwork anywhere in the app (UI text, comments, file names, meta tags). `HANDOVER.md` says all such references were removed; keep it that way.

## 3. Problems already seen (main @ `d8a36aa`, desktop 1920×1080, default theme)

I took a screenshot of the current build. These are visible; confirm each with measurements, then find the rest:

1. **Header overflows the right edge:** session name truncated ("Audius Studio Session #01.au…"); the theme buttons (Audius Dark, Neue Dark, Audius Day, Matrix, Trending #1, Platinum, Acc, BG), PAT/SONG and play/stop are pushed past the edge.
2. **Tool bar overflows:** the CUT & DELETE group runs off screen ("Reverse" is cut off).
3. **Playlist title collides with icons:** between the Step Rack and the Playlist, the text "AUDIUS STUDIO" and "PLAYLIST – ARRANGEMENT" overlaps the small tool icons and is clipped.
4. **Clip headers overlap their buttons:** chopped clips show names like "Drums Sl…" drawn under the ⋯ and × buttons; tiny clips are unreadable.
5. **Section markers collide:** "Chopped×" text runs into its × button.
6. **Truncated labels everywhere:** library stems ("Breakbeat …", "Reese Sub …"), track headers ("2 · Sub Reese B…"), step-rack channel names, mixer strip names ("Drums B", "Sub Ree", "Pluck Le", "Vocal / A").
7. **Mixer FX chain is clipped** at the bottom ("Slot 3 $AUDIO Multiband Clipper" is cut off).
8. **Startup view looks wrong:** Step Rack, Piano Roll, Mixer and FX chain are all open on first load. `HANDOVER.md` requires Stems (Library) + Playlist by default, with the Mixer (`#right-panel`) and Trellis dock (`#trellis-dock`) closed. Check with empty localStorage.
9. **Logo colour to check:** the top-left AUDIUS wordmark looks like a purple gradient on a dark background. Audius brand rules call for the single-colour white lockup on dark backgrounds and full colour only on light ones.
10. **Small text:** labels like "Swing", "VEL", meter dB values and hint text look smaller than the required 15–16px.
11. **To check on production:** `app.js` (around lines 3628 and 3660) calls `fetch("/api/projects")`. Cloudflare Pages has no API, so this either 404s or gets `index.html` back. Make sure it fails silently and never shows an error.

No console errors appeared on first load at 1920×1080.

## 4. Standing constraints (from `HANDOVER.md`, keep all of them)

- Keep the repo **private**; it has a release holding my personal archive.
- Default view: **Stems + Playlist**, with the Mixer and Trellis dock closed on startup. Every panel has an explicit **✕ close** button. **1-click delete** buttons (`×`, `🗑`, `🧹`) stay.
- Keep the 3-column layout, the **1:1 alignment between each track header and its playlist lane** (at every size and scroll position), the 5-window interface plus the Trellis 8×8 pad dock, and the keyboard mappings.
- **15–16px readable typography**, plus touch targets of at least 44×44 px on the Note 3 and tablets (multi-touch must keep working).
- Branding: follow https://brand.audius.co/ (logo rules at https://brand.audius.co/logo). Use only the official assets in `app/public/assets/audius/`. Keep the name **Audius Studio** and the domain `audius-studio.online`.
- Keep all existing features working: Web Audio engine, demo stems, stem upload (WAV/MP3/FLAC/OGG/M4A), playlist clip slice/slip/trim/paint, step sequencer, piano roll, 10-band EQ + FX mixer, WAV master/stem export, and project save/load (localStorage key `audius_studio_projects_v1` and `.dawproj.json`).

## 5. How to work

1. **Audit first.** Serve `app/public` statically (e.g. `python3 -m http.server` in that folder; production is static Cloudflare Pages, so `app/server.mjs` and `/api` aren't available there). Use Playwright to screenshot every target size, in a dark theme and the light "Audius Day" theme, with each window open. Measure overflow, overlaps, clipped text, font sizes, touch-target sizes and header/lane alignment. Exercise every button, menu, tool and shortcut while watching the console. Write the findings down before changing code.
2. **Then redesign and fix.** Show me before/after screenshots at desktop, tablet and Note 3 sizes before you consider it done.
3. **Branch and deploy:** work on your own branch off `main` and open a PR. Merging to `main` automatically deploys `app/public` to Cloudflare Pages through `.github/workflows/deploy-cloudflare-pages.yml`. That workflow already has the `CLOUDFLARE_API_TOKEN` repository secret and checks every file on the live hosts. After merge, check that run; to re-check by hand, run `tools/cloudflare/verify_pages.sh app/public https://audius-studio.pages.dev https://audius-studio.online https://www.audius-studio.online`.
4. **Never ask me to paste API tokens or keys into chat.** Don't change DNS. The domain is on Cloudflare and works. GitHub Pages has been unpublished and its custom domain removed; don't re-enable it.

## 6. Done means

- No horizontal scroll and nothing clipped or overlapping at every target size, in every theme.
- Every control works, with no console errors.
- All the standing constraints above still hold.
- The PR is merged, the deploy workflow is green, and the live site passes `verify_pages.sh`.
