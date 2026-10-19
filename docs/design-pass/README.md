# Design pass: work in progress

Saved so no progress is lost between sessions. Nothing here is deployed (it is outside `app/public`).

The owner's direction is **"Elevate the Audius look"**: keep the Audius dark-purple brand and Avenir Next, then add pro-studio craft. Work goes **one area at a time**: design, build, verify, then screenshots for the owner, before the next area starts.

The button language comes from `docs/design-reference/31-owner-liked-top-buttons.jpg`. Pads stay pads: no waveforms on them.

## Status

| # | Area | State |
|---|---|---|
| 1 | Design foundation (tokens, type scale, surfaces, buttons, DESIGN.md) | Studies and build spec done; **build not started** (stopped by the owner) |
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
