@AGENTS.md

# Claude Code rules for this repo

Product facts and constraints live in `PRODUCT.md`. Design references live in `docs/design-reference/`. Design-pass status and the per-area workflow live in `docs/design-pass/`.

## Multi-agent work

- **Who does what:**
  - The main session (Opus) writes the workflow script, reviews the results that survived verification, and gives final approval before any commit.
  - Read-only scanning and auditing steps use the `ui-scanner` agent (Haiku).
  - Steps that change code use the `ui-patcher` agent (Sonnet), each in its own git worktree (`isolation: 'worktree'`), and hand back a patch file instead of editing the main checkout.
  - Checking steps use the `ui-verifier` agent (Sonnet).
- **Verify before reporting:** every issue gets its own separate verifier agent before it is reported or fixed. An issue no verifier confirmed is never reported as fact.
- **Stop fix loops that stall:** a fix loop stops after two iterations in a row without progress, meaning the number of confirmed blocker and major issues did not go down. Report what is left instead of retrying. Never run more than five iterations in total.
- **Plain code for simple decisions:** choosing files, assigning ports and worktrees, picking which agent runs, retries, stop conditions, de-duplication and schema checks are plain JavaScript in the workflow script, never an agent call.
- **Nothing reaches git unreviewed:** nothing is committed or pushed until the main session has reviewed the verified diff. Pushing to `main` deploys `app/public` to audius-studio.online.

## Working on the app

- `app/public` is static (no build step). Serve it with `python3 -m http.server <port> --bind 127.0.0.1` from that folder. In a worktree, use the worktree's own copy on its own port.
- Test with Playwright through `docs/design-pass/harness/lib.cjs` (set `STUDIO_URL` to your server). Run node with `NODE_PATH=/opt/node22/lib/node_modules`.
- Older browsers must keep working, because the owner tests on a Galaxy Note 3 (about Chrome 95) and older iPads (Safari 14–15):
  - In CSS: no `@layer`, `color-mix()`, `oklch()`, `:has()`, container queries, CSS nesting or `@property` without a complete fallback.
  - In JS: no `structuredClone` or `findLast`.
- Never use other music software's product names, logos, skins or plugin names in `app/public`, and never call the app official. It is an unofficial, community-built app for the Audius community.
- When `styles.css` or `app.js` changes, bump their `?v=` numbers in `index.html`.
