---
name: Audius Studio
description: "Unofficial, community-built browser DAW for the Audius community: the Elevated Audius studio system."
colors:
  surface-0: "#1B1C2A"
  surface-1: "#242538"
  surface-2: "#2A2E43"
  surface-3: "#353A51"
  surface-popover: "#2F3348"
  surface-hover: "#444B69"
  select-bg: "#392B56"
  border: "#3C425D"
  text-primary: "#F6F8FC"
  text-secondary: "#A6AAC0"
  on-accent: "#FFFFFF"
  accent: "#CC0FE0"
  accent-fill: "#B80DCB"
  accent-text: "#E28BEA"
  accent-violet: "#5B23E1"
  lit: "#1BA1F1"
  info: "#1BA1F1"
  state-play: "#15D864"
  state-mute: "#F08A24"
  state-solo: "#F5C842"
  on-state: "#1B1C2A"
  danger: "#F9344C"
  danger-fill: "#D81F38"
  danger-text: "#FF8A97"
typography:
  label:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
  heading:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  button:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  readout-lg:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
    fontFeature: "tnum"
  readout-md:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
    fontFeature: "tnum"
  kbd:
    fontFamily: "Avenir Next LT Pro, Avenir Next, DM Sans, Inter, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "999px"
  touch-sm: "10px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "24px"
components:
  button-secondary:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
  button-secondary-pressed:
    backgroundColor: "{colors.surface-2}"
  button-lit:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "34px"
  button-accent:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "26px"
    padding: "0 8px"
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 12px"
  button-ghost:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    height: "26px"
    width: "26px"
  button-danger:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.danger-text}"
    rounded: "{rounded.sm}"
    height: "26px"
  button-play:
    backgroundColor: "{colors.accent-violet}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    height: "40px"
    width: "40px"
  segment:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    height: "28px"
    padding: "0 8px"
  segment-active:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    height: "28px"
  input-well:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 8px"
  lcd:
    backgroundColor: "{colors.surface-0}"
    textColor: "{colors.info}"
    typography: "{typography.readout-md}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 8px"
  title-bar:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-primary}"
    typography: "{typography.title}"
    height: "34px"
    padding: "4px 6px 4px 10px"
  rack:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.lg}"
    padding: "6px"
  popover:
    backgroundColor: "{colors.surface-popover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "10px"
  tooltip:
    backgroundColor: "{colors.surface-popover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  toast:
    backgroundColor: "{colors.surface-popover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
    height: "44px"
  pad:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "52px"
  pad-triggered:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
  checkbox-checked:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.xs}"
    size: "18px"
---

# Design System: Audius Studio

## Overview

**Creative North Star: "The Lit Rack"**

Raised navy racks of tactile buttons on a deep Audius night, where only the things that are on, playing or selected light up. Audius Studio is an unofficial, community-built browser DAW made by and for the Audius community; it is not an Audius product and the interface never says or implies otherwise. The Audius lockup in the top bar is the only brand mark, white and single-colour on dark themes.

The mode is Operate: long, hands-on sessions of dragging clips, tapping pads and riding faders. The interface keeps chrome compact, every control stays standard and obvious, and the work area gets the space. The look keeps the Audius dark-purple brand and Avenir Next, and adds pro-studio craft: a real type scale, layered panel depth, precise wells and knobs, lit states, and short purposeful motion. The button language comes from the owner's liked mock-up (`docs/design-reference/31-owner-liked-top-buttons.jpg`): separate raised rounded buttons a step lighter than their panel, a hairline light border, a faint top highlight and a soft shadow; bold icon plus label; a dark inset track for segmented controls with a magenta-to-violet active segment; a larger lit violet Play; inset LCD wells with bright blue tabular numbers.

**Key Characteristics:**
- Four-surface depth: wells, panes, bars and racks, raised controls, with popovers between.
- The owner's button language, shared by every control through one set of tokens.
- Lit states only: nothing glows at rest; on, playing and selected things light up.
- Tabular Audius-blue read-outs in inset wells; no monospace face anywhere.
- One family (Avenir Next) with a 15px floor for all text.

## Colors

A deep, blue-violet night palette with one magenta brand accent, one cyan-blue "on" colour and amber and yellow reserved for channel state. Every colour has one job. Each theme maps the full role set, so components never read raw palette values.

### Primary
- **Audius Magenta** (#CC0FE0): the brand accent. Playhead loop region, step fills, LEDs, the top-bar stripe, the cursor and selection tint.
- **Magenta Fill** (#B80DCB): solid fills that carry white text (primary button, checked box, active segment gradient). White on it is at least 4.89:1 in every theme.
- **Orchid Text** (#E28BEA): accent used as text or an icon on dark surfaces (section icons).
- **Violet Depth** (#5B23E1): the dark end of the brand gradient and the Play button.

### Secondary
- **Signal Blue** (#1BA1F1): two jobs, never mixed. As `lit` it marks selected or on (a lit edge with a soft glow); as `info` it marks time (playhead, position, tempo) in LCD wells.

### Tertiary
- **Mute Amber** (#F08A24) and **Solo Yellow** (#F5C842): the filled state of the M and S buttons, with dark `on-state` text (#1B1C2A).
- **Play Green** (#15D864): transport state and meter "ok".

### Neutral
- **Deep Space** (#1B1C2A, surface-0): wells, the arrangement canvas and the app background.
- **Panel Night** (#242538, surface-1): docked panes.
- **Bar Slate** (#2A2E43, surface-2): top bar, title bars, racks, cards.
- **Control Steel** (#353A51, surface-3): raised controls. Hover is #444B69 (`surface-hover`). Popovers use #2F3348.
- **Violet Select** (#392B56, `select-bg`): selected rows.
- **Border** (#3C425D); `border-subtle` and `border-strong` are precomputed per theme (6C718A strong in the default theme); `hairline` is the text colour at 10% (14% on daylight).
- **Ink** (#F6F8FC, text-primary) and **Mist** (#A6AAC0, text-secondary, at least 4.7:1 on surfaces 1 to 3).
- **Danger Red** (#F9344C) with `danger-text` #FF8A97 and `danger-fill` #D81F38: delete and record only.

### Per-theme contract

Every theme block sets the palette variables below plus the role extras; derived roles resolve from them. All ten ids are required: the nine selectable themes plus `obsidian`, which is kept so older saved state still renders.

| Theme id | surface-0 | surface-1 | surface-2 | surface-3 | popover | border | text-primary | text-secondary | accent | accent-fill | accent-text | lit | info | danger-text |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `audius-dark` | #1B1C2A | #242538 | #2A2E43 | #353A51 | #2F3348 | #3C425D | #F6F8FC | #A6AAC0 | #CC0FE0 | #B80DCB | #E28BEA | #1BA1F1 | #1BA1F1 | #FF8A97 |
| `amoled` | #0A0A0E | #14141B | #1A1829 | #26233A | #1F1F2B | #2E2B44 | #F6F8FC | #9E9EAE | #A74CFF | #8E3CE0 | #C67CFF | #1BA1F1 | #1BA1F1 | #FF8A97 |
| `daylight` | #EFEFF1 | #F6F5F7 | #FBFAFC | #FFFFFF | #FFFFFF | #D6D5DB | #343B49 | #6C6780 | #CC0FE0 | #B80DCB | #9A0AAB | #0B76B8 | #0B6FAD | #B0001A |
| `forest` | #010B06 | #041308 | #081A0B | #0F2F15 | #0A1F0D | #166527 | #9BFFA7 | #34D561 | #0BD90B | #0BD90B | #3DF23D | #20E290 | #20E290 | #FF8A97 |
| `ocean` | #101626 | #151E34 | #19243E | #243357 | #1D2947 | #2C3E69 | #F4F8FF | #9CB2D9 | #1BA1F1 | #0B76B8 | #58B9F4 | #D63FE6 | #1BA1F1 | #FF8A97 |
| `amethyst` | #191026 | #241638 | #2B1A42 | #3D275C | #301E4A | #4D3270 | #FBF7FF | #C8B5E3 | #CC0FE0 | #B80DCB | #E68BF0 | #1BA1F1 | #1BA1F1 | #FF8A97 |
| `obsidian` | #0b0d14 | #121622 | #151A28 | #22293e | #181e2e | #273047 | #eef2ff | #8e9bb8 | #8b5cf6 | #7C4DEB | #A78BFA | #22d3ee | #22d3ee | #FF8A97 |
| `cyberpunk` | #090612 | #120b22 | #160E2A | #271846 | #1b1132 | #382063 | #fdf4ff | #b59cd6 | #ff2a85 | #D1126B | #FF5CA1 | #00f0ff | #00f0ff | #FF8A97 |
| `platinum-slate` | #1c212b | #232936 | #262D3B | #323c52 | #283040 | #3f4a63 | #eef2f9 | #9eb0cc | #1BA1F1 | #0B76B8 | #58B9F4 | #C67CFF | #1BA1F1 | #FF8A97 |
| `nordic` | #161920 | #1e222b | #222630 | #2e3440 | #252a36 | #333a48 | #eceff4 | #9aa5b8 | #88c0d0 | #88C0D0 | #88C0D0 | #B48EAD | #88c0d0 | #E08A92 |

Role tokens, all defined per theme: `--surface-0..3`, `--surface-popover`, `--surface-hover`, `--surface-press`, `--select-bg`, `--border`, `--border-subtle`, `--border-strong`, `--hairline`, `--hairline-strong`, `--text-primary`, `--text-secondary`, `--text-disabled`, `--on-accent`, `--accent`, `--accent-fill`, `--accent-text`, `--accent-gradient`, `--accent-press`, `--brand-gradient`, `--brand-stripe`, `--play-gradient`, `--play-glow`, `--lit`, `--lit-bg`, `--lit-bg-hover`, `--info`, `--lcd-text`, `--focus`, `--state-play`, `--state-record`, `--state-mute`, `--state-solo`, `--on-state`, `--danger`, `--danger-fill`, `--danger-text`, `--danger-soft`, `--led-on`, `--meter-trough`, `--meter-ok`, `--meter-warn`, `--meter-clip`, plus the alpha-tint triplets `--text-rgb`, `--accent-rgb`, `--lit-rgb`, `--danger-rgb`, `--play-glow-rgb`, `--surface-0-rgb`, and the canvas set `--cv-*` that `app.js` reads (lane, ruler, grid, playhead, loop, veil, scope colours). Contrast is checked in every theme: text-primary on surfaces 0 to 3 at least 4.5:1 (9.8:1 or better in practice), text-secondary on surfaces 1 to 3 at least 4.5:1, on-accent on accent-fill at least 4.5:1, accent-text on surfaces 1 and 2 at least 4.5:1, danger-text on surface-1 at least 4.5:1, white on danger-fill at least 4.5:1, lcd-text on surface-0 at least 4.5:1, lit on surface-3 at least 3:1, focus on every surface at least 3:1.

### Named Rules
**The One Job Rule.** Each colour has one job. Accent means brand, create and value fill. Lit blue means selected or on. Info blue means time. State colours mean channel state. Red means delete and record only.

**The Theme Contract Rule.** Every theme block maps the full role set. There is no hex outside the token section of `styles.css`. Canvases read `--cv-*`, never literals. The custom accent picker rewrites the same role tokens (`--accent-fill`, `--accent-gradient`, `--play-gradient`, `--accent-rgb`), so a picked accent re-themes everything.

**The No Newer Colour Syntax Rule.** The owner's Galaxy Note 3 (about Chrome 95) and older iPads (Safari 14 to 15) must work. Opaque blends are precomputed per theme as hex; alpha tints use comma-separated rgb triplets (`rgba(var(--lit-rgb), 0.6)`). No colour-mixing function, no oklch, no `@layer`, no `:has()`.

## Typography

**Family:** Avenir Next LT Pro (with Avenir Next, DM Sans, Inter and the system sans). One family for everything; numbers are tabular Avenir, never monospace.

**Character:** Confident and compact. Weight and case carry hierarchy, not size jumps: 600 for titles and controls, 700 for spaced uppercase section titles, 500 for labels.

### Hierarchy
- **Label** (500, 15px, 1.4): every field label, list row, status text. The floor for all text.
- **Body** (400, 16px, 1.5): dialog copy and empty states.
- **Title** (600, 16px, 1.2): window and panel titles ("Library", "Step Rack", "Mixer"). The context after the "·" is 500, 15px, text-secondary.
- **Section** (700, 15px, 1.2, 0.08em, uppercase): section titles inside a window, with a violet icon in accent-text.
- **Heading** (600, 20px, 1.25): dialog titles only.
- **Button** (600, 15px): every control label.
- **Read-out large** (600, 22px, tabular): song position. **Read-out medium** (600, 20px, tabular): tempo and LCD values. Read-out small is 15px 500.
- **kbd** (600, 15px): shortcut chips; hidden on touch screens.

### Named Rules
**The 15px Floor Rule.** No text is smaller than 15px, in the DOM or drawn on a canvas. Never set a font size on a component class; use the type tokens (`--fs-label`, `--fs-title`, `--fs-section`, `--fs-readout-*`).

**The Tabular Readout Rule.** Numbers in wells are Avenir with `font-variant-numeric: tabular-nums lining-nums`. No monospace face is loaded or named.

**The Case Rule.** Window titles are Title Case. Section titles are written in Title Case and uppercased by CSS at 0.08em; source strings are never typed in capitals. The separator is " · ". Weights used anywhere: 400, 500, 600, 700.

**Copy glossary.** Window names: Library, Playlist, Step Rack, Piano Roll, Mixer, Clip Inspector, Pads. Controls carry no "Audius" or "Official" prefix; the brand lives in the logo, which keeps the app clearly unofficial. Never "FL", "Fruity" or "Image-Line". The default project name to adopt is "Untitled session" (Library pass).

## Layout

The three-column desktop layout (Library, Playlist, Inspector when open) and the exact 1:1 alignment of track headers with playlist lanes (`ui.rulerHeight` 34px equals `.track-column-top`; `.track-header-item` 78px equals `trackHeight`) are untouchable. The default view is Library plus Playlist, with Mixer, Pads, Step Rack, Piano Roll and Inspector closed; every panel has a close button. Nothing scrolls the page sideways at any width from 320 to 3840; the UI is a fixed px scale.

Breakpoint queries: compact is `(max-width:760px), (max-width:900px) and (max-height:520px)`; touch is `(pointer:coarse), (hover:none)`; the top bar goes to two rows at 1200px and below; 420px and 340px have their own tightening.

Size tokens follow the pointer. Fine pointer: control 34px, small 26px, extra small 24px, Play 40px, range input 24px with a 4px track and 14px thumb, checkbox 18px. Touch: every control 44px, radii step up to 12px (small 10px), range input 44px with a 6px track and 22px thumb, checkbox 22px. Spacing rhythm: inside a group at most 8px, between groups at least 16px, more space above a section header than below.

Architecture of `styles.css` (no `@layer`): theme blocks and the role contract first (the only place colour literals live), then the legacy layout rules that own geometry (display, position, size, spacing, overflow, responsive show and hide), and the design system block last that owns skin (colour, border colour and style, radius, shadow, outline, type, motion, cursor, opacity). It comes last so it wins at equal specificity and carries no `!important`. The system block sets geometry only on its own classes (`.btn*`, `.rack`, `.lcd*`, `.segmented`, `.stepper`, `.tooltip`, `.toast`, `.empty-state`, `.visually-hidden`) and a few listed cases (the pat/song track padding, range and checkbox sizes, title-bar close spacing). A legacy `!important` on a visual property blocks the system, so there are none.

## Elevation & Depth

A hybrid: tonal layering for structure, soft offset shadows for what is raised, and a lit edge for what is selected. Depth never comes from a thin border plus a wide blur.

**The Four Surfaces Rule.** Wells are surface-0; panes are surface-1; bars, title bars and racks are surface-2; controls are surface-3; popovers sit between with shadow-3.

**The Well Rule.** Wells are recesses with no border and no box-shadow; the recess is a shade painted as a background layer (`--well-shade`). Never nest a raised card inside a rack or a card inside a card.

### Shadow Vocabulary
- **Bevel** (`inset 0 1px 0 var(--bevel-color)`): the faint top highlight of raised things. `--bevel-strong` is `inset 0 1px 0 rgba(255, 255, 255, 0.22)` for filled controls.
- **Well shade** (`linear-gradient(180deg, rgba(shadow, .5) 0, transparent 6px)`): the recess of LCDs, segmented tracks and meters.
- **Shadow 1** (`0 1px 2px rgba(0,0,0,.35), 0 2px 6px -3px rgba(0,0,0,.45)`): raised controls.
- **Shadow 2** (`0 2px 4px rgba(0,0,0,.3), 0 6px 12px -6px rgba(0,0,0,.5)`): racks and tooltips.
- **Shadow 3** (`0 2px 4px rgba(0,0,0,.3), 0 10px 16px -8px rgba(0,0,0,.6)`): popovers, dialogs, toasts.
- **Lit glow** (`0 2px 12px -3px rgba(lit, .6)`) and **play glow** (`0 4px 14px -5px rgba(play-glow, .8)`).
Shadow colour and strength are per theme (`--shadow-rgb`, `--shadow-k`; daylight uses a violet-tinted shadow at 0.45). No blur exceeds 16px.

### Named Rules
**The Earned Glow Rule.** Glow only on Play, lit toggles, active segments, pad hits and LEDs. Every glow has a y-offset and a negative spread; there are no zero-offset coloured halos. Nothing glows at rest. A selected row is an edge (1px lit ring), not a glow.

**The Wallpaper Rule.** An Audius wallpaper paints behind the arrangement only, under a theme-aware veil (88% surface-0). Panes stay solid: no glass and no backdrop blur.

## Shapes

Rounded and tactile, with hairline borders. Docked panes are square; everything you press is rounded.

**The Radius Ladder Rule.** 4px for chips, kbd and meters (`--r-xs`); 6px for small controls (`--r-sm`); 8px for controls (`--r-md`, `--r-ctl`); 12px for racks, popovers and touch controls (`--r-lg`; 10px for small touch controls, `--r-ctl-sm`); 16px for dialogs (`--r-xl`); a full pill (`--r-pill`) for range tracks, switches and scrollbar thumbs. Borders are 1px hairlines. There are no coloured side borders thicker than 1px: selected list items use an inset ring, never a side tab.

## Components

All shared controls get their skin from tokens in the system block, so a button looks the same in the top bar, a title bar, a dialog and a track header. New markup uses the `.btn*` classes; legacy classes (`.tool-btn`, `.mini-btn`, `.tiny-btn`, `.action-btn`, `.transport-btn`, `.nudge-btn`, `.ctx-btn`, `.trk-btn`, and the rest) are aliases of the same recipe.

### Buttons
- **Secondary (default):** surface-3 fill with a 5% white sheen, hairline border, bevel plus shadow-1, 600 weight, 8px radius (6px for small and extra small, 12px and 10px on touch). Sizes: md 34px (`--ctl-h`), sm 26px, xs 24px, lg 40px; 44px for all on touch. Icons are 18px in md and 16px in sm, 2px stroke.
- **Hover** (fine pointers only): surface-hover fill, hairline-strong border. **Pressed:** surface-press fill, inset shadow, one pixel down (never scaled). **Disabled:** 45% opacity, flat, not-allowed cursor; the state is `aria-disabled` so the control stays focusable.
- **Lit (selected or on):** cyan-blue `lit` edge, a 14% lit tint, a 1px lit ring and a soft offset glow. Applied through `.active` with `aria-pressed="true"`; label weight does not change between states.
- **Accent (create):** accent-tinted fill and border with an accent icon. One per area: Add Track, To Playlist, Render Clip, Paint Pat, Upload.
- **Primary (commit):** solid `accent-fill` with white text, strong bevel. One per surface: Export, Render and Download, a dialog's confirm.
- **Play:** `--play-gradient` violet with the play glow, 40px (44px touch), brighter while `.playing`.
- **Ghost and close:** transparent, text-secondary, surface-hover on hover. **Close is never red** and is always last in a title bar after a hairline divider.
- **Delete:** a trash icon. Quiet in rows and title bars (transparent, red tint on hover or focus); raised for buttons among peers (Clear, Delete Clip). Every delete is one click and undoable with Ctrl+Z, including stems and the whole library.
- **Mute and solo:** amber and yellow fill with dark text when on, with `aria-pressed` and state titles ("Mute track" or "Unmute track").

### Segmented control and stepper
A dark inset track (well shade, border-subtle) holding transparent segments; the active segment is the magenta-to-violet `--accent-gradient` with a soft glow (`.segmented`, PAT and SONG). On compact layouts the track padding and border drop to zero. The stepper is a stacked up and down pair in an LCD (22px wide) and two 44px buttons side by side on touch.

### LCD, rack and title bar
- **LCD:** an inset well, min height `--ctl-h`, 20px tabular `lcd-text` value, text-secondary unit (`.lcd`, `.lcd__value`, `.lcd__unit`; legacy `.bpm-box`, `.time-readout`).
- **Rack:** a surface-2 panel with hairline border, 12px radius, bevel and shadow-2, holding a group of controls (`.rack`, legacy `.transport-group`).
- **Title bar:** 34px (48px touch), surface-2, bevel, 4px insets; a 16px title in 600, 16px text-secondary icon; the close button sits last.
- **Section title:** 15px 700 uppercase at 0.08em with an 18px accent-text icon.

### Inputs, checkbox, switch, range
- **Text and number wells:** surface-0, 1px border, 8px radius, inset shadow; border-strong on hover and focus; danger border when invalid; native spin arrows are hidden.
- **Checkbox and switch:** custom square (18px, 22px on touch) with the Lucide check drawn as a mask; `.switch` is the pill form for on and off flags.
- **Range:** a custom track and thumb. The track shows the value (`--fill-from` and `--fill-to`, written by `app.js`), bipolar sliders (`data-bipolar`) fill from zero, `data-fill="none"` stays unfilled. Double-click or Ctrl/Cmd-click resets to `data-default` or the initial value; the wheel only moves a focused slider; Shift+Arrow moves ten steps. A drag reads out in the status line (`data-label`, `data-format`, `data-unit`). The focus ring is drawn on the thumb.

### Popover, dialog, tooltip, toast, status
- **Popover and sheet:** surface-popover, hairline-strong border, 12px radius, shadow-3; entrance `ds-pop-in` 180ms (desktop) or `ds-sheet-in` 240ms (compact bottom sheet).
- **Dialog:** surface-1 card, 16px radius, 20px heading, border-subtle footer.
- **Tooltip:** one bubble for mouse and pen hover (450ms delay, instant within 300ms of the last) and keyboard focus. It borrows the element's `title` while open; Escape or leaving hides it. Never shown on touch.
- **Status line:** `setStatus(msg, {kind})` is the one entry point. A fresh message stays for 3 seconds (6 for errors, 1.5 for slider values); hover and focus hints (`setHint`) never overwrite it. The same text goes to a polite live region and, on compact layouts only, to a toast that sits 52px above the bottom edge, ignores pointer events and clears itself.

### Focus and browser surfaces
A 2px ring in the text colour at 2px offset (1px on inputs, inset on dense rows) on `:focus-visible`, with a plain `:focus` rule first for Safari 14 to 15. The caret, selection, scrollbars (thin, themed, WebKit rules for older engines) and `option` lists are themed from the palette. The tempo field shows the same ring.

### Pad (Signature Component)
A pad is a tap target: a rounded rectangle on surface-2 with a 1.5px border in the pad's colour (`--pad-color`, with `--pad-rgb` for its glow). Its content is a label ("N · Name") and a meta line (beat length), nothing else. On a hit the border lights, a glow in the pad colour appears and the pad scales to 0.97 (no scale under reduced motion).

**The Pads Are Pads Rule.** Never waveforms, never headphone, S or M chips, never clip-style content on a pad. The owner said so explicitly; the mock-ups are wrong on this point.

### Behaviour contract
- **Keyboard ownership:** text fields keep typing (Enter commits and blurs, Escape restores the value it had on focus); dropdowns and sliders keep their navigation keys; a control reached with the keyboard keeps Space and Enter; Space, F-keys, Escape and Ctrl combos run the shortcut whatever else has focus. A dropdown changed with the pointer gives focus back.
- **Long-press never deletes:** the three right-click delete handlers ignore touch.
- **Reduced motion:** colour feedback stays; entrances become a 120ms fade; press translate, pad scale and checkbox pop stop; the oscilloscope holds still; the beat pulse becomes a brief brightness flash; the AUDIUS and STUDIO wordmark crossfade keeps running.
- **Lit state API:** `setLit(el, on)` toggles `.active` and `aria-pressed` together.

### Named Rules
**The One Primary Rule.** One primary button per surface. Creating things is Accent; committing is Primary.
**The Quiet Delete Rule.** Delete is a trash icon, quiet at rest, red only on hover or focus. Close is a neutral ghost cross.
**The Pressed-Not-Shrunk Rule.** Pressing moves a control one pixel down with an inset shadow. It never scales.

### Hand-offs (owning pass)
- **Tool bar (#2):** apply `.segmented` to the desktop tool group and make PAT/SONG horizontal on desktop; `.stepper` plus `.lcd` for tempo; `.rack` groups; the hint bar loses the coin and gets short copy; menu words must stop running commands until a menu primitive exists; tempo drag-scrub.
- **Library (#3):** folders become a radio or tab group of buttons; hide the footer tips wrapper on touch (the "( ):" leftovers); "Untitled session"; Ubuntu wording.
- **Playlist (#4):** track-header name clipping and trash placement; ruler text at 15px or more in Avenir (canvas text, currently 12px mono); clip internals on tokens; the cursor-info clip at 320 and 360px; `ctx.roundRect` is unavailable before Chrome 99.
- **Step Rack (#5):** `.cr-step.beat-even` and `.beat-odd` colours and `.cr-channel-btn` text treatment (the allow-listed literals today).
- **Mixer (#7):** vertical faders on the range primitive; dB meter mapping, peak hold, clip light, value bubbles; strip markup that interpolates data into `innerHTML`.
- **Effect windows and Inspector (#8):** Reverse and Mute become `.switch` toggles; numeric scrub.
- **Trellis (#9):** pad name contrast and wrapping (the inline coloured name fails on daylight and wraps at 52px); Stamp to Playlist as a switch. Pads are pads.
- **Menus, sheets, dialogs, toasts (#10):** `<dialog>` with focus in, trap, return and Escape; a menu primitive; a SHORTCUTS table feeding tooltips, kbd chips and F1; a toast Undo button; drop "Official" and "Audius" prefixes from option labels and titles.
- **Phone (#11):** the switcher's truncated "Ste…" label at 640×360 and the transport row's 4px overrun at 360px.
- **Themes sweep (#12):** re-verify every token pair with a computed-colour script.
- **Naming:** the `fl-` class prefix and `FL_PIANO_MAP` are internal names that predate this pass; rename in one dedicated change.

## Do's and Don'ts

### Do:
- **Do** use `setLit()` and `aria-pressed` for every on/off control.
- **Do** read colour, radius, shadow, size and motion from the tokens; add a role to every theme block before using it.
- **Do** keep one primary action per surface and show delete as a quiet trash icon.
- **Do** keep text at 15px or more and touch targets at 44px or more; run the harness probe at all seven viewports (1920×1080, 1440×900, 1366×768, 1024×1366 touch, 1366×1024 touch, 360×640 touch, 640×360 touch).
- **Do** give older browsers a complete fallback on the line before anything newer than Chrome 95 or Safari 14.
- **Do** keep geometry in the legacy layout rules and skin in the system block.

### Don't:
- **Don't** copy the mock-up's gradient Audius glyph on dark themes; the lockup is white and single-colour.
- **Don't** draw waveforms or chips on pads.
- **Don't** use zero-offset coloured halos or a glow at rest.
- **Don't** add `!important` for skin, or `@layer`, a colour-mixing function, oklch or `:has()`.
- **Don't** hard-code colours in components or canvases.
- **Don't** add a second accent for "on"; lit blue is the one "on".
- **Don't** put a raised card inside a rack or a card inside a card; wells are recesses.
- **Don't** call the app official or use FL Studio's names, logos or skins.
