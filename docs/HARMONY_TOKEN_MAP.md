# Harmony token map — provenance of every Audius-derived colour in this repo

**Source of truth.** [`@audius/harmony`](https://github.com/AudiusProject/apps/tree/main/packages/harmony) v0.5.3 ("The Audius Design System"), read from `DOGECOIN87/apps@874efb690fb6ee68696630e4271dcc305b53fe9c`:

| Upstream file | What we take from it |
|---|---|
| `src/foundations/typography/avenir.css` | The six Avenir Next LT Pro woff2 faces → shipped verbatim (minified) as `app/public/audius-fonts.css` |
| `src/foundations/color/primitive.css` | Colour values for the `day`, `default-dark`, `matrix` and `dark` themes → `app/public/styles.css` theme blocks |
| `src/foundations/color/semantic.css`, `spacing.css`, `corner-radius.css`, `motion.css`, `shadows.css`, `layers.css`, `typography/fonts.css` | **Not adopted yet** — see §6 |

Licence: the `apps` repository is Apache-2.0; the `@audius/harmony` package declares ISC. Attribution is in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). No Harmony code, component or build pipeline is copied — only values.

**How to read the tables.** `= token` means our value *is* that Harmony token (8-digit `#rrggbbaa` normalised to 6-digit, because `app.js` feeds these into canvas `fillStyle`). `[derived]` means a DAW surface Harmony has no token for; the derivation rule is stated. Everything was produced by diffing our blocks against `primitive.css` programmatically, not by eye.

---

## 1. The font file is upstream, byte for byte

`app/public/audius-fonts.css` (241,960 B) and Harmony's `avenir.css` (242,079 B) differ only in the header comment and whitespace. All six base64 woff2 payloads have identical SHA-256 digests (first 8 hex): `588288aa`, `9a638b44`, `7663ee06`, `c7a0ae10`, `964343e1`, `c33ce228` — weights 100, 400, 500, 600, 700, 900, family `Avenir Next LT Pro`.

The typeface is a commercial Linotype/Monotype design that Audius redistributes; see the note in `THIRD_PARTY_NOTICES.md`.

## 2. `amoled` — "Audius Neue Dark" ↔ Harmony `default-dark`

Corrected 2026-10-21. Before this, the block claimed in a comment to be `@audius/harmony defaultDarkPrimitives` and the swatch tooltip in `index.html` advertised `#0F0F0F` + `#806AD8 / #C67CFF`, but the values were a violet-cast reinterpretation (`#0A0A0E`, `#14141B`, `#1F1F2B`, `#26233A`, `#352F52`, accent `#A74CFF` — which is `default-light`'s *secondary*, not this theme's primary). Now the CSS says what the UI claims.

| Our role | Value | Harmony token |
|---|---|---|
| `--bg-darkest` | `#0F0F0F` | `n-25` (also `white`) |
| `--bg-panel` | `#141414` | `n-50` |
| `--bg-panel-alt` | `#1F1F1F` | `n-100` |
| `--bg-header` | `#1A1A1A` | **[derived]** midpoint of `n-50`→`n-100`, hue-neutral |
| `--bg-control` | `#292929` | `n-150` |
| `--bg-hover` | `#333333` | `n-200` |
| `--bg-selected` | `#261F40` | `p-100` (Harmony's primary-tint step = selected surface) |
| `--border-color` | `#292929` | `n-150` |
| `--border-subtle` | `#1F1F1F` | `n-100` |
| `--border-strong` | `#474747` | `n-300` |
| `--text-main` | `#E0E0E0` | `n-900` |
| `--text-muted` | `#9E9E9E` | `n-700` |
| `--text-disabled` | `#636363` | `n-400` — Harmony's *semantic* `text-disabled` is `n-150`, which is built for light surfaces and would be invisible here |
| `--accent-orange`, `--accent-fill`, `--play-glow`, `--cv-loop` | `#806AD8` | `primary` (`p-300`, also `blue` and `gradient-color-1` in this theme) |
| `--accent-orange-bright` | `#9E8EE8` | `p-400` (also `gradient-color-2`) |
| `--accent-press` | `#443873` | `p-200` |
| `--accent-on-primary` | `#0F0F0F` | `n-25` — 4.54:1 on primary vs white's 4.22:1, and it matches how `forest` does it |
| `--accent-amber`, `--accent-text`, `--cv-playhead` | `#C67CFF` | `secondary` (`s-300`) |
| `--accent-teal`, `--lit`, `--info` | `#2A85E8` | `trending-blue` — `harmony-blue` duplicates `primary` in `default-dark`, so it cannot carry the info role |
| `--accent-green` | `#84DF64` | `green` |
| `--accent-red` | `#F94D62` | `red` |
| `--audius-gradient` | `315deg, #806AD8 → #9E8EE8` | `--harmony-gradient` verbatim |
| `--accent-gradient` | `135deg, #9E8EE8 → #443873` | **[derived]** `gradient-color-2` → `p-200` |
| `--lit-bg`, `--lit-bg-hover` | `#1B2C45`, `#22385A` | **[derived]** `trending-blue` over `n-100` |
| `--cv-lane-even`, `--cv-lane-odd` | `#121212`, `#0D0D0D` | **[derived]** playlist lanes sit below `n-50` |
| `--cv-lane-selected` | `#261F40` | `p-100` |
| `--cv-ruler-text-dim` | `#757575` | `n-500` |
| `--cv-tick-bar`, `--cv-grid-*`, `--cv-veil`, `--cv-wp-*` | rgba of `n-700` / `n-900` / `n-25` / `primary` | **[derived]** same alphas as every other theme |
| `*-rgb` triplets | — | rgba mirrors of the hexes above |

The matching canvas fallbacks in `app.js` (`THEMES.amoled`, used when a `--cv-*` token is absent) were updated to the same values, so first paint and re-theming agree.

**Contrast on `--bg-darkest` `#0F0F0F`:** text-main 14.52:1 · text-muted 7.15:1 · accent-text 7.05:1 · primary-as-text 4.54:1 · trending-blue 5.13:1 · green 11.61:1 · red 5.72:1 · text-disabled 3.19:1 (disabled state, not body text). All body text ≥ 7:1, everything ≥ AA.

## 3. `forest` — "Matrix" ↔ Harmony `matrix`: faithful

`--bg-darkest` `n-25` · `--bg-panel` `n-50` · `--bg-panel-alt` `n-100` · `--bg-control` `n-150` · `--bg-hover` `n-200` · `--border-color` `n-300` · `--text-main` **`n-950`** · `--text-muted` `n-700` · `--accent-orange`/`--accent-fill`/`--play-glow` `primary` · `--accent-orange-bright`/`--accent-text` `p-500` · `--accent-on-primary` `n-25` · `--accent-amber` `n-800` (also `neutral`) · `--accent-teal` `blue` · `--accent-green` `secondary` · `--accent-red` `red` · gradient uses `primary`, `gradient-color-2`, `blue`.

Derived (no upstream token): `--bg-header #081A0B`, `--bg-selected #113819`, `--border-subtle #0F441B`, `--border-strong #249741`, `--text-disabled #1E7E39`, `--accent-press #09B609` (one green-channel step off `p-200 #09B509`), `--lit-bg`, `--lit-bg-hover`, and the canvas lanes.

## 4. `daylight` — "Audius Day" ↔ Harmony `day`: faithful core, derived chrome

Harmony tokens: `--bg-darkest`/`--bg-header` `n-100` · `--bg-panel` `background` · `--bg-panel-alt`/`--accent-on-primary`/`--surface-3`/`--surface-popover`/`--cv-lane-even` `white` · `--bg-control`/`--surface-press` `n-150` · `--bg-hover`/`--border-color` `n-200` · `--text-muted` `neutral` (`n-800`) · `--accent-orange`/`--cv-playhead` `primary` · `--accent-orange-bright` `p-100` · `--accent-amber`/`--play-glow`/`--cv-loop` `secondary` · `--accent-teal` `blue` · `--accent-green` `green` · `--accent-red`/`--danger-fill` `red` · `--cv-lane-odd` `background` · `--audius-gradient` = `gradient-color-1`, `gradient-color-2`, `primary`.

One value comes from Harmony's *other* light theme: `--text-main #343B49` = `default-light`'s `neutral` / `n-800`.

Derived: `--bg-selected #F0E0FF`, `--surface-2 #FBFAFC`, `--surface-hover #F1ECF7`, `--border-subtle #E3E2E6`, `--border-strong #7E7A8E`, `--text-disabled #AAA7B6`, `--accent-fill #B80DCB`, `--accent-text #9A0AAB`, `--accent-press #9B0BAB`, `--lit/--info/--lit-bg/--lit-bg-hover`, `--danger-text #B0001A`, `--logo-ink #110051`, canvas lanes and veils.

## 5. `audius-dark` (default) — deliberate hybrid, left alone

Not one Harmony theme but two: **`dark` neutrals + `day` accents.**

- From `dark`: `--bg-panel-alt #2F3348` = `white` · `--bg-control #353A51` = `n-50` · `--border-color #3C425D` = `n-100` · `--bg-hover #444B69` = `n-150` · `--text-muted #A6AAC0` = `n-600` · `--accent-orange-bright #D767E1` = `primary` · `--accent-amber #C67CFF` = `secondary` · `--accent-green #15D864` = `light-green` · `--accent-red #F9344C` = `red`
- From `day`: `--accent-orange #CC0FE0` = `primary` · `--play-glow #7E1BCC` = `secondary` · `--accent-teal #1BA1F1` = `blue` · `--audius-gradient #5B23E1 → #A22FEB → #CC0FE0` = `gradient-color-1`, `gradient-color-2`, `primary`
- Ours entirely: `--bg-darkest #1B1C2A`, `--bg-panel #242538`, `--bg-header #2A2E43`, `--bg-selected #392B56`, `--text-main #F6F8FC`, the fill/press/text accent shades (`#B80DCB`, `#9B0BAB`, `#E28BEA`, `#C011D6`, `#8A1FD6`, `#9B35F0`), the border-subtle/strong pair, `--lit-bg`, and every canvas lane

This is the app's signature look and the magenta-on-deep-space identity in the swatch tooltip. Re-mapping it onto Harmony `dark` (background `#202131`, `n-25 #30354a`, primary `#d767e1`) would make it match audius.co's classic dark exactly and lose that identity — **a product decision, not a correctness fix, so it was not made.**

The remaining six themes (`amethyst`, `ocean`, `obsidian`, `cyberpunk`, `platinum-slate`, `nordic`) are original and make no Harmony claim; their names reference Audius *brand assets* (tier badges, trending blue), not Harmony themes.

## 6. Harmony foundations we have not adopted

Available as plain CSS custom properties, no build step, if we ever want them:

- **Spacing** — 4 px grid: `--harmony-unit` 4 px, `--harmony-unit-1…24` (4→96 px), `--harmony-spacing-xs…5xl` (4, 8, 12, 16, 24, 32, 48, 64, 128 px). Note `--harmony-unit-11: 44px` is exactly our touch-target minimum.
- **Corner radius** — `xs 2px, s 4px, m 8px, l 12px, xl 16px, 2xl 32px`
- **Motion** — `--harmony-quick 0.07s ease-in-out`, `--harmony-expressive 0.18s ease-in-out`, `--harmony-hover`/`--harmony-press` `0.12s cubic-bezier(0.44,0,0.56,1)`, `--harmony-calm 0.5s ease-in-out`
- **Shadows** — `near`, `mid`, `mid-inverted`, `far`, `emphasis`, plus `--harmony-drop-shadow`
- **Layers** — `0 / 10000 (modal) / 20000 (popup) / 30000 (tooltip)`
- **Type** — `--harmony-font-2xs…9xl` (10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 56, 72, 96 px), line heights 12→120 px, weights 100/400/500/600/700/900, stack `'Avenir Next LT Pro', 'Helvetica Neue', Helvetica, Arial, sans-serif`

Adopting these is additive (a token layer plus rewiring rules whose values already agree) and needs a layout re-verify at 360 px and 4K, which is why it is a separate decision from the colour fix.

## 7. Rules for any future Harmony adoption

1. **Never copy `semantic.css` verbatim.** Its `--harmony-focus` is `color-mix(in srgb, var(--harmony-secondary) 70%, transparent)`, and `color-mix()` is banned here (`CLAUDE.md`) and unsupported in Chrome 95 / Safari 14. Precompute per theme, e.g. `rgba(198,124,255,0.7)`.
2. **Strip 8-digit hex.** `:root`, `day`, `dark` and `matrix` write `#cc0fe0ff`. `app.js` reads tokens into canvas (`syncCanvasTheme()`, `--accent-orange` at `app.js:780`), so normalise to 6-digit hex or rgba.
3. **Harmony's semantic roles assume a light surface stack.** `--harmony-text-disabled` is `n-150` and `--harmony-bg-surface-1` is `n-25`; on our dark themes those invert. Map roles by contrast measurement, not by name.
4. **Every value that lands in `styles.css` gets a token comment** so the next drift is visible in the diff, and the `*-rgb` / `--cv-*` mirrors and the `app.js` `THEMES` fallbacks are updated in the same change.
5. **Bump `?v=`** on `styles.css` / `app.js` in `index.html` (`CLAUDE.md`).

## 8. What was verified for the 2026-10-21 change

- `amoled` block still defines the same 51 custom properties in the same order — only values changed (diffed against `HEAD`)
- `styles.css`: braces balanced 1259/1259; the single unmatched `(` is pre-existing, inside a comment at line 756
- No banned feature introduced: `@layer`, `color-mix(`, `oklch(`, `:has(`, `@property`, `@container` all count 0; no 8-digit hex anywhere in the file
- Contrast ratios computed for every text/accent pair on the new backgrounds (§2)
- `node test/api/smoke.mjs` → 36 passed, 0 failed (includes "handler block only calls identifiers that exist", which re-parses `app.js`)
- **Not verified here:** rendered appearance. This sandbox has no browser (Playwright is a devDependency but its browsers cannot be downloaded), so `tools/browser/layout-audit.mjs` and a visual check of Neue Dark on the live site are still outstanding.
