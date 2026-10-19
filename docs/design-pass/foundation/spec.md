<!-- Build spec for the design-foundation pass, written by the lead-designer step. -->
> **Override (lead, applies before anything below):** do not use `@layer`, `color-mix()`, `oklch`, `:has()`, container queries, CSS nesting or `@property`. The owner tests on a Galaxy Note 3 (about Chrome 95) and older iPads, where `@layer` drops the whole block and leaves the app unstyled. Keep the same intent with the system block at the end of `styles.css`, higher specificity, and literal per-theme colours. Prototype paths below that point at `/tmp/...scratchpad/design/work/foundation/lead/proto/` are copied to `docs/design-pass/foundation/proto/`.


# Design foundation spec: "Elevated Audius" studio system (tokens, primitives, DESIGN.md)

Lead designer's decisions for the foundation pass of Audius Studio, an unofficial community browser DAW. Everything below is decided. The implementer edits only `app/public/styles.css`, `app/public/index.html` and `app/public/app.js`, and creates `/home/user/DAW/DESIGN.md` and `/home/user/DAW/.impeccable/design.json`.
- Do not touch `audio-engine.js` or `wav-codec.js`.
- Do not commit or switch branches, and do not change any `?v=` number.
- Read `/home/user/dogecoin87/impeccable/plugin/skills/impeccable/reference/craft-floor.md` before the first edit.
- Put your scripts and screenshots under `/tmp/claude-0/-home-user-DAW/717ea5f2-42d2-5656-8044-03574a727b85/scratchpad/design/work/foundation/`.

**Validated prototype.** I built and probed this system as a stylesheet injected through Playwright. It produced no new overflow, clipping, overlap or sub-15px text against the baseline at 1920, 1440, 1366, 1280, 1201, 901, 1024t, 1366t, 360t, 640t, 320t and 3840. The files are reference copies; this spec is normative. They live in `/tmp/claude-0/-home-user-DAW/717ea5f2-42d2-5656-8044-03574a727b85/scratchpad/design/work/foundation/lead/proto/`:
- `tokens-extra.css`: per-theme extras
- `roles.css`: role contract
- `system-final.css`: the system layer
- `build.py`: legacy deletions as applied in the prototype
- `shots/`: screenshots

**The owner's direction, restated as rules:**
- **Keep:** the Audius dark-purple brand and Avenir Next.
- **Add:** pro-studio craft. Every control stays standard and obvious.
- **Button language (from `31-owner-liked-top-buttons.jpg`):**
  - separate raised rounded buttons, a step lighter than their panel, with a hairline light border, a faint top highlight and a soft shadow;
  - bold white icon plus label;
  - segmented controls on a dark inset track, whose active segment is the magenta-to-violet gradient with a soft glow;
  - a larger lit violet Play;
  - inset LCD wells with bright blue tabular numbers;
  - selected/on shown as a cyan-blue lit edge with a glow;
  - raised navy rack panels holding control groups;
  - spaced uppercase section titles with a violet icon.
- **Pads are pads.** The owner repeated this in this run ("Those are pads not waveforms"). Pads never show waveforms, headphone/S/M chips or any clip-style content.
- **Logo:** on dark themes it stays the white single-colour lockup. Never use the mock-up's gradient glyph.

---

## 1. Architecture of styles.css (cascade layers)

Final file order:

1. **Line 1:** `@layer legacy, system;`. This fixes the precedence: system beats legacy for every normal declaration, whatever the specificity.
2. **Theme blocks (unlayered).** These are the existing 10 blocks, currently lines 1–242: `:root, body[data-theme="audius-dark"]`, amoled, amethyst, ocean, forest, daylight, obsidian, cyberpunk, platinum-slate, nordic.
   - Append each theme's role extras (section 2.2) inside its block, before the closing brace.
   - Delete `--font-mono` from the first block. Readouts use Avenir tabular figures; nothing else uses it.
   - Delete the unused `--audius-coin-gradient` declarations.
3. **Role contract block (unlayered),** right after the nordic block: section 2.1, including its `@media (pointer: coarse), (hover: none)` size override and the daylight canvas veil line.
4. **`@layer system { … }`:** section 3. It is new, and it is the only place that styles look (skin).
5. **`@layer legacy { … }`:** wrap everything from the current line 244 (`* { box-sizing…`) to the end of the file. Then apply the deletions and geometry edits in section 4.

**Rules of the split:**
- **Legacy owns geometry:** display, position, width, height, flex, grid, margin, padding, gap, overflow, z-index, and responsive show/hide.
- **System owns skin:** background, color, border colour, style and width, radius, shadow, outline, font, letter-spacing, text-transform, transition, cursor, opacity, filter.
- **Exceptions:** system may set geometry only on its own new classes (`.btn*`, `.rack`, `.lcd*`, `.segmented`, `.stepper`, `.tooltip`, `.toast`, `.visually-hidden`, `.empty-state`) plus these listed cases:
  - `.pat-song-stack` padding;
  - checkbox and range sizes, through tokens;
  - the close-button spacing in title bars.
- **System never sets `display` on a legacy class.** Legacy uses normal `display:none` to hide summaries and panes, and a later layer would override it.
- **Legacy `!important` beats system.** A legacy `!important` declaration of a visual property therefore blocks the system and must be deleted (section 4, D-list).

---

## 2. Tokens

### 2.1 Role contract (unlayered, after the theme blocks)

Every theme maps onto these roles. Most derive from the palette variables the theme blocks already define, so nothing is duplicated.

The block is declared on `:root, body` because the custom accent and background pickers set the legacy variables inline on `body`. Derived roles must therefore resolve on `body`.

Theme blocks (`body[data-theme=…]`, specificity 0,1,1) override any role here (specificity 0,0,1).

**Surfaces**

| Token | Value |
|---|---|
| `--surface-0` | `var(--bg-darkest)` |
| `--surface-1` | `var(--bg-panel)` |
| `--surface-2` | `var(--bg-header)` |
| `--surface-3` | `var(--bg-control)` |
| `--surface-popover` | `var(--bg-panel-alt)` |
| `--surface-hover` | `var(--bg-hover)` |
| `--surface-press` | `var(--bg-header)` |
| `--select-bg` | `var(--bg-selected)` |

**Lines**

| Token | Value |
|---|---|
| `--border` | `var(--border-color)` |
| `--border-subtle` | `color-mix(in srgb, var(--border-color) 60%, var(--bg-panel))` |
| `--border-strong` | `color-mix(in srgb, var(--text-muted) 45%, var(--border-color))` |
| `--hairline` | `color-mix(in srgb, var(--text-main) 10%, transparent)` |
| `--hairline-strong` | `color-mix(in srgb, var(--text-main) 16%, transparent)` |

**Text**

| Token | Value |
|---|---|
| `--text-primary` | `var(--text-main)` |
| `--text-secondary` | `var(--text-muted)` |
| `--text-disabled` | `color-mix(in srgb, var(--text-muted) 55%, var(--bg-panel))` |
| `--on-accent` | `var(--accent-on-primary)` |

**Accent and brand**

| Token | Value |
|---|---|
| `--accent` | `var(--accent-orange)` |
| `--accent-fill` | `var(--accent-orange)` (themes override) |
| `--accent-text` | `var(--accent-orange-bright)` (themes override) |
| `--accent-gradient` | `var(--audius-gradient)` (themes override) |
| `--accent-press` | `color-mix(in srgb, var(--accent-fill) 84%, #000000)` |
| `--brand-gradient` | `var(--audius-gradient)` |
| `--brand-stripe` | `linear-gradient(90deg, var(--accent) 0%, var(--lit) 100%)` |
| `--play-gradient` | `var(--accent-gradient)` |
| `--play-glow` | `var(--accent)` |

**Lit, info and focus**

| Token | Value |
|---|---|
| `--lit` | `var(--accent-teal)` |
| `--lit-bg` | `color-mix(in srgb, var(--lit) 14%, var(--surface-3))` |
| `--lit-bg-hover` | `color-mix(in srgb, var(--lit) 22%, var(--surface-3))` |
| `--info` | `var(--accent-teal)` |
| `--lcd-text` | `var(--info)` |
| `--focus` | `var(--text-main)` |
| `--glow-mix` | `60%` |

**Channel states and danger**

| Token | Value |
|---|---|
| `--state-play` | `var(--accent-green)` |
| `--state-record` | `var(--accent-red)` |
| `--state-mute` | `#F08A24` |
| `--state-solo` | `#F5C842` |
| `--on-state` | `#1B1C2A` |
| `--led-on` | `var(--accent)` |
| `--danger` | `var(--accent-red)` |
| `--danger-fill` | `#D81F38` |
| `--danger-text` | `#FF8A97` |
| `--danger-soft` | `color-mix(in srgb, var(--danger) 16%, transparent)` |

**Meters and misc**

| Token | Value |
|---|---|
| `--meter-trough` | `var(--surface-0)` |
| `--meter-ok` | `var(--accent-green)` |
| `--meter-warn` | `#F5C842` |
| `--meter-clip` | `var(--danger)` |
| `--range-thumb` | `#FFFFFF` |
| `--sw-fg` | `#FFFFFF` |
| `--logo-ink` | `var(--text-main)` |
| `--check-mask` | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E")` (Lucide "check", ISC) |

**Depth**

| Token | Value |
|---|---|
| `--shadow-rgb` | `0 0 0` |
| `--shadow-k` | `1` |
| `--bevel-color` | `rgb(255 255 255 / 0.07)` |
| `--sheen-a` | `0.05` |
| `--bevel` | `inset 0 1px 0 var(--bevel-color)` |
| `--bevel-strong` | `inset 0 1px 0 rgb(255 255 255 / 0.22)` |
| `--well` | `inset 0 1px 2px rgb(var(--shadow-rgb) / calc(0.5 * var(--shadow-k))), 0 1px 0 var(--bevel-color)` |
| `--shadow-1` (controls) | `0 1px 2px rgb(var(--shadow-rgb) / calc(0.35 * var(--shadow-k))), 0 2px 6px -3px rgb(var(--shadow-rgb) / calc(0.45 * var(--shadow-k)))` |
| `--shadow-2` (racks, tooltips) | `0 2px 4px rgb(var(--shadow-rgb) / calc(0.3 * var(--shadow-k))), 0 6px 12px -6px rgb(var(--shadow-rgb) / calc(0.5 * var(--shadow-k)))` |
| `--shadow-3` (popovers, dialogs, toasts) | `0 2px 4px rgb(var(--shadow-rgb) / calc(0.3 * var(--shadow-k))), 0 10px 16px -8px rgb(var(--shadow-rgb) / calc(0.6 * var(--shadow-k)))` |

No blur exceeds 16px, which avoids the "thin border + wide shadow" tell.

**Canvas (read by app.js, section 6.1)**

| Token | Value |
|---|---|
| `--cv-bg` | `var(--surface-0)` |
| `--cv-lane-even` | `color-mix(in srgb, var(--surface-1) 70%, var(--surface-0))` |
| `--cv-lane-odd` | `color-mix(in srgb, var(--surface-1) 25%, var(--surface-0))` |
| `--cv-lane-selected` | `color-mix(in srgb, var(--select-bg) 80%, var(--surface-0))` |
| `--cv-lane-border` | `var(--border-subtle)` |
| `--cv-ruler-bg` | `var(--surface-2)` |
| `--cv-ruler-border` | `var(--border)` |
| `--cv-ruler-text` | `var(--text-secondary)` |
| `--cv-ruler-text-dim` | `color-mix(in srgb, var(--text-secondary) 65%, var(--surface-2))` |
| `--cv-tick-bar` | `color-mix(in srgb, var(--text-secondary) 70%, transparent)` |
| `--cv-tick-beat` | `var(--border)` |
| `--cv-grid-bar` | `color-mix(in srgb, var(--text-primary) 16%, transparent)` |
| `--cv-grid-beat` | `color-mix(in srgb, var(--text-primary) 7%, transparent)` |
| `--cv-grid-sub` | `color-mix(in srgb, var(--text-primary) 3.5%, transparent)` |
| `--cv-playhead` | `var(--info)` |
| `--cv-loop` | `var(--accent)` (must resolve to hex; app.js passes it to `hexToRgba`) |
| `--cv-loop-shade` | `color-mix(in srgb, var(--cv-loop) 5%, transparent)` |
| `--cv-marquee` | `var(--lit)` |
| `--cv-veil` | `color-mix(in srgb, var(--surface-0) 88%, transparent)` |
| `--cv-wp-lane-even` | `color-mix(in srgb, var(--text-primary) 3%, transparent)` |
| `--cv-wp-lane-odd` | `color-mix(in srgb, var(--surface-0) 30%, transparent)` |
| `--cv-wp-lane-selected` | `color-mix(in srgb, var(--accent) 12%, transparent)` |
| `--cv-osc-bg` | `var(--surface-0)` |
| `--cv-osc-line` | `var(--accent)` |

**Type**

| Token | Value |
|---|---|
| `--font-num` | `var(--font-ui)` (Avenir's digits are already tabular; apply `font-variant-numeric: tabular-nums lining-nums`) |
| `--fs-label` | `15px` |
| `--fs-body` | `16px` |
| `--fs-title` | `16px` |
| `--fs-section` | `15px` |
| `--fs-heading` | `20px` |
| `--fs-readout-lg` | `22px` |
| `--fs-readout-md` | `20px` |
| `--fs-readout-sm` | `15px` |
| `--fs-kbd` | `13px` |
| `--lh-tight` | `1.2` |
| `--lh-label` | `1.4` |
| `--lh-body` | `1.5` |
| `--track-ui` | `-0.01em` (keeps today's fit; 0 widened text enough to clip track names and wrap the drop-zone title) |
| `--track-section` | `0.08em` |

**Space, shape and size**

| Group | Tokens |
|---|---|
| Space | `--space-2xs: 2px`, `--space-xs: 4px`, `--space-sm: 6px`, `--space-md: 8px`, `--space-lg: 12px`, `--space-xl: 16px`, `--space-2xl: 24px` |
| Radius scale | `--r-xs: 4px`, `--r-sm: 6px`, `--r-md: 8px`, `--r-lg: 12px`, `--r-xl: 16px` |
| Radius roles | `--r-ctl: var(--r-md)`, `--r-ctl-sm: var(--r-sm)`, `--r-panel: var(--r-lg)`, `--r-dialog: var(--r-xl)` |
| Control heights | `--ctl-h: 34px`, `--ctl-h-sm: 26px`, `--ctl-h-xs: 24px`, `--ctl-h-lg: 40px` |
| Icons | `--icon-sm: 16px`, `--icon-md: 18px`, `--icon-lg: 20px` |
| Range and check | `--range-h: 24px`, `--range-track: 4px`, `--thumb: 14px`, `--check: 18px` |

**Motion**

| Token | Value |
|---|---|
| `--dur-press` | `80ms` |
| `--dur-fast` | `120ms` |
| `--dur-base` | `180ms` |
| `--dur-slow` | `240ms` |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` (the existing `:root{--ease-out}` in the legacy motion block is deleted) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` |

**Touch override:** `@media (pointer: coarse), (hover: none) { :root, body { … } }` sets:
- `--ctl-h`, `--ctl-h-sm`, `--ctl-h-xs` and `--ctl-h-lg`: all `44px`
- `--r-ctl: var(--r-lg)` (12px) and `--r-ctl-sm: 10px`
- `--range-h: 44px`, `--range-track: 6px`, `--thumb: 22px`, `--check: 22px`

**Daylight veil:** `body[data-theme="daylight"] { --cv-veil: color-mix(in srgb, var(--surface-1) 80%, transparent); }`

### 2.2 Per-theme extras (append inside each existing theme block)

| Theme | Extras |
|---|---|
| audius-dark (`:root, body[data-theme="audius-dark"]`) | `--accent-fill:#B80DCB` `--accent-text:#E28BEA` `--accent-gradient:linear-gradient(135deg,#C011D6 0%,#8A1FD6 55%,#5B23E1 100%)` `--play-gradient:linear-gradient(135deg,#9B35F0 0%,#5B23E1 100%)` `--play-glow:#7E1BCC` `--cv-lane-even:#222436` `--cv-lane-odd:#1D1F2F` `--cv-lane-selected:#31254B` `--cv-playhead:#1BA1F1` `--cv-loop:#CC0FE0` |
| amoled | `--accent-fill:#8E3CE0` `--accent-text:#C67CFF` `--accent-gradient:linear-gradient(135deg,#9B45F0 0%,#5B3FD0 100%)` `--play-glow:#806AD8` `--lit:#1BA1F1` `--info:#1BA1F1` `--cv-lane-even:#12121A` `--cv-lane-odd:#0D0D13` `--cv-lane-selected:#221B3A` `--cv-playhead:#C67CFF` `--cv-loop:#806AD8` |
| daylight | `--surface-2:#FBFAFC` `--surface-3:#FFFFFF` `--surface-popover:#FFFFFF` `--surface-hover:#F1ECF7` `--surface-press:#E7E7EA` `--border-strong:#7E7A8E` `--hairline:color-mix(in srgb,var(--text-main) 14%,transparent)` `--hairline-strong:color-mix(in srgb,var(--text-main) 22%,transparent)` `--accent-fill:#B80DCB` `--accent-text:#9A0AAB` `--accent-gradient:linear-gradient(135deg,#B80DCB 0%,#5B23E1 100%)` `--play-gradient:linear-gradient(135deg,#9B35F0 0%,#5B23E1 100%)` `--play-glow:#7E1BCC` `--lit:#0B76B8` `--info:#0B6FAD` `--danger-fill:#D0021B` `--danger-text:#B0001A` `--shadow-rgb:40 30 70` `--shadow-k:0.45` `--bevel-color:rgb(255 255 255 / 0.9)` `--sheen-a:0` `--glow-mix:35%` `--logo-ink:#110051` `--cv-lane-even:#FFFFFF` `--cv-lane-odd:#F6F5F7` `--cv-lane-selected:#F0E0FF` `--cv-playhead:#CC0FE0` `--cv-loop:#7E1BCC` |
| forest | `--accent-fill:#0BD90B` `--accent-text:#3DF23D` `--accent-gradient:linear-gradient(135deg,#3DF23D 0%,#13C65A 100%)` `--play-glow:#0BD90B` `--cv-lane-even:#06160B` `--cv-lane-odd:#031007` `--cv-lane-selected:#0E2D14` `--cv-playhead:#3EF56B` `--cv-loop:#0BD90B` |
| ocean | `--accent-fill:#0B76B8` `--accent-text:#58B9F4` `--accent-gradient:linear-gradient(135deg,#0B76B8 0%,#6A1FC0 100%)` `--play-glow:#1BA1F1` `--lit:#D63FE6` `--info:#1BA1F1` `--cv-lane-even:#161F36` `--cv-lane-odd:#12192C` `--cv-lane-selected:#213054` `--cv-playhead:#1BA1F1` `--cv-loop:#CC0FE0` |
| amethyst | `--accent-fill:#B80DCB` `--accent-text:#E68BF0` `--accent-gradient:linear-gradient(135deg,#C011D6 0%,#8A1FD6 55%,#5B23E1 100%)` `--play-glow:#7E1BCC` `--cv-lane-even:#1D122B` `--cv-lane-odd:#170E22` `--cv-lane-selected:#2A1A3E` `--cv-playhead:#00F5D4` `--cv-loop:#CC0FE0` |
| obsidian (kept for saved state; not in the select) | `--bg-header:#151A28` `--audius-gradient:linear-gradient(315deg,#06B6D4 0%,#8B5CF6 100%)` `--accent-fill:#7C4DEB` `--accent-text:#A78BFA` `--accent-gradient:linear-gradient(135deg,#7C4DEB 0%,#0E7490 100%)` `--play-glow:#8B5CF6` `--cv-lane-even:#101420` `--cv-lane-odd:#0D101A` `--cv-lane-selected:#171F32` `--cv-playhead:#22D3EE` `--cv-loop:#8B5CF6` |
| cyberpunk | `--bg-header:#160E2A` `--audius-gradient:linear-gradient(315deg,#7B2CBF 0%,#FF2A85 100%)` `--accent-fill:#D1126B` `--accent-text:#FF5CA1` `--accent-gradient:linear-gradient(135deg,#D1126B 0%,#7B2CBF 100%)` `--play-glow:#FF2A85` `--cv-lane-even:#110A20` `--cv-lane-odd:#0C0718` `--cv-lane-selected:#1E1038` `--cv-playhead:#00F0FF` `--cv-loop:#FF2A85` |
| platinum-slate | `--bg-header:#262D3B` `--accent-fill:#0B76B8` `--accent-text:#58B9F4` `--accent-gradient:linear-gradient(135deg,#0B76B8 0%,#7E1BCC 100%)` `--play-glow:#1BA1F1` `--info:#1BA1F1` `--cv-lane-even:#232936` `--cv-lane-odd:#1E2430` `--cv-lane-selected:#2B3345` `--cv-playhead:#1BA1F1` `--cv-loop:#C67CFF` |
| nordic | `--bg-header:#222630` `--audius-gradient:linear-gradient(315deg,#5E81AC 0%,#88C0D0 100%)` `--accent-fill:#88C0D0` `--accent-text:#88C0D0` `--accent-gradient:linear-gradient(135deg,#8FBCBB 0%,#81A1C1 100%)` `--play-glow:#88C0D0` `--lit:#B48EAD` `--danger-fill:#A8464F` `--danger-text:#E08A92` `--cv-lane-even:#1B1F28` `--cv-lane-odd:#171B23` `--cv-lane-selected:#232936` `--cv-playhead:#EBCB8B` `--cv-loop:#88C0D0` |

**Contrast, verified analytically for these values:**
- text-primary on surfaces 0–3: ≥ 9.8:1 in every theme.
- text-secondary on surfaces 1–3: ≥ 4.70:1.
- on-accent on accent-fill: ≥ 4.89:1. On every gradient stop: ≥ 4.66:1.
- accent-text on surfaces 1–3: ≥ 4.86:1.
- lit against surface-3: ≥ 3.39:1. Focus against surfaces: ≥ 9.8:1.
- danger-text on surfaces 1–3: ≥ 4.89:1. White on danger-fill: ≥ 5.03:1.
- lcd-text on surface-0: ≥ 4.70:1.
- on-state on mute: 6.71:1. On solo: 10.61:1.
- Daylight border-strong on surface-0: 3.61:1.

---

## 3. The system layer (`@layer system { … }`), normative CSS

Copy it exactly from `…/lead/proto/system-final.css`. The prototype version in that file is the one to ship. Its sections and decisions:

**S1. Base and browser surfaces**
- `html, body`: surface-0 background, text-primary, font-ui, size `--fs-label`, line-height `--lh-label`, letter-spacing `--track-ui`, `font-feature-settings:"kern" 1`, caret in accent. This replaces Inter's `cv02–cv11` settings.
- `:where(body *){font-size:var(--fs-label);letter-spacing:inherit}` is the universal 15px floor. It replaces every legacy font-size list.
- `:where(button,input,select,textarea,summary){font-family:inherit}`.
- `::selection` is accent at 38%.
- Scrollbars: `scrollbar-width:thin`, colour border-strong, and text-secondary while the container is hovered.
- `:focus-visible{outline:2px solid var(--focus);outline-offset:2px}`. Inputs use offset 1px. Dense rows (`.trk-btn`, `.cr-step`, `.fx-slot`, `.fl-folder-item`, `.asset-card`, `.matrix-pad`) use offset −2px.
- `option` uses the popover colours. Add `.visually-hidden`.

**S2. Type roles**
- **Title** (16/600/1.2, text-primary, no transform): `.title, .fl-win-title, .panel-header > span, .audius-panel-heading, #touch-counter-badge`. Title context (`.fl-win-title strong, #fx-track-name, .title-context`) is 15/500 text-secondary. Title-bar icons are 16px text-secondary.
- **Section** (15/700/1.2, uppercase, letter-spacing 0.08em, text-primary; icon 18px in accent-text): `.section-title, .trellis-title, .sub-header, .fx-rack-head, .tip-title, .cluster-label, .palette-lbl, .ctx-head > span:first-child, .track-column-top > span`.
- **Heading** (`.modal-head h3`): 20/600/1.25, −0.01em; icon 20px.
- **Body** (16/1.5): `.modal-body, .modal-hint, .inspector-empty`.
- **Labels** (500, text-secondary): `.field-row label, .field-box label, .slider-head label, .checkbox-label span, .fl-swing-wrap span, .zoom-control`. `.stamp-toggle` is text-primary/600; it is no longer blue link-like text.
- **Readouts:**
  - `.readout-main`: 600 22px/1 font-num, tabular-nums lining-nums, `--lcd-text`.
  - `.readout-sub`: 500 15px, text-secondary.
  - `#bpm-input`: 600 20px/1, `--lcd-text`.
  - `.bpm-decimals`: 500 15px, text-secondary, opacity 1.
  - Tabular font-num also on `.cursor-info, .mixer-db-lbl, .slider-head span, .cr-insert-box, .mixer-strip-num, .saved-proj-meta, .asset-meta`.
  - `.cursor-info, .status-pill, .asset-meta` are text-secondary/500. `.slider-head span` is text-primary/600.
- **Explicit weights.** Deleting the legacy weight overrides exposes old 700–900 base weights, so these must be set:
  - 600: `.track-title, .asset-name, .dropzone-title, .minimap-label, .cr-channel-btn, .mixer-strip-name, .mixer-strip-num, .project-name-input, .project-name-label, .matrix-pad-name, .tip-title`
  - 500: `.fl-folder-item, .status-pill, .dropzone-sub, .matrix-pad-meta`
  - `.fl-menu-item`: 600, text-secondary.
  - Weights allowed anywhere: 400, 500, 600, 700.
- **kbd:** 600 13px font-ui; text-secondary on `color-mix(text-primary 9%)`; hairline border, radius 4, padding 2px 5px.
- **Icons:** `stroke-width:2` (the mock-up's bold icons).
  - 18px in md controls: `.btn, .tool-btn, .mini-btn, .action-btn, .nudge-btn, .ctx-btn` and the toolbar summaries.
  - 16px in sm and xs controls: `.btn--sm, .btn--xs, .tiny-btn, .asset-actions button, .panel-close-btn, .icon-close, .bpm-step-btn, .reopen-pool-btn, .trk-btn`.
  - 20px in Play and the phone window switcher.

**S3. Bars, panes, title bars, racks, wells**
- **`.topbar`:** the brand stripe is a 2px gradient on top, painted as a background layer on the border-box over a surface-1 padding-box. Set `border-image:none; border-top:2px solid transparent; border-bottom:1px solid var(--border-subtle)` and a 1px shadow seam.
- **`.toolbar`:** surface-1 with a border-subtle bottom.
- **Workspace:** `.workspace, .playlist-center, .timeline-viewport` are surface-0.
- **Panes:** `.left-panel, .right-panel, .fl-subwindow, .trellis-dock, .mixer-window, .track-column, .fl-upper-dock, .mixer-fx-rack` are surface-1 with border colour `--border`. The 2px pane borders become 1px.
- **Title bars:** `.titlebar, .panel-header, .fl-window-header, .track-column-top, .minimap-bar, .modal-head` are surface-2 with a border-subtle bottom and `--bevel`.
- **Close button in title bars:** last, with `margin-inline-start:4px` and a 1px border-subtle divider (`::before`, inset-block 5px).
- **Rack:** `.rack, .transport-group, .audius-logo-lockup` are surface-2, hairline border, radius 12, `--bevel`, `--shadow-2`, `animation:none`. This removes the 7.2s border pulse and halo.
- **Logo:** `.audius-logo-lockup` and `.audius-horizontal-svg` use colour `--logo-ink`. `.audius-lockup-glyph` gets `animation:none`. Hover gets no lift and no magenta glow.
- **Wells:** `.lcd, .time-readout, .bpm-box, .osc-canvas` are surface-0, `border:0` (a well is a recess, not a nested card), radius `--r-ctl`, `box-shadow:var(--well)`.
- **`.lcd` primitive:** inline-flex, min-height `--ctl-h`, padding 0 8px. `.lcd__value` is 20px/600 tabular `--lcd-text` (`.lcd__value--lg` is 22px). `.lcd__unit` is text-secondary/500.
- **Box soup removed:** `.fl-hint-bar, .fl-pattern-selector, .palette-bar` lose their box (transparent background and border, no shadow).

**S4. Buttons: one family, mock-up language**
- **Secondary is the default skin** for `.btn, .tool-btn, .mini-btn, .tiny-btn, .action-btn, .transport-btn, .nudge-btn, .ctx-btn, .bpm-step-btn, .reopen-pool-btn, .asset-actions button, .custom-color-chip, .mobile-window-switcher button, .trk-btn`, the five toolbar summaries, and `.toolbar-select, .theme-select, .field-box select, .modal-body select` (selects keep their native chevron):
  - `--btn-bg:var(--surface-3)`
  - `background:linear-gradient(180deg, rgb(255 255 255 / var(--sheen-a)), transparent) var(--btn-bg)`
  - text-primary; `1px solid var(--hairline)`; radius `--r-ctl` (8px; `--r-ctl-sm` 6px for the sm/xs set)
  - `box-shadow:var(--bevel), var(--shadow-1)`; weight 600
  - transition: background-color, border-color, color and box-shadow over 120ms ease-out; transform over 80ms
- **Hover** (inside `@media (hover:hover)`, skipping `:disabled` and `[aria-disabled=true]`): `--btn-bg:var(--surface-hover)`, border hairline-strong.
- **Pressed:** `--btn-bg:var(--surface-press)`, `box-shadow: inset 0 1px 2px rgb(shadow/.45k)`, `translateY(1px)`. This replaces the legacy `scale(.96)`.
- **Disabled:** `:is(button,summary,select,input):is(:disabled,[aria-disabled="true"]){opacity:.45; box-shadow:none; cursor:not-allowed; transform:none}`. `[aria-busy=true]` gets `cursor:progress`.
- **Lit (selected/on):** `.btn[aria-pressed=true], .tool-btn.active, .mini-btn.toggle-pane.active, .transport-btn.active, .mobile-window-switcher button.active, .nudge-btn[aria-pressed=true]`:
  - `--btn-bg:var(--lit-bg)`, border `--lit`, text-primary
  - `box-shadow: var(--bevel), 0 0 0 1px var(--lit), 0 2px 12px -3px color-mix(in srgb, var(--lit) var(--glow-mix), transparent)`
  - hover: `--lit-bg-hover`; kbd inside becomes text-primary
- **Accent** (create actions: `.btn--accent, .tiny-btn.accent, .action-btn.accent, .accent-mini`): `--btn-bg: color-mix(accent 12%, surface-3)`, border `color-mix(accent 55%)`, text-primary, icon in accent-text. Hover: 20% mix and border accent.
- **Primary** (one per surface: `.btn--primary, .action-btn.success, .modal-foot .action-btn.accent`):
  - fill `--accent-fill` with a 12% white top sheen; border `color-mix(accent-fill 70%, #FFF)`
  - text `--on-accent`; `--bevel-strong` and `--shadow-1`
  - hover: same fill plus a 1px accent ring and `0 4px 12px -6px` accent-fill
  - pressed: `--accent-press`
  - This replaces the blue-to-magenta "success" gradient.
- **Ghost** (`.btn--ghost, .panel-close-btn, .icon-close`): transparent, text-secondary. Hover: surface-hover and text-primary. `.fl-menu-item` hover matches. Close is never red.
- **Destructive, raised** (`.btn--danger, .mini-btn.danger, .ctx-btn.danger-full, #btn-clear-pool`): secondary skin with the icon in `--danger-text`. On hover or focus-visible: `--btn-bg: color-mix(danger 16%, surface-3)`, border `color-mix(danger 55%)`, text danger-text. Pressed: 26%.
- **Destructive, quiet** (`.btn--danger-ghost, .trk-btn.del-trk, .asset-actions button.del-asset-btn, #btn-cr-clear, #btn-pr-clear`): transparent, text-secondary. On hover or focus-visible: danger-soft background, danger-text, border `color-mix(danger 45%)`.
- **Channel states:**
  - `.trk-btn.mute.on`: `--btn-bg:var(--state-mute)`, text `--on-state`, border `color-mix(mute 70%, #FFF)`.
  - `.trk-btn.solo.on`: the same with `--state-solo`.
- **Play** (`.transport-btn.play, .btn--play`):
  - background `--play-gradient`, text `--on-accent`, border `rgb(255 255 255/.22)`
  - `box-shadow: var(--bevel-strong), 0 4px 14px -5px color-mix(play-glow 80%)`
  - hover: `filter:brightness(1.08)`
  - `.playing` (and `.btn--play[aria-pressed=true]`): brightness 1.1 and saturate 1.1, plus `0 0 0 2px color-mix(play-glow 55%), 0 6px 18px -4px color-mix(play-glow 90%)`
- **Segmented** (`.segmented, .pat-song-stack` as the track):
  - track: surface-0, 1px border-subtle, radius `--r-ctl`, `--well`, padding 2px; `.segmented` is inline-flex with gap 2px
  - segments (`.segmented > button, .pat-song-btn`): transparent, text-secondary, 700, radius `calc(var(--r-ctl) - 3px)`; `.segmented > button` gets min-height `calc(var(--ctl-h) - 6px)` and padding 0 8px; hover: text-primary on `color-mix(surface-3 70%)`
  - active (`[aria-pressed=true]`, `.active`, `.pat-song-btn.active`): background `--accent-gradient`, text `--on-accent`, border `rgb(255 255 255/.18)`, `box-shadow: inset 0 1px 0 rgb(255 255 255/.22), 0 2px 10px -3px color-mix(accent var(--glow-mix))`
  - compact layout: track padding 0 and border-width 0, segments radius `--r-ctl`. The phone transport row has no spare pixels; the prototype pushed the meter summary off-screen at 360px until this was added.
- **Stepper** (`.stepper`, defined for the tool-bar pass): inline-grid of 2 rows, 22px wide; buttons transparent and text-secondary, hover surface-hover; icons 14px. On touch it becomes 2 columns of `--ctl-h` (44×44 each).
- **LCD contents:** `.bpm-box input, #bpm-input` are transparent with no border. `.bpm-box .bpm-step-btn` is ghost-in-well (transparent; hover surface-hover).
- **Swatches** (`.swatch-btn`) keep their preview colours: background `var(--sw-bg)`, colour `var(--sw-fg)`, border `color-mix(var(--sw-acc) 60%)`, radius `--r-ctl`, bevel, `--shadow-1`, no hover lift. `.active` gets the lit ring and glow.

**S5. Inputs, checkbox, switch, range**
- **Text and number wells** (`input[type=text|number|search], textarea, .project-name-input`, excluding `#bpm-input`): surface-0, 1px `--border`, radius `--r-ctl`, `inset 0 1px 2px` shadow. Hover and focus: border-strong. `:user-invalid`: border danger. Placeholder: text-secondary at 0.8.
- **Number spinners:** none. Use `appearance:textfield` and hide the webkit spin buttons. This ends the double spinners beside the tempo −/+.
- **Colour input:** hairline border, radius 4, swatch radius 3.
- **Checkbox:** `appearance:none`, `--check` square (18px; 22px on touch), surface-0, 1.5px border-strong, radius 5. `::after` is an `--on-accent` square masked by `--check-mask` (`calc(--check − 6px)`), scaled from 0 to 1 over 120ms. `:checked` fills with accent-fill. Hover: border text-secondary.
- **`.switch`** (for later passes): width `1.75×--check`, pill shape, knob translates.
- **Range** (`input[type=range]:not(.mixer-v-fader)`; vertical faders stay with the Mixer pass):
  - input: `appearance:none`, height `--range-h`, transparent, `--range-color:var(--accent)`
  - track: `--range-track` high, pill shaped; background layers are (1) the centre tick `var(--range-tick, 0px)` wide in border-strong, (2) the fill between `--fill-from` and `--fill-to` in `--range-color`, (3) surface-0; inset 1px border-subtle ring
  - thumb: `--thumb` circle, `--range-thumb` fill, 2px `--range-color` border, `--shadow-1`
  - `[data-bipolar]`: `--range-tick:2px`. `[data-fill=none]`: `--range-color:text-secondary`
  - hover: `0 0 0 4px` ring at 25% (6px while active)
  - focus-visible: no outline; thumb gets `0 0 0 2px surface-0, 0 0 0 4px var(--focus)`, which no longer bleeds over the "Pan" label
  - include the `::-moz-range-*` equivalents

**S6. Popovers, dialogs, lists, tooltip, toast**
- **Popovers** (`.popover, .topbar-menu-popover, .toolbar-overflow-content, .clip-context-menu`, plus on compact only `.toolbar-primary-content, .transport-extras-content, .transport-readouts-content`): surface-popover, hairline-strong border, radius 12, `--bevel` and `--shadow-3`.
- **`.modal-backdrop`:** `color-mix(surface-0 76%, transparent)`, no blur.
- **`.modal-card`:** surface-1, hairline-strong, radius 16, `--shadow-3`. `.modal-foot` is surface-1 with a border-subtle top. `.export-status` is text-secondary.
- **`.saved-proj-row`:** surface-2, hairline, radius 8, bevel; hover surface-hover.
- **`.asset-card`:** surface-2, border-subtle, radius 8, bevel; hover border-strong.
  - `.selected-stem`: select-bg, border lit, plus a 1px lit ring. This fixes the daylight 1.17:1 bug.
- **`.fl-folder-item`:** text-secondary with a border-subtle bottom; hover surface-hover. `.active` is select-bg, text-primary, `border-left:0`, and an inset 1px `color-mix(lit 55%)` ring. No side-tab.
- **`.dropzone-box`:** 1.5px dashed border-strong on `color-mix(surface-0 60%)`, radius 8. Hover and dragover: accent border on 8% accent.
- **Rows:** `.track-header-item` border-subtle; `.selected` select-bg. `.panel-footer-tips` surface-1, text-secondary.
- **Selected rows:** `.cr-row.active-channel, .mixer-strip.selected, .fx-slot.active` get a lit border and inset ring, with no glow. A row selection is an edge; only controls glow. `.fx-slot` is surface-0 with border-subtle.
- **`.tooltip`:** fixed position, z-index 300, max-width `min(320px, 100vw − 16px)`, padding 6px 10px, surface-popover, hairline-strong, radius 6, `--shadow-2`, 500/1.35, `pointer-events:none`, entrance `ds-tip-in` 120ms. Hidden on `(pointer:coarse),(hover:none)`.
- **`.toast`:** `display:none` except on compact layouts. There it is fixed, z-index 250, `inset-inline:8px`, `bottom: calc(52px + env(safe-area-inset-bottom))`, max-width 480px centred, flex, min-height 44px, padding 10px 14px, popover skin, radius 12, `--shadow-3`, 500, `pointer-events:none`, entrance `ds-toast-in` 180ms. `[data-kind=error]`: danger-tinted border and an 8px danger dot.

**S7. Meters, LEDs, steps, pads**
- **Meter troughs** (`.meter-bar, .track-meter-mini, .mixer-v-meter`): meter-trough, border-subtle, `--well`.
- **Meter fills:** `linear-gradient(90deg | 0deg, ok 0%, ok 62%, warn 82%, clip 100%)`, `transition:none`. This removes the layout transitions.
- **LEDs:** off is surface-0 with a `--border` ring. On is `--led-on`, border `color-mix(led 60%, #FFF)`, `box-shadow: 0 1px 6px -1px color-mix(led 80%)`. The glow is offset, not a zero-offset halo.
- **`.cr-step.active`:** a gradient derived from `--accent`: `color-mix(accent 55%, #FFF)` to accent to `color-mix(accent 62%, #000)`. Border `color-mix(accent 40%, #FFF)`, shadow `0 1px 8px -2px`. `.cr-step.playing-step` gets a 2px outline in `--info`.
- **`.matrix-pad`** (pad primitive):
  - rest: surface-2, `1.5px solid var(--pad-color, var(--border))`, radius `--r-ctl`, bevel and `--shadow-1`
  - `.triggered`: border `color-mix(pad-color 55%, #FFF)`; `box-shadow: bevel, 0 0 0 1px pad-color, 0 2px 14px -2px color-mix(pad-color 75%)`; `scale(.97)`
  - No other content treatment exists, because pads are pads.

**S8. Wallpaper** (fixes the dead `.app-shell` selector)
- `body[data-wallpaper]:not([data-wallpaper="none"]) #app-shell { background: var(--surface-0) var(--audius-wallpaper-url) center / cover no-repeat; }`
- With a wallpaper, `.workspace, .playlist-center, .playlist-body, .timeline-viewport` become transparent.
- Panes stay solid surface-1: no glass, no backdrop blur. The wallpaper shows only through the arrangement canvas, under the 88% `--cv-veil`. The prototype confirmed this reads as an ambient backdrop, not a distraction.

**S9. Motion**
- Keyframes: `ds-pop-in` (opacity plus `translateY(-4px) scale(.98)`), `ds-sheet-in` (`translateY(14px)`), `ds-tip-in` (2px), `ds-toast-in` (8px), `ds-fade-in` (opacity only).
- Desktop popovers and the context menu use `ds-pop-in` over 180ms ease-out, origin top right. Compact sheets use `ds-sheet-in` over 240ms.
- **`prefers-reduced-motion: reduce`:** keep feedback, drop movement.
  - `scroll-behavior:auto`
  - button and summary `:active` get `transform:none`; `.matrix-pad.triggered` gets `transform:none`
  - checkbox tick becomes an opacity fade
  - every popover, sheet, tooltip and toast uses `ds-fade-in` over 120ms linear
  - colour transitions stay
- The existing wordmark crossfade and the beat-pulse colour fallback in app.js remain.

---

## 4. Legacy layer edits (inside `@layer legacy`)

### Deletions (D)
Line numbers refer to the current `styles.css`.

- **D1 Typography.**
  - Delete every `font-size` declaration in the legacy layer (all 137, normal and `!important`).
  - Delete every `font-weight` declaration that has `!important` or the value 800 or 900, and every `letter-spacing` declaration.
  - Delete `font-feature-settings` and every `font-family: var(--font-mono)`.
  - Whole blocks to remove:
    - the readability block at 3714–3746;
    - the 15px lists at 4065–4106 and 4843–4860, and 4686;
    - the typography declarations of the "MANUS AI TYPOGRAPHY SCALE OVERRIDES" block (2176–2449). Keep only its panel, window and row geometry: `.topbar` min-height and padding, `.toolbar`, `.left-panel` width, `.fl-upper-dock`, `.cr-row`, `.cr-insert-box` width, `.cr-channel-btn` width and height, `.minimap-bar`, `.minimap-label`/`.track-column` widths, `.track-title` max-width, `.mixer-window`, `.mixer-strip`, `.mixer-strip-name` max-width, `.mixer-fx-rack`, `.fx-slot` padding, `.playlist-bottombar` height, `.panel-header/.fl-window-header/.track-column-top` height and min-height.
- **D2.** Delete the brand `!important` block at 2658–2703: `.action-btn.accent, .tool-btn.active, .tiny-btn.accent, .transport-btn.play.playing`, `.action-btn.success`, `.cr-step.active`, `.cr-step.playing-step`, `.cr-led.on, .fx-led.on`, `#btn-mode-song.active`, `#btn-mode-pat.active`. Also delete the earlier `#btn-mode-pat.active` and `#btn-mode-song.active` at 1719–1731.
- **D3.** Delete the wallpaper rules at 2753–2782: the dead `.app-shell` selector, the transparent `!important` list naming non-existent classes, and the purple glass plus blur on side panels.
- **D4.** Delete the blanket reduced-motion rule at 3702–3711 (0.01ms everything) and the reduced-motion block at 4532–4555.
- **D5.** Delete `.accent-mini` at 1759–1763 and `.matrix-pad.triggered` at 1374–1378.
- **D6.** Delete `.bpm-box input:focus{outline:none}` (526–528) and the `outline:none` in `.project-name-input:hover,:focus` (336–342; drop the whole rule).
- **D7 Logo.**
  - Delete the `animation:` declarations on `.audius-logo-lockup` and `.audius-lockup-glyph`, and the `@keyframes audiusGlyphPulse` and `@keyframes audiusLockupBorderPulse`.
  - Delete `.audius-logo-lockup:hover` and the daylight lockup and wordmark colour rules (2609–2618; keep the `display` swaps for the colour glyph image).
  - In `.wm-audius-char` and `.wm-studio-char`, replace `cubic-bezier(0.34, 1.4, 0.64, 1)` with `var(--ease-out)`. This removes the bounce easing and keeps the AUDIUS/STUDIO alternation.
- **D8.** Delete `.topbar { border-image…; box-shadow… }` (2454–2458).
- **D9 Skin now owned by the system.** Delete the background, colour, border, border-colour, border-radius, box-shadow, outline, filter and transition declarations from the legacy rules for:
  - controls: `.tool-btn, .mini-btn, .tiny-btn, .action-btn, .transport-btn, .nudge-btn, .ctx-btn, .bpm-step-btn, .reopen-pool-btn, .asset-actions button, .del-asset-btn, .trk-btn, .panel-close-btn, .icon-close, .swatch-btn, .custom-color-chip`, the five summaries, `.toolbar-select, .theme-select`, the field inputs and selects, `.pat-song-btn, .pat-song-stack, .mobile-window-switcher button`
  - containers and readouts: `.transport-group, .time-readout, .bpm-box, .osc-canvas, .palette-bar, .fl-hint-bar, .fl-pattern-selector`, the title bars, `.topbar-menu-popover, .toolbar-overflow-content`, the compact sheets, `.clip-context-menu, .ctx-head`, `.modal-*`
  - lists and cards: `.asset-card` (including the 4px coloured `border-left` and its 4251 patch), `.fl-folder-item` (including the 3px `border-left`), `.dropzone-box, .saved-proj-row`
  - meters, LEDs and pads: `.meter-*, .track-meter-*, .mixer-v-meter*, .cr-led, .fx-led, .matrix-pad`
  - the global motion block at 4470–4530 (button transitions and `scale(.96)`)
  - `.swatch-btn:hover{transform}`
  - **Must delete:** every literal colour in these rules. **Should delete:** declarations that only use variables (they are dead code now).
- **D10.** Delete the undefined `var(--bg-control-hover)` uses, `.fl-win-badge` rules (the element is removed), the legacy `kbd` rules, `.icon` `stroke-width`, and the legacy `:focus-visible`, `::selection` and scrollbar rules at 4273–4297. Keep the `color-scheme` rules.

### Geometry edits (G)
Swap literal heights for size tokens. Desktop values stay what they are today except where noted.

- **G1.** `.tool-btn, .mini-btn` (721): `height: var(--ctl-h); padding: 0 10px`.
- **G2.** `.toolbar-select` (739): `height: var(--ctl-h); padding: 0 8px`.
- **G3.** `.action-btn` (583): `height: var(--ctl-h); padding: 0 12px`. `.theme-select` (618): `height: var(--ctl-h); padding: 0 10px`. This is 36px → 34px.
- **G4.** `.transport-btn` (432): `width/height: var(--ctl-h)` (32px → 34px). Add `.transport-btn.play { width: var(--ctl-h-lg); height: var(--ctl-h-lg); }`. In the compact rule at 3191, change the selector to `.transport-btn, .transport-btn.play` (keeps 40px; the touch list still makes it 44px).
- **G5.** `.bpm-step-btn` (501): both dimensions `var(--ctl-h-sm)`. `.panel-close-btn` (791): both `var(--ctl-h-sm)` (22px → 26px). `.icon-close`: `width/height: var(--ctl-h-sm); padding:0; display:inline-flex; align-items:center; justify-content:center`.
- **G6.** `.tiny-btn` (810): `height: var(--ctl-h-sm); padding: 0 8px`.
- **G7.** `.asset-actions button` (931): `min-height: var(--ctl-h-sm); padding: 0 8px; display:inline-flex; align-items:center; justify-content:center; gap:4px`. `.reopen-pool-btn` (1018): `height: var(--ctl-h-sm); padding: 0 8px; display:inline-flex; align-items:center; gap:4px`.
- **G8.** `.ctx-btn` (1061): `height: var(--ctl-h); padding: 0 10px`. `.nudge-btn` (1338): `height: var(--ctl-h); padding: 0 10px`.
- **G9.** `.trk-btn` (1187): both `var(--ctl-h-xs)`. Delete the 24px `!important` triple from the D1 block; the compact and touch `!important` sizes stay.
- **G10.** Field inputs and selects (1470): `height: var(--ctl-h)`. `.swatch-btn` and `.custom-color-chip`: `height: var(--ctl-h); padding: 0 10px`.
- **G11.** Summaries (2885): `min-height: var(--ctl-h)` (desktop More and Options become 34px, matching the tool row). Line 4431: `min-width: var(--ctl-h)`. `.file-actions .project-name-input` (3892): `min-height: var(--ctl-h)`. The compact 44px rules stay.
- **G12 Title-bar insets** (fixes the cramped-padding findings): `.panel-header` (770), `.fl-window-header` (1834) and `.track-column-top` (1116) get `padding: 4px 6px 4px 10px`. The library header keeps its own grid padding.
- **G13 Responsive defect fix.** At 901–1200px the tool cluster cannot shrink and overlaps the More button; the baseline shows `tool-btn ~ summary` at 901×700. Add `.toolbar-primary-menu { flex: 1 1 auto; }` and `@media (max-width: 1200px) { .toolbar-primary-content > .tool-cluster { flex-wrap: wrap; flex-shrink: 1; min-width: 0; } }`.
- **G14.** Delete the legacy range sizing and accent-color rules: `.master-box input[type=range]` (keep `width`), `.zoom-control input` (keep `width`), `.track-row-Sliders input[type=range]{height;accent-color}`, `.scroll-wrap input{accent-color}`, `.slider-group input[type=range]{accent-color}`, and the touch `input[type="range"]{min-height:44px}`. Also delete the touch checkbox 22px rule at 4885–4888; `--check` handles it.

**Targets after the pass:**
- `grep -c '!important' styles.css` ≤ 190 (from 301).
- Zero `!important` on font-size, font-weight, letter-spacing, color, background, border-color, box-shadow or outline.

---

## 5. index.html edits

1. **Window and section titles** (title-bar primitive; Title Case source, CSS uppercases section titles; "·" separators):
   - Library heading: replace the `TokenAUDIO.png` image and `AUDIUS LIBRARY` with `<svg class="icon" aria-hidden="true"><use href="#i-library"/></svg>Library`.
   - Step Rack: remove `<span class="fl-win-badge">All…</span>`. Change the title to `Step Rack · <strong id="cr-pattern-label">`.
   - Piano Roll: `Piano Roll · <strong id="pr-channel-label">`.
   - Mixer: remove the `Wide` badge. Change the title to `Mixer · <strong id="mixer-selected-label">`.
   - `#touch-counter-badge`: text `Playlist`; aria-label and title `Playlist`.
   - `<span>TRACKS</span>` → `<span>Tracks</span>`.
   - `CLIP / SEGMENT INSPECTOR` → `Clip Inspector`. `SELECTED TRACK CHANNEL & EQ` → `Track EQ`. `QUICK SLICE / REARRANGEMENT` → `Quick Slice`.
   - `QUICK NUDGE & TRIM` → `Nudge & Trim`. `TRELLIS MULTI-TOUCH SLICE PADS` → `Slice Pads`.
   - `AUDIUS FX CHAIN — <span id="fx-track-name">` → `FX Chain · <span id="fx-track-name">`.
   - `Audius Studio Workflow` → `Workflow`.
   - Dialog titles: `Export`, `Open Project`, `Keyboard Shortcuts`.
   - Keep every id.
2. **Glyphs to icons.** Replace each `＋` (U+FF0B) and text `+` prefix with `<svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>`:
   - Upload Stems
   - the drop-zone title ("Upload or Drop Audio Stems")
   - Add Track
   - To Playlist, Render Clip and Paint Pat (the labels lose the "+")
3. **Initial pressed state.** Add `aria-pressed`:
   - tool buttons: Draw `true`, the others `false`
   - `#btn-loop` `true`; `#btn-metro` and `#btn-typing-piano` `false`
   - window toggles: `#btn-toggle-pool` `true`, the others `false`
   - `#btn-mode-pat` `false`, `#btn-mode-song` `true`
4. **Tempo field.** `#bpm-input` gets `aria-label="Tempo (BPM)"`.
5. **Range metadata:**
   - `#master-vol`: `data-label="Master volume" data-format="db"`
   - `#zoom-slider`: `data-label="Zoom"`
   - `#cr-swing`: `data-label="Swing" data-unit="%"`
   - `#hscroll-slider`: `data-fill="none" data-no-reset data-silent`
   - `#insp-gain`: `data-label="Segment gain" data-format="db" data-bipolar`
   - `#insp-pitch`: `data-label="Pitch" data-format="st" data-bipolar`
   - `#insp-pan`: `data-label="Clip pan" data-format="pan" data-bipolar`
   - `#trk-eq-low`, `#trk-eq-mid`, `#trk-eq-high`: `data-label="Low shelf" / "Mid peak" / "High shelf" data-format="db" data-bipolar`
6. **Shortcuts dialog body.** Remove `font-size:12px; line-height:1.55` from the inline style and keep `max-height:74vh; overflow-y:auto`. Replace each `<strong style="color:var(--accent-teal)">` with `<strong class="section-title">`.
7. **Status elements.** After `#app-shell`, before the modals, add `<div id="status-live" class="visually-hidden" role="status" aria-live="polite"></div>` and `<div id="status-toast" class="toast" aria-hidden="true" hidden></div>`.
8. **Do not change** script and link URLs, ids, sprite symbols (no new icons are needed) or the default collapsed classes.

---

## 6. app.js edits
Use small, named helpers. Never put project or user data through innerHTML.

1. **Canvas reads theme tokens.**
   - Add `CANVAS_TOKENS = { canvasBg:"--cv-bg", laneEven:"--cv-lane-even", laneOdd:"--cv-lane-odd", laneSelected:"--cv-lane-selected", laneBorder:"--cv-lane-border", rulerBg:"--cv-ruler-bg", rulerBorder:"--cv-ruler-border", rulerText:"--cv-ruler-text", rulerTextDim:"--cv-ruler-text-dim", tickBar:"--cv-tick-bar", tickBeat:"--cv-tick-beat", gridBar:"--cv-grid-bar", gridBeat:"--cv-grid-beat", gridSub:"--cv-grid-sub", playhead:"--cv-playhead", loopColor:"--cv-loop", loopShade:"--cv-loop-shade", marquee:"--cv-marquee", veil:"--cv-veil", wpLaneEven:"--cv-wp-lane-even", wpLaneOdd:"--cv-wp-lane-odd", wpLaneSelected:"--cv-wp-lane-selected", oscBg:"--cv-osc-bg", oscLine:"--cv-osc-line" }`.
   - Add `function syncCanvasTheme(){ const cs=getComputedStyle(document.body); const t=getActiveTheme(); for (const [k,p] of Object.entries(CANVAS_TOKENS)){ const v=cs.getPropertyValue(p).trim(); if (v) t[k]=v; } }`.
   - Call it in `applyTheme` right after `document.body.removeAttribute("style")`. Add the current literals as fallback fields in each `THEMES` entry, so the canvas never breaks.
   - Replace the literals in `drawPlaylist`:
     - 1725: the veil becomes `theme.veil`; drop `isLightWallpaper`.
     - 1737–1740: `wpLaneEven`, `wpLaneOdd`, `wpLaneSelected`.
     - 1763 `gridSub`; 1780 `gridBar`/`gridBeat`; 1793 `loopShade`; 1984–1986 marquee via `hexToRgba(theme.marquee,.15)` and `theme.marquee`; 2013/2032 `rulerText`; 2019 `tickBar`/`tickBeat`; 2030 `rulerTextDim`.
   - In `drawOscilloscope`: background (4910) `theme.oscBg`; the line is `theme.oscLine` while playing and `hexToRgba(theme.oscLine,.45)` when idle.
   - Clip internals and ruler fonts belong to the Playlist pass.
2. **`hexToRgba` accepts non-hex.** If the input does not match `/^#?[0-9a-f]{3,8}$/i`, return `color-mix(in srgb, ${c} ${Math.round(alpha*100)}%, transparent)`.
3. **Keyboard.** Add `isTextEntry(el)`: true for contenteditable, TEXTAREA, and INPUT of type text, number, search, url, email, password or tel. At the top of the global keydown handler (4628):
   - **Text entry:**
     - Enter on an INPUT: `preventDefault`, blur (this commits through `change`), return.
     - Escape: restore `el.dataset.revertValue` if set, dispatch `input` and `change`, blur, then continue so modals and menus close.
     - Any key other than F1–F12: return. Typing and Ctrl+Z stay native.
   - **SELECT:** return for Space, Enter, the arrows, Home, End, PageUp and PageDown.
   - **Range:** for those same navigation keys, return. Shift+Arrow does `stepUp` or `stepDown` by 10, then sync the fill and dispatch `input` and `change`.
   - Everything else (Space, F-keys, Escape, Ctrl combos) runs as today, whatever has focus.
   - Store the revert value: `document.addEventListener("focusin", e => { if (isTextEntry(e.target)) e.target.dataset.revertValue = e.target.value; })`.
   - Selects blur after a change made with the pointer. Track `lastInputWasPointer` (true on pointerdown, false on keydown, both in the capture phase). On `change` of a SELECT, blur if `lastInputWasPointer`.
4. **Status, hint, live region and toast.**
   - Module state: `statusText`, `statusPinnedUntil`, `firstInteractionDone`.
   - `setStatus(msg, {kind="info"} = {})`:
     - stores `statusText`; pins for 3s (6s for errors, 1.5s for `kind:"value"`);
     - renders the line (the existing crossfade body moves into `renderStatusLine(text, kind)`, which sets `data-kind`);
     - writes `#status-live` throttled to one update per 400ms, trailing;
     - on the compact query (a module-level `matchMedia("(max-width: 760px), (max-width: 900px) and (max-height: 520px)")`), after the first pointerdown or keydown: sets `#status-toast` textContent and `data-kind`, unhides it, and hides it again after 4s (errors 6s). An update while it is visible restarts the timer without replaying the entrance.
   - `setHint(text)` renders only when the pin has expired. `clearHint()` re-renders `statusText`.
   - Replace the document `mouseover` handler (4216–4221) with:
     - `pointerover` (mouse and pen only) on `closest("[data-tip],[title]")`: `setHint(el.dataset.tip || el.title)`;
     - `pointerout`: `clearHint()`;
     - `focusin` when `:focus-visible` matches: `setHint`; `focusout`: `clearHint`.
5. **Lit state API.** Add `setLit(el, on){ if(!el) return; el.classList.toggle("active", !!on); el.setAttribute("aria-pressed", String(!!on)); }`. Use it at:
   - 623 (theme swatches)
   - 869–870 (loop, metro)
   - 3938–3943 (window toggles)
   - 4138–4145 (PAT, SONG)
   - 4607 (typing piano)
   - 4898 (tools)

   **Track header buttons:**
   - Mute and solo buttons (1178, 1189) get `aria-pressed`, `aria-label` and a state title: "Mute track" / "Unmute track", "Solo track" / "Unsolo track".
   - The track delete button (1199–1201) becomes `btnDel.innerHTML = icon("trash-2", { solo: true })` (static markup). It gets `title = "Delete track"` and `aria-label = \`Delete ${track.name}\``. Remove the "×" text.
6. **Range behaviour.**
   - `syncRangeFill(el)`: skip when `data-fill=none`. `origin` is 0 for unipolar sliders and the position of 0 for `[data-bipolar]`. Set `--fill-from:min(pct,origin)%` and `--fill-to:max(pct,origin)%`.
   - `setRange(el,v)` sets the value, then calls `syncRangeFill`. Use it instead of `.value=` at 868, 1232, 1247, 1646, 1648, 1650, 1667, 1669, 1671, 2707, 3181, 3183, 3271, 3443, 3448, 3496, 4689, 4858 and 4865.
   - In `renderTrackHeaders`:
     - Volume: `data-label="Volume" data-format="db" data-default="0"`.
     - Pan: `data-label="Pan" data-format="pan" data-bipolar data-default="0"`.
     - Drop the dynamic `title` updates (1233, 1236, 1248). Set `aria-label` to `Volume, ${track.name}` and `Pan, ${track.name}`.
   - On load, sync every range.
   - **Delegated `input` listener (capture):** `syncRangeFill`, set `aria-valuetext`, and unless `data-silent` is present call `setStatus(\`${label} ${format(v)}\`, {kind:"value"})`. Formats:
     - db: `±0.0 dB`
     - pan: `C`, or `NN% L` / `NN% R`
     - st: `±N st`
     - otherwise: value plus `data-unit`
   - **Delegated `dblclick`, or Ctrl/Cmd+pointerdown with a mouse:** reset to `data-default`, else the `value` attribute, unless `data-no-reset`. Then dispatch `input` and `change`.
   - **`wheel` (`passive:false`):** only when the range is `document.activeElement`. Step ±1 (±10 with Shift), `preventDefault`, dispatch events. An unfocused slider never captures the wheel.
7. **Disabled sync.** `syncCommandAvailability()` sets `aria-disabled`:
   - Undo and Redo follow the stack lengths.
   - Cut Half, Chop 1-Beat, Chop 1-Bar, Auto-Slice, Duplicate, Reverse and Delete Clip follow `ui.selectedClipIds.size>0`.
   - Split @ Playhead and Clear Playlist follow `project.clips.length>0`.

   Call it from `updateClipInspector()`, `pushUndoState()`, `undo()` and `redo()`. Click handlers stay; their existing status messages explain why nothing happened.
8. **Undoable deletes.**
   - `snapshot = () => ({ project: cloneProjectState(project), assets: new Map(assets) })` (AudioBuffers are shared by reference).
   - `restoreSnapshot(s)` assigns the project, clears and refills `assets`, and calls `renderAssetPool()`.
   - `pushUndoState`, `undo` and `redo` use snapshots.
   - Result: Library Clear, stem delete and track delete all become reversible with Ctrl+Z.
9. **Long-press never deletes.** Track the last touch `pointerdown` time. In the three `contextmenu` handlers (2251, 2496, 2841): if `e.pointerType==="touch"` or a touch went down within 800ms, `preventDefault()` and return. Mouse right-click keeps its one-click delete.
10. **Tooltips (mouse, pen and keyboard focus; never touch).**
   - One `.tooltip` element (`id="app-tooltip"`, `role="tooltip"`), created lazily. Its content is set with `textContent` only.
   - **Show:**
     - on `pointerover` (pointerType not touch) of `closest("[title],[data-tip]")`, after a 450ms delay, or immediately if a tooltip hid less than 300ms earlier;
     - on `focusin` when `:focus-visible` matches.
     - While shown, move `title` into `data-tip` (this suppresses the native tooltip) and set `aria-describedby="app-tooltip"`. Hiding restores the title.
   - **Position:** fixed, through `style.left` and `style.top`. Place it 8px below the element and centred; flip above if there is no room; clamp to 8px from the viewport edges.
   - **Hide:** on pointerout, pointerdown, Escape, scroll (capture), blur, or when the target is no longer connected.
   - The hint line reads `dataset.tip || title`.
11. **Copy.**
   - 3112 → `` `Cloned ${n} clip(s)` ``.
   - 3439 → `` `Track height: ${h}px` ``. Never "FL".
   - `updateTouchBadge` → `"Playlist"`, or `` `Multi-touch · ${n} fingers` ``.
12. **Empty states.**
   - Library empty (987): `empty.className = "empty-state"`. Remove the inline style.
   - Saved projects loading (3795): build the element with `className="empty-state"` and `textContent`, not an innerHTML string.
13. **Custom accent picker** (3905): also `setProperty` `--accent-fill`, `--accent-text`, `--accent-gradient` and `--play-gradient`. Both gradients are `linear-gradient(135deg, ${col} 0%, color-mix(in srgb, ${col} 55%, #000) 100%)`.
14. **Pads** (907): replace `pad.style.borderColor = def.color` with `pad.style.setProperty("--pad-color", def.color)`. The name-colour styling stays for the Trellis pass.
15. **No other app.js changes.** `pulseBeat` keeps reading `--accent-orange`, which still holds the accent.

---

## 7. Behaviour per breakpoint
Tokens drive density. The layout itself is unchanged.

- **Desktop ≥ 1280px (fine pointer):**
  - Controls: md 34px (radius 8), sm 26px (radius 6), xs 24px (track M/S/delete), Play 40×40.
  - Title bars 34px with 4px insets. Range input 24px, track 4px, thumb 14px. Checkbox 18px.
  - Hover styles active; tooltips on. Topbar is one row: brand rack, transport rack, Options.
- **Small desktop 900–1279px:**
  - Same tokens. The topbar goes to two rows at ≤ 1200px (existing).
  - G13 makes the tool cluster wrap inside its menu, so More never overlaps a tool (verify at 901×700, 1024×768, 1100×800, 1201×800).
  - Readouts at 22px and 20px fit; the prototype showed no overflow at 1201px.
- **Tablet touch** (`(pointer:coarse),(hover:none)`; 1024×1366t, 1366×1024t):
  - Every control is 44px with radius 12 (sm 10). Range input 44px, track 6px, thumb 22px. Checkbox 22px.
  - Title bars ≥ 48px (existing). Stepper is two 44×44 buttons side by side.
  - No hover styles, no tooltips, kbd hidden (existing).
- **Phone portrait 360×640:**
  - Compact layout (existing structure), with the touch tokens above.
  - Segmented PAT/SONG has no track padding or border, so the transport row keeps its current width. The phone tabs use the lit edge.
  - Status toast sits 52px above the bottom: it never covers the playlist bottom bar, ignores pointer events and auto-dismisses.
  - Sheets use popover skin, radius 12.
- **Phone landscape 640×360:** same as portrait. The toast stays inside the viewport.
- **320px (e.g. 320×568t):** the transport wraps (existing ≤ 340px rule). The toast is `calc(100vw − 16px)` wide. No horizontal scroll.
- **3840px:** fixed px scale (product UI). Nothing scales fluidly.

---

## 8. Visual vocabulary at a glance

| Job | Look | Tokens |
|---|---|---|
| Rest control | raised, a step lighter than its panel, hairline border, top highlight, soft shadow | surface-3, hairline, bevel, shadow-1 |
| Hover | one surface step up | surface-hover, hairline-strong |
| Pressed | darker, inset shadow, 1px down | surface-press |
| Selected/on (toggles, selected tool, window tab, theme swatch) | cyan-blue lit edge, soft offset glow, tinted fill | lit, lit-bg, glow-mix |
| Selected row or list item | select-bg plus a 1px lit edge, no glow | select-bg, lit |
| One-of-many in a shared track (PAT/SONG; later the tools) | magenta-to-violet gradient segment with glow on a dark inset track | accent-gradient, well |
| Create action | accent-tinted border and fill, accent icon | accent |
| Commit action (one per surface) | solid accent fill, white text | accent-fill, on-accent |
| Play | larger violet gradient with outer glow; brighter while playing | play-gradient, play-glow |
| Close | neutral ghost × | text-secondary → surface-hover |
| Delete | trash icon; quiet in rows; red on hover/focus | danger-text, danger-soft |
| Mute / solo | amber / yellow fill, dark text | state-mute, state-solo, on-state |
| Time (playhead, position, tempo) | Audius blue, tabular figures, in wells | info, lcd-text |
| Focus | 2px ring in the text colour, never the lit or selection colour | focus |
| Disabled | 45% opacity, flat, not-allowed cursor | — |

**Motion:**

| Motion | Duration and easing |
|---|---|
| Hover and colour | 120ms ease-out |
| Press | 80ms |
| Popovers | 180ms pop-in |
| Sheets | 240ms slide-in |
| Tooltips | 120ms |
| Toast | 180ms |

Reduced motion turns every entrance into a 120ms opacity fade and removes press translate and pad scale. Colour feedback, the wordmark crossfade and the beat-pulse colour remain.

---

## 9. DESIGN.md and sidecar
These are the deliverables later passes follow. Write them in the impeccable `reference/document.md` format; no DESIGN.md exists yet.

### `/home/user/DAW/DESIGN.md`

**YAML frontmatter.** Only the Stitch keys are allowed.
- `name: Audius Studio`
- `description: "Unofficial, community-built browser DAW for the Audius community: the Elevated Audius studio system."`
- **colors** (audius-dark canonical values): `surface-0 #1B1C2A`, `surface-1 #242538`, `surface-2 #2A2E43`, `surface-3 #353A51`, `surface-popover #2F3348`, `surface-hover #444B69`, `select-bg #392B56`, `border #3C425D`, `text-primary #F6F8FC`, `text-secondary #A6AAC0`, `on-accent #FFFFFF`, `accent #CC0FE0`, `accent-fill #B80DCB`, `accent-text #E28BEA`, `accent-violet #5B23E1`, `lit #1BA1F1`, `info #1BA1F1`, `state-play #15D864`, `state-mute #F08A24`, `state-solo #F5C842`, `on-state #1B1C2A`, `danger #F9344C`, `danger-fill #D81F38`, `danger-text #FF8A97`.
- **typography:** label, body, title, section, heading, button, readout-lg, readout-md, kbd. All use `fontFamily "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"`, with sizes, weights, line-heights and letterSpacing as in section 2. Readouts carry `fontFeature: "tnum"`.
- **rounded:** xs 4px, sm 6px, md 8px, lg 12px, xl 16px.
- **spacing:** 2xs 2px, xs 4px, sm 6px, md 8px, lg 12px, xl 16px, 2xl 24px.
- **components** (only the 8 allowed props): `button-secondary` (+`-hover`, `-pressed`), `button-lit`, `button-accent`, `button-primary`, `button-ghost`, `button-danger`, `button-play`, `segment`, `segment-active`, `input-well`, `lcd`, `title-bar`, `rack`, `popover`, `tooltip`, `toast`, `pad`, `pad-triggered`, `checkbox-checked`. Each references `{colors.*}` and `{rounded.*}` and gives height and padding: 34px / 0 10px (md), 26px (sm), 40px (Play), 44px on touch noted in prose.

**Body.** The 8 canonical H2 sections, in order:
1. **Overview.**
   - Creative North Star: **"The Lit Rack"**. Raised navy racks of tactile buttons on a deep Audius night, where only the things that are on, playing or selected light up.
   - Mode: Operate. Keep the unofficial positioning line.
   - Key Characteristics: four-surface depth; the owner's button language; lit states only; tabular Audius-blue readouts; one family (Avenir Next).
2. **Colors.**
   - Primary, Neutral and state groups with descriptive names, e.g. "Audius Magenta" (#CC0FE0), "Signal Blue" (#1BA1F1), "Deep Space" (#1B1C2A).
   - A per-theme contract table: every role, for every theme, as in section 2.2.
   - Named rules:
     - **The One Job Rule:** each colour has one job. Accent means brand, create and value fill. Lit blue means selected/on. Info blue means time. State colours mean channel state. Red means delete and record only.
     - **The Earned Glow Rule:** glow only on Play, lit toggles, active segments, pad hits and LEDs. Every glow has a y-offset and a negative spread. Nothing glows at rest.
     - **The Theme Contract Rule:** every theme block maps the full role set. There is no hex outside the token section. Canvases read `--cv-*`.
3. **Typography.**
   - The scale from section 2, with:
     - **The 15px Floor Rule**;
     - **The Tabular Readout Rule:** numbers are Avenir tabular in wells; no monospace;
     - **The Case Rule:** window titles in Title Case; section titles uppercase via CSS at 0.08em; source strings never all caps; separator " · ".
   - **Copy glossary:**
     - window names: Library, Playlist, Step Rack, Piano Roll, Mixer, Clip Inspector, Pads;
     - controls carry no "Audius" or "Official" prefix (the brand lives in the logo, which keeps the app clearly unofficial);
     - never "FL", "Fruity" or "Image-Line";
     - default project name to adopt: "Untitled session" (Library pass).
4. **Layout.**
   - Three-column desktop and 1:1 track-header/lane alignment are untouchable.
   - Breakpoint queries: compact = `(max-width:760px),(max-width:900px) and (max-height:520px)`; touch = `(pointer:coarse),(hover:none)`.
   - Size tokens per pointer and the spacing rhythm (inside a group ≤ 8px, between groups ≥ 16px, more space above a section header than below).
   - The `@layer legacy, system` architecture and the skin/geometry split.
5. **Elevation & Depth.**
   - **The Four Surfaces Rule:** wells are surface-0; panes surface-1; bars, title bars and racks surface-2; controls surface-3; popovers sit between with shadow-3.
   - **The Well Rule:** wells are recesses with no border; never nest raised cards.
   - The shadow vocabulary with exact values.
   - The wallpaper behaviour: arrangement only, 88% veil, solid panes, no glass.
6. **Shapes.**
   - **The Radius Ladder Rule:** 4 for chips, kbd and meters; 6 for small controls; 8 for controls; 12 for racks, popovers and touch controls; 16 for dialogs. Docked panes are square.
   - Borders are hairline. No coloured side borders over 1px.
7. **Components.** For each primitive: class names (new `.btn*` and the legacy aliases), sizes, states and behaviour.
   - Buttons and all variants; segmented; stepper; LCD; rack; title bar; section title; inputs; checkbox and switch; range (fill, bipolar, double-click reset, wheel only when focused, Shift ×10); tooltip; status line, hint, live region and toast; disabled; popover; dialog frame; meters; LEDs.
   - **Pad** (Signature Component): see below.
   - **Behaviour contract:**
     - keyboard rules from section 6.3;
     - long-press never deletes;
     - every one-click delete is undoable;
     - close is a neutral ghost × placed last after a divider; delete is a trash icon.
   - Named rules: **The One Primary Rule**; **The Quiet Delete Rule**; **The Pressed-Not-Shrunk Rule**.
8. **Do's and Don'ts.** Include:
   - Don't copy the mock-up's gradient Audius glyph on dark.
   - Don't draw waveforms or chips on pads.
   - Don't use zero-offset coloured halos.
   - Don't add `!important` for skin.
   - Don't hard-code colours in canvases.
   - Don't add a second accent for "on".
   - Do use `setLit()` and `aria-pressed` for every on/off.
   - Do run the probe at all 7 harness viewports.

**The Pad component** (Signature Component). Spell out:
- A pad is a tap target: a rounded rectangle on surface-2 with a 1.5px border in the pad's colour (`--pad-color`).
- Label "N · Name" plus a meta line (beat length).
- On hit: lit border, glow in the pad colour, `scale(.97)` (none under reduced motion).
- **The Pads Are Pads Rule:** never waveforms, never headphone/S/M chips, never clip-style content. The owner said so explicitly. The mock-ups are wrong on this point.

### `/home/user/DAW/.impeccable/design.json`
`schemaVersion` 2. `extensions`:
- `colorMeta` for the main tokens (with `displayName`);
- `shadows`: bevel, well, shadow-1/2/3, glow-lit, glow-play;
- `motion`: the durations and easings;
- `breakpoints`: compact, touch, ≤1200 two-row topbar, ≤420, ≤340.

`components`: 8 self-contained `ds-` prefixed HTML+CSS snippets: secondary, lit, primary and Play buttons; segmented PAT/SONG; LCD tempo with stepper; title bar with ghost close; pad. Inline SVG icons; CSS using `var(--…)`.

`narrative`: copied verbatim from DESIGN.md.

---

## 10. Hand-offs (record each in DESIGN.md "Components" as the owning pass)

- **Tool bar (#2):**
  - apply `.segmented` to the desktop tool group (the active tool becomes a gradient segment) and make PAT/SONG horizontal on desktop (its segments are 21px tall today);
  - `.stepper` + `.lcd` for tempo; `.rack` groups;
  - the hint bar loses the coin and gets short copy;
  - menu words must stop running commands until the menu primitive exists;
  - tempo drag-scrub.
- **Library (#3):**
  - folders become a radio or tab group of buttons;
  - hide the `.panel-footer-tips` wrapper on touch (the "( ):" leftovers);
  - "Untitled session"; Ubuntu wording.
- **Playlist (#4):**
  - track headers (name clipping; trash icon placement);
  - ruler text at ≥ 15px in Avenir (it is canvas text, currently JetBrains Mono 12px);
  - clip internals using tokens;
  - the cursor-info clip at 320/360px.
- **Step Rack (#5):** `.cr-step.beat-even` and `.beat-odd` colours and `.cr-channel-btn` text treatment (allow-listed literals today).
- **Mixer (#7):** vertical faders on the range primitive; dB meter mapping, peak hold and clip light; value bubbles.
- **Effect windows and Inspector (#8):** Reverse and Mute become `.switch` toggles; numeric scrub.
- **Trellis (#9):** pad name contrast (the inline coloured name fails on daylight); Stamp to Playlist as a switch. **Pads are pads.**
- **Menus, sheets, dialogs, toasts (#10):**
  - `<dialog>` with focus in, trap, return and Escape;
  - menu primitive; SHORTCUTS table feeding tooltips, kbd chips and F1;
  - toast Undo button;
  - drop "Official" and "Audius" prefixes from option labels and titles.
- **Phone (#11):** the switcher's "Ste…" label at 640×360 (pre-existing), and the transport row's 4px overrun at 360px.
- **Themes sweep (#12):** re-verify every token pair with a computed-colour script.

## 11. Must NOT change
- **Layout:** the 3-column desktop layout and its widths; exact 1:1 track-header/lane alignment (`ui.rulerHeight` 34px = `.track-column-top`; `.track-header-item` 78px = `trackHeight`); the compact window-switcher layout; every `display` rule for responsive show/hide.
- **Default first view:** Library + Playlist, with Mixer, Trellis, Step Rack, Piano Roll and Inspector collapsed.
- **Behaviour:** every close (×) button; one-click deletes (now undoable); all features and keyboard shortcuts.
- **Code contracts:** every id and class that app.js queries (`.active`, `.on`, `.collapsed`, `.playing`, `.triggered`, `.playing-step`, `.selected`, `.selected-stem`, `.dragover`, `data-tool`, `data-mobile-window`, `data-theme-swatch`, `data-folder`); the THEMES palettes for track colours; `?v=` numbers; git state.
- **Themes and brand:** all 9 selectable themes plus wallpapers; the white single-colour lockup on dark and the colour glyph on daylight; the AUDIUS/STUDIO wordmark alternation (and its reduced-motion crossfade).
- **Floors:** text ≥ 15px; touch targets ≥ 44px.
- **Pads:** a label and meta only.


## Acceptance criteria

1. Harness probe (lib.cjs probe/report) at 1920x1080, 1440x900, 1366x768, 1024x1366t, 1366x1024t, 360x640t, 640x360t plus custom 1201x800, 1280x800, 901x700, 320x568t and 3840x2160 shows: doc width == viewport width (no OVERFLOW), hscroll none, off-screen controls none, 'text < 15px' none, and on touch viewports 'small targets' none.
2. Clipped-text results are a subset of this baseline: track-title '5 · Vocal / Audio Cuts' at 1920, 1440, 1366, 1280 and 3840; track titles at 901, 1024 and 1201; #status-pill at 1201–1440 and at 1366x1024t; #project-name-label at 1201, 1280 and 1366x1024t; #cursor-info at 360 and 320.
3. Overlap results are a subset of the baseline. Every reported overlap with #hscroll-slider is clipped: document.elementFromPoint at 10px from the slider's left edge, at its centre and at 10px from its right edge returns #hscroll-slider at 360x640t, 640x360t and 320x568t. At 901x700, no .tool-btn overlaps the More summary.
4. Default first view at every viewport: #left-panel and #timeline-viewport are visible; #mixer-window, #trellis-dock, #channel-rack-window, #piano-roll-window and #right-panel have class 'collapsed'. No console or page errors.
5. styles.css starts with '@layer legacy, system;'. document.styleSheets shows a CSSLayerBlockRule named 'system' and one named 'legacy'. A grep finds no '.app-shell' selector and no '--font-mono'.
6. No declaration of font-size, font-weight, letter-spacing, color, background, border-color, box-shadow or outline carries !important. The total !important count in styles.css is ≤ 190.
7. The legacy layer contains zero font-size declarations.
8. Outside the unlayered token section, no hex or rgb()/rgba() colour literal appears except: #FFFFFF/#000000 inside color-mix(); rgb(255 255 255 / x) bevels and sheens; rgb(var(--shadow-rgb) …); and the allow-list (.cr-step.beat-even, .cr-step.beat-odd, .cr-channel-btn, @keyframes audiusCharWave and studioCharWave).
9. Theme contract: for each of audius-dark, amoled, daylight, forest, ocean, amethyst, cyberpunk, platinum-slate, nordic and obsidian (set body.dataset.theme directly for obsidian), getComputedStyle(document.body) returns non-empty values for --surface-0..3, --surface-popover, --surface-hover, --surface-press, --select-bg, --border, --border-subtle, --border-strong, --hairline, --text-primary, --text-secondary, --on-accent, --accent, --accent-fill, --accent-text, --accent-gradient, --play-gradient, --lit, --info, --lcd-text, --focus, --state-play, --state-mute, --state-solo, --danger, --danger-fill, --danger-text, --cv-bg, --cv-lane-even, --cv-playhead and --cv-loop. --cv-loop resolves to a hex string.
10. Contrast, measured in every theme by resolving token colours through a 1x1 canvas: text-primary on surface-0..3 ≥ 4.5; text-secondary on surface-1, 2 and 3 ≥ 4.5; on-accent on accent-fill ≥ 4.5; accent-text on surface-1 and surface-2 ≥ 4.5; danger-text on surface-1 ≥ 4.5; white on danger-fill ≥ 4.5; lcd-text on surface-0 ≥ 4.5; lit on surface-3 ≥ 3; focus on surface-0..3 ≥ 3.
11. Theme leaks fixed. On nordic, cyberpunk and platinum-slate, .fl-window-header's background equals that theme's --surface-2 (not rgb(42, 46, 67)). On forest and nordic, #btn-mode-song.active's background-image contains no rgb(204, 15, 224). The .topbar background-image contains the theme's --accent colour.
12. Daylight: the selected .asset-card's name text has contrast ≥ 4.5 against its background; .panel-close-btn's computed background-color is transparent; .bpm-step-btn's background is transparent; .meter-bar's background equals daylight --surface-0. After the theme switch, an empty-lane pixel sampled from #playlist-canvas has relative luminance > 0.75.
13. Typography: .readout-main is 22px, weight 600, font-variant-numeric containing 'tabular-nums'. #bpm-input is 20px. .fl-win-title is 16px/600. .modal-head h3 is 20px/600. .trellis-title, .sub-header and .fx-rack-head are 15px/700, text-transform uppercase, letter-spacing ≈ 1.2px. No visible DOM element computes a font-weight of 800 or 900, and none has a font-family containing 'JetBrains'.
14. Buttons on desktop (1920x1080): .tool-btn, .mini-btn and .toolbar-select are 34px tall with border-radius 8px; .tiny-btn and .panel-close-btn are 26px with radius 6px; .trk-btn is 24x24; #btn-play is 40x40 with a background-image containing a gradient; the More and Options summaries are 34px tall.
15. Buttons on 1024x1366t: every visible button, summary, select and text/number input is ≥ 44px in both dimensions, and .tool-btn has border-radius 12px.
16. Lit state: .tool-btn[data-tool=draw] has aria-pressed='true', a border-color equal to --lit, and a box-shadow string containing the --lit colour. Clicking [data-tool=slice] moves both aria-pressed='true' and .active to that button. #btn-loop, the window toggles, #btn-mode-song and the phone switcher tabs all expose aria-pressed that matches their .active class.
17. Close vs delete: each .panel-close-btn's computed background is transparent at rest. On hover at 1920, its background equals --surface-hover and its colour is not red. Track-header delete buttons contain an svg use[href='#i-trash-2'] and no '×' text. Mute and solo buttons carry aria-pressed, and their titles change between 'Mute track'/'Unmute track' and 'Solo track'/'Unsolo track'.
18. Focus: tabbing to #bpm-input shows outline-style solid, 2px wide, with outline-color equal to --focus. Tabbing to a .tool-btn shows an outline-color equal to --focus and different from --lit. No element has 'outline: none' while it matches :focus-visible, except range inputs, whose thumb ring is drawn by box-shadow.
19. Keyboard: focus #master-vol and press Space, and #btn-play gains .playing; press Space again and it stops. Press F6 while #master-vol is focused, and #channel-rack-window toggles collapsed. Type 130 + Enter in #bpm-input, and document.activeElement is no longer the input while the tempo field reads 130. Type 99 then Escape in #bpm-input, and the value reverts to the previous tempo. Press ArrowRight on a focused #zoom-slider, and its value increases while the selected clip's start beat is unchanged.
20. Range: #master-vol has inline --fill-from/--fill-to custom properties. After setting #master-vol to -10 through an input event, a dblclick returns it to 0. A wheel event over an unfocused #zoom-slider leaves its value unchanged. #insp-pan and #trk-eq-low have the data-bipolar attribute. #hscroll-slider has data-fill='none' and no fill properties.
21. Status: after clicking M on track 1 at 1920, #status-pill contains 'muted'. It still contains 'muted' after hovering a titled toolbar button within 2 seconds, and #status-live contains 'muted'. At 360x640t the same click makes #status-toast visible with that text; it is hidden again within 6 seconds and has pointer-events none.
22. Disabled: on fresh load, #btn-undo and #btn-delete-clip have aria-disabled='true' and computed opacity ≈ 0.45. After clicking a track's M button, #btn-undo has aria-disabled='false'.
23. Undo: clicking #btn-clear-pool leaves 0 .asset-card elements. Ctrl+Z then restores 4 .asset-card elements, and the clips' assets resolve (clicking a card's preview button raises no error).
24. Long-press safety (code check): each of the three contextmenu listeners in app.js returns early for touch pointers or a recent touch pointerdown. A mouse right-click on a clip still deletes it, and Ctrl+Z restores it.
25. Tooltips at 1920: hovering .tool-btn[data-tool=paint] for 600ms shows a visible .tooltip whose textContent equals the button's former title, and the button has no title attribute while hovered. After the pointer leaves, the .tooltip is hidden and the title attribute is restored. On 360x640t, tapping produces no visible .tooltip.
26. Wallpaper: with body[data-wallpaper='Aurora-Glow'], #app-shell's computed background-image contains 'Aurora-Glow' and .left-panel's backdrop-filter is 'none'. With the wallpaper select set to none, #app-shell's background-image is 'none' and .timeline-viewport's background equals --surface-0.
27. Reduced motion (context reducedMotion 'reduce'): opening the Options popover gives it animation-name 'ds-fade-in'. A pressed .tool-btn has transform 'none'. A .wm-audius-char element still has a running animation (wm-fade-audius). No popover or sheet uses a translate animation.
28. Pads: each .matrix-pad contains only .matrix-pad-name and .matrix-pad-meta children: no canvas, svg, audio waveform or button chips. The inline style sets --pad-color rather than border-color.
29. Copy: index.html contains no '＋' (U+FF0B), no 'AUDIUS LIBRARY', no 'CLIP / SEGMENT INSPECTOR' and no .fl-win-badge. app.js setStatus strings contain no 'FL '. The visible window titles read 'Library', 'Step Rack · …', 'Piano Roll · …', 'Mixer · …' and 'Clip Inspector'.
30. Impeccable detector (scripts/impeccable detect --json app/public/styles.css app/public/index.html) reports 0 for low-contrast, side-tab, gpt-thin-border-wide-shadow, undersized-ui-text, tiny-text, bounce-easing, layout-transition and nested-cards. No dark-glow finding is described as 'Zero-offset'. cramped-padding is reported only for .fl-upper-dock, .minimap-bar or .playlist-bottombar, if at all.
31. /home/user/DAW/DESIGN.md exists. Its YAML frontmatter has only the keys name, description, colors, typography, rounded, spacing and components. Its H2 sections are exactly Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components and Do's and Don'ts, in that order. It contains 'The Pads Are Pads Rule', 'The Earned Glow Rule' and a per-theme token table naming all ten theme ids.
32. /home/user/DAW/.impeccable/design.json parses as JSON, has schemaVersion 2, and has at least 6 components with ds- prefixed classes.
33. git status shows no commits and no branch change. The ?v= numbers in index.html (audius-fonts.css?v=18, styles.css?v=23, app.js?v=22) are unchanged. audio-engine.js and wav-codec.js are unmodified.
