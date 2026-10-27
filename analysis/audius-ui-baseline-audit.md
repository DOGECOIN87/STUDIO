# Audius Studio UI Baseline Audit

**Audit date:** 2026-10-18  
**Source build:** `d8a36aa` (`origin/main`; prompt branch `c52870b`)  
**Method:** Served `app/public` with Python's static HTTP server and used Playwright against fresh browser storage. Captured all seven requested viewport sizes, both Audius Dark and Audius Day themes, the startup state, the Stems + Playlist state, and each individual auxiliary window (Step Rack, Piano Roll, Mixer, Inspector, Trellis): 98 screenshots and measurement records in total. Touch emulation and device scale factor 3 were enabled for the Note 3 dimensions. No code had been changed during this audit.

## Findings

The document-level `scrollWidth` equaled the viewport width in all 14 startup viewport/theme combinations, but only because the root document hides overflow. This does not mean the interface fits: the top bar itself has `scrollWidth: 3588px`, and the editing toolbar measures 3497–3864px depending on its panel state. Both bars use horizontal overflow scrolling. At 1920px, the transport and file actions extend beyond the right edge; at 360px, the menu and header controls continue hundreds to thousands of pixels beyond the viewport.

The startup state is wrong. The Library and Playlist are visible as expected, but the Step Rack, Piano Roll, and Mixer are also open. The Inspector and Trellis dock are closed. The requested clean default must keep only Stems + Playlist visible, with the Mixer, Step Rack, Piano Roll, Inspector, and Trellis closed.

The main workspace has visible clipping and controls positioned beyond the viewport even when document-level horizontal scrolling is suppressed. In the startup state, off-viewport interactive elements ranged from 29 at 1920×1080 to 176 at 360×640. In the cleaned Stems + Playlist layout, the corresponding range was 30 at 1920×1080 to 90 at 360×640. On the Note 3 portrait screenshot, the left Library consumes most of the width while the center workspace and its open windows remain laid out side by side, visibly cutting off content.

The sampled count of visible clipped text containers ranged from 16–21 with the startup windows open, and 7–8 in the Stems + Playlist state. Examples include the stem names in the Library, channel names in the Step Rack, track names, clip titles behind their action buttons, section-marker labels, playlist title/tool icons, and the Mixer FX slot content. The Mixer FX chain also falls below the captured desktop viewport when the Mixer is open.

Typography and touch sizing are below the specified standards. Across startup views there were 249 visible text/control samples below 15px on the two Note 3 orientations and 279 on desktop and tablet. In the Stems + Playlist state the sweep found 134 samples below 15px on Note 3 and 164 on desktop/tablet. The number of visible interactive targets below 44px was 197 at startup and 109 in Stems + Playlist. These counts are deliberately scoped to visible DOM controls and representative text classes; they are minimum defect indicators, not a count of every visually small glyph.

The Audius lockup is implemented as inline SVG with both monochrome paths and a colored image overlay. The current theme-specific logo behavior needs verification against Audius's rule that the full-color lockup is for light backgrounds and a contrasting single-color logo is appropriate on dark backgrounds. The app already contains the official assets under `app/public/assets/audius/`.

The static first-load run produced no page errors, console errors, or failed asset requests in Playwright. That does **not** exercise the `/api/projects` save/load requests; those require explicit tests because Cloudflare Pages is static and does not provide the development server API. The save/load failure path is therefore an open audit item until tested after changes.

## Per-size summary

Dark-theme startup and Stems + Playlist measurements; `off-screen` counts include visible controls whose rectangles extend outside the viewport. The document stayed viewport-wide in every case while the header and toolbar had much larger internal scroll extents.

| Viewport | Header / toolbar scroll width | Startup off-screen controls | Stems + Playlist off-screen controls | Startup clipped-text samples | Startup controls below 44px |
|---|---:|---:|---:|---:|---:|
| Desktop 1920×1080 | 3588 / 3813px | 29 | 30 | 16 | 197 |
| Desktop 1366×768 | 3588 / 3813px | 44 | 43 | 18 | 197 |
| Desktop 1440×900 | 3588 / 3813px | 42 | 41 | 18 | 197 |
| Tablet portrait 1024×1366 | 3588 / 3813px | 48 | 48 | 18 | 197 |
| Tablet landscape 1366×1024 | 3588 / 3813px | 44 | 43 | 18 | 197 |
| Note 3 portrait 360×640 | 3588 / 3497px | 176 | 90 | 21 | 197 |
| Note 3 landscape 640×360 | 3588 / 3497px | 119 | 80 | 14 | 197 |

## Reference guidance applied

The requested layout reference is being used only for interaction structure: a compact toolbar, persistent transport, a hint/status area, predictable window switching and keyboard shortcuts. The implementation must not copy third-party names, logos, icons, skins, or artwork. Audius's logo rules require full-color assets only on light backgrounds and sufficient contrast for single-color lockups. Relevant reference: [Audius logo guidance](https://brand.audius.co/logo.html).

## Baseline artifacts

The Playwright measurement JSON and before screenshots are stored outside the source tree at `/home/ubuntu/audius-ui-audit/before/`. The screenshot matrix contains the startup view, the desired Stems + Playlist state, and each auxiliary window state in both themes for every requested viewport.
