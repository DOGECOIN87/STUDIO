# Design pass: work in progress

Saved so no progress is lost between sessions. Nothing here is deployed (it is outside `app/public`).

The owner's direction is **"Elevate the Audius look"**: keep the Audius dark-purple brand and Avenir Next, then add pro-studio craft. Work goes **one area at a time**: design, build, verify, then screenshots for the owner, before the next area starts.

The button language comes from `docs/design-reference/31-owner-liked-top-buttons.jpg`. Pads stay pads: no waveforms on them.

## Status

| # | Area | State |
|---|---|---|
| 1 | Design foundation (tokens, type scale, surfaces, buttons, DESIGN.md) | **Live** (patch-0 applied at the owner's request). Six major issues found by the checks are still open; see below |
| 2 | Tool bar | not started |
| 3 | Library / Stems browser | not started |
| 4 | Playlist | not started |
| 5 | Step / Channel Rack | not started |
| 6 | Piano Roll | not started |
| 7 | Mixer + FX slots | not started |
| 8 | Effect windows and Clip Inspector | not started |
| 9 | Trellis pads | not started |
| 10 | Menus, sheets, dialogs | not started |
| 11 | Phone layout | not started |
| 12 | Themes sweep | not started |

> **2026-10-21 — the `amoled` palette changed; do not restore it from the files below.**
> The Audius Neue Dark theme was rebuilt on the real `@audius/harmony` `default-dark` tokens (surfaces `#0F0F0F`/`#141414`/`#1A1A1A`/`#292929`, accent `#806AD8`, accent-text `#C67CFF`, lit/info `#2A85E8`). `foundation/spec.md` (the `amoled` row of its token table), `foundation/proto/tokens-extra.css` and `foundation/study-findings.json` still show the pre-correction values (`#0A0A0E`, `#14141B`, `#A74CFF`, `#8E3CE0`, …) because they are point-in-time records and are deliberately left as they were. The authoritative map is [`docs/HARMONY_TOKEN_MAP.md`](../HARMONY_TOKEN_MAP.md); the change and its verification are in `HANDOVER.md` §12. Area 12 (themes sweep) should start from the map, not from `spec.md`.



> **2026-10-23 — first real-browser check (Chromium + Playwright).** The six defects that used to be listed here were re-tested and are all already fixed: Export/Shortcuts dialogs scroll their body at 640×360 with title and buttons visible; the touch clip menu scrolls instead of clipping; daylight pad names read at 10.8:1; the Open Project footer fits at 320px; Undo/Redo are 44×44 on touch; Space after a mouse click plays/stops.
>
> That pass found and fixed these instead (`styles.css?v=46`, `app.js?v=44`): on touch tablets 920–1340px wide the transport ran up to 63px under the layout button, hiding the tempo +; short-landscape touch tools were 40×40; at 640×360 the Meter summary overlapped the layout button; on phones the 44px Library tab spilled 6px onto Add Track; desktop 800–1080px cut every demo track name; an empty or 0 tempo jumped to 124 BPM; and on Cloudflare Pages every open tab re-downloaded index.html every 60s through the `/api/health` probe (Save also POSTed the project there). A width sweep 320–1920 × 500/800, desktop and touch, is clean except the intentional ellipsis on the phone position read-out.
>
> Still open: the phone portrait header uses ~46% of a 360×640 screen (owner asked for one transport row + one window-tab row); Step Rack steps are 34px wide on touch tablets; `tools/browser/layout-audit.mjs` (raw CDP) hangs in the Claude cloud sandbox — use the Playwright harness there.
>
> Not re-tested (minor, from the earlier checks): the track Vol/Pan double-click reset never fires; letter shortcuts fire while a dropdown has focus; a right-click within 800 ms of a touch tap is treated as a long-press on hybrid devices; the status toast covers the open More menu on phones; a stray divider appears beside a wrapped close button.

## Files

- `foundation/spec.md`: the full build spec for area 1, with 33 acceptance criteria. Its first paragraph is a compatibility override that wins over the spec. **No `@layer`, `color-mix()`, `:has()` and similar newer CSS,** because the owner's Galaxy Note 3 runs about Chrome 95 and older iPads run Safari 14–15.
- `foundation/study-findings.json`: the visual (18) and interaction (17) findings the spec was built from.
- `foundation/proto/`: the lead designer's prototype CSS (`tokens-extra.css`, `roles.css`, `system-final.css`) and `build.py`. They are reference copies; the spec is normative. They were written with `@layer`, so apply them without it.
- `harness/lib.cjs`: the Playwright harness: viewports, open a window, screenshot, and a probe for overflow, clipping, text under 15px and touch targets under 44px. `harness/before.cjs` captures the baseline.
- `workflow-studio-aspect-design.js`: the per-area workflow:
  - Haiku scans every file slice and viewport (read-only).
  - Sonnet confirms each candidate with its own verifier, builds in its own git worktree and hands back a patch, then verifies the patch in worktrees, with one verifier per issue.
  - Fix rounds stop after two rounds without progress.
  - Plain JavaScript does the routing.
  - The main session (Opus) reviews the patch and screenshots and approves before commit. Run it with `args.specFile` set to `foundation/spec.md` (absolute path) to reuse the saved spec.

## Resuming

1. Serve `app/public` statically on port 8767.
2. Copy `harness/lib.cjs` to the scratchpad path the workflow expects, or edit the `SP` path in the workflow script.
3. Run the workflow for area 1, using `foundation/spec.md` as the spec.
4. When it finishes, check the screenshots, bump the `?v=` numbers in `index.html` and push to `main`. Pushing to `main` deploys to audius-studio.online.
