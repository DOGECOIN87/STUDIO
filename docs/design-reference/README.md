# Design reference: FL Studio layout (inspiration only)

These screenshots show the **layout and interaction structure** the owner wants Audius Studio to follow. They are reference material only:

- Never ship them or copy their artwork, skins, knob graphics, icons, fonts or names ("FL Studio", "Fruity …", "Soundgoodizer", "Maximus", …) into `app/public`.
- The look stays Audius: brand colours, Avenir Next, and the official logos in `app/public/assets/audius/`, following https://brand.audius.co/.
- Audius Studio is an unofficial, community-built app, and nothing in it may imply it is an Audius or Image-Line product.
- This folder sits outside `app/public`, so the Cloudflare deploy never publishes it.

## Saved screenshots

| File | What to take from it |
|---|---|
| `01-mixer-strips-context-menu.jpg` | **Right-click (long-press on touch) context menus:** grouped sections with grey header rows (Mixer tracks · Routing · Group · Layout), right-aligned shortcuts (F2, Ctrl+E, S, Alt+S, Alt+←/→), submenu arrows, checkmarks, greyed-out disabled items. **Mixer strips:** narrow strips with number and name, pan knob, large fader, peak meter, and a compact per-strip effects list. Selected strips are outlined. **Top strip:** pattern selector, `1:01:00` song-position display, tempo `130.000`, snap dropdown and window-toggle icon buttons in one compact band. |
| `02-mixer-docked-fx-slots-routing.jpg` | **Vertical (rotated) track names** in mixer strips, so names never truncate. Numbered strip headers are colour-coded by group. A **docked effects panel on the right** for the selected track: input selector, 10 effect slots each with an on/off light and a mix knob, a mini EQ graph with 3 faders, and output selector. **Routing cables** from the selected track. |
| `03-parametric-eq-window-annotated.jpg` | **Plugin/effect window:** title bar with menu ▾, previous/next ◂▸ and close ×. A graph with named bands across the top (LOW BASS · BASS · LOW MID · MID · UPPER MID · PRS · TREBLE), a 20 Hz–10 kHz frequency scale, a dB scale, 7 colour-coded band columns with mini faders, FREQ/BW knob rows, and HQ / MONITOR / COMPARE buttons. Applies to Audius Studio's 10-band parametric EQ. |
| `04-parametric-eq-band-nodes-hint-bar.jpg` | **Numbered, draggable band nodes** on the EQ curve. A **hint bar** under the menu shows the live value of the control being touched (`-18.0dB 40Hz 61%  Band 1 (low shelf)`). The compact menu bar sits beside the transport and tempo. |
| `05-mixer-options-menu-layout-preset.jpg` | **Window options menu** opened from a ▾ button in the window's title bar, with sectioned options and File submenus. A **layout preset picker** ("Compact 2") switches strip width and density. |

### Effect and instrument windows

These screenshots apply to Audius Studio's FX chain (Parametric EQ, Master Limiter, $AUDIO Multiband Clipper), the Clip Inspector and any instrument panels.

| File | What to take from it |
|---|---|
| `11-synth-window-preset-browser-sections.jpg` | **Preset browser built into the window:** tabs (Packs · Free · Store), a pack list, a preset list with ★ favourites, ALL · RECENT · FAVOURITES filters, pack artwork, TAGS and search. **Sectioned control panel:** every section has a header tab with a power (bypass) toggle and a lock icon (Analysis, Macros, Pitch, Filter, Envelopes, Master Filter, Delay, Reverb, Limiter, Out). Other details: a row of 8 labelled vertical **macro sliders**, **A-H-D-S-R envelope knob rows** for the filter and volume, mode dropdowns under the sections (Low pass 12, Ping pong, Custom), and an output fader. Title bar: Presets ◂ ▸, minimise, close. |
| `12-granular-sections-waveform.jpg` | Sections (GRAINS · EFFECTS · TRANSIENTS · TIME) each have a tab-style header. Knobs carry their label **below**. **Radio-button groups** (OFF / USE REGIONS / DETECT) and a LOOP toggle, a HOLD button and a "KEY TO" dropdown. A **waveform display** sits along the bottom with load-file and slice-count controls. Good pattern for stem/clip editing in the Clip Inspector. |
| `13-delay-window-classic.jpg` | A compact, single-row effect window: INPUT (pan, vol), FEEDBACK (Normal / Invert / Ping-pong, vol, cut), TIME (time, offset), DRY (vol). Title bar with ◂ ▸ and ×. |
| `14-delay-window-modern-presets.jpg` | The same effect in a newer skin. **Knobs show a value arc** and tick marks, radio buttons are lit, there's a gear menu, and the title bar has a **Presets ◂ ▸** browser plus minimise and close. |
| `15-reverb-visual-knob-arcs-faders.png` | A **visualisation panel** (3D room) beside the controls, a MID/SIDE switch, H.CUT and L.CUT, DELAY with TEMPO sync, SIZE · MOD · DIFF · SPEED, and BASS · DEC · CROSS · DAMP. **DRY / ER / WET vertical faders** and a SEP knob. The knob arcs are coloured by amount. |

Effect-window rules to carry over:
- Every effect opens in a window with a title bar: name + slot, preset ◂ ▸, a menu, minimise and close.
- Controls are grouped into labelled sections, each with a bypass toggle.
- Every knob has its label below it and a value arc; while you drag or hover, the hint bar shows the exact value.
- Modes are radio groups or dropdowns, not hidden settings.
- Each window has a visualisation (curve, meter, waveform) where it helps.
- The window fits inside the viewport, and on phones it opens full-screen as a sheet.

## Described only (owner's screenshots; add the files here if available)

| Suggested file | What it shows / what to take from it |
|---|---|
| `06-mixer-wide-vertical-names.jpg` | Mixer in the "Wide" layout preset. A dB ruler runs down the left, the Master strip is separated from the inserts, and strip names are vertical (Kick, ClapSnare, Hats, Snare, DRUMS, Snare Processed, Insert 7…). The selected strip is outlined in the accent colour, with routing arrows at the bottom. |
| `07-classic-channel-rack-mixer-sidechain.jpg` | Classic layout. A small floating controller plugin window, the channel rack (Pattern 1, swing slider, rows of 16 step buttons per channel), and a "Mixer – Sidechain" window. That window has its strips, a tall master level meter, and a right-hand IN / 8 slots / OUT effects panel. |
| `08-full-screen-classic.jpg` | Whole-application screenshot in which **everything fits one screen**. One toolbar row along the top: menu, song position, transport, tempo, pattern, hint text, window buttons. A browser tree runs down the left; the channel rack is top-centre, a plugin window floats over it, the playlist is top-right with colour-coded tracks and clips, and the mixer with its effects panel is bottom-right. |
| `09-numbered-window-map.jpg` | Numbered diagram of the windows tiling the screen: pattern/channel rack, playlist, plugin windows, piano roll, mixer and the mixer effects panel. |
| `10-annotated-main-layout.jpg` | **The primary layout target.** The labelled full-screen layout explained below. |
| `16-multiband-maximizer.jpg` | Dynamics window. Left: a **transfer-curve graph** (input dB vs output dB, draggable nodes). Right: a **live waveform / gain-reduction display** with a threshold line. A colour-coded band selector (LOW · MID · HIGH · MASTER) with SOLO, and an ON / COMP OFF / MUTED / OFF switch. Knobs: PRE / GAIN / POST and THRES / SAT / CEIL, plus ATT / REL / SUSTAIN with numeric curve steppers, a PEAK/RMS switch, crossover LOW / FREQ / HIGH with 12 dB/24 dB slope switches, and LOW CUT. MONITOR / BANDS tabs and a SPEED slider. **Use for the $AUDIO Multiband Clipper and the Master Limiter.** |
| `17-three-oscillator-synth.jpg` | Three oscillator rows, each with a **waveform icon picker** (sine, square, saw, triangle, noise, custom), phase-offset and detune sliders, a coarse knob showing its **numeric value inside the knob**, fine, pan and volume. A bottom options bar holds AM, HQ and phase-random. |
| `18-filter-with-modulation-editor.jpg` | 8 numbered preset slots with lights. IN / FILTER / WS / OUT sections with radio groups for filter modes. A **target tab row** (PAN · VOL · CUT · RES · LOW · BAND · HIGH …) above a **source tab row** (PAT · LFO · MOD X · MOD Y), driving an **envelope editor with draggable curve nodes** and loop/sustain markers. An **XY modulation pad** with SMOOTH and ATT/REL, a preset name and details box, and gear / menu / help icons. |
| `19-fm-synth-matrix-keyboard.jpg` | **Page tabs across the top** (MAIN · OP1–6 · FILTER1–3 · FX), with the active tab highlighted. ADSR fader groups, an XY modulation pad, an EQ with band-shape buttons, and DRAFT/RENDER quality settings. A **modulation matrix grid** of knobs. Preset description text, and an **on-screen piano keyboard** with octave labels (C3…C7) along the bottom. |
| `20-channel-and-plugin-wrapper-windows.jpg` | Two windows side by side under the toolbar: channel settings with an on-screen keyboard, and a plugin wrapper (Settings / Processing tabs, plugin info, MIDI ports, preset load/save, options checkboxes). Between them, a list of open instruments. |
| `21-channel-settings-page.jpg` | **Per-channel settings page.** Header row: ON · PAN · VOL · PITCH · RANGE · TRACK. Tab icons switch between the plugin, settings and misc pages. Labelled sections: Levels adjustment (pan, vol, mod X/Y), Polyphony (max, porta, mono), Time (gate, shift, swing), Key tracking, Group (cut / cut by), Arpeggiator (time, gate, range, repeat, chord, slide), and Echo delay / fat mode (feed, pan, echoes, ping-pong). A **root-note keyboard** with the root key highlighted, plus Reset, enable main pitch and fine tune. A good model for Audius Studio's per-stem / per-channel inspector. |
| `22-additive-synth-ab-parts.jpg` | A dense sectioned instrument with an **A/B part switch**, ENV · IMG · FX · ADV tabs, modulation-target dropdowns (target → source), an LFO/envelope editor on a grid, an XYZ pad, an **info box** that explains what each macro does, and an on-screen keyboard. |

Apply the window patterns from 11–22 only where Audius Studio already has a matching feature: FX chain slots, EQ, limiter/clipper, Clip Inspector, Piano Roll keyboard, Step Rack swing. Don't build new instruments unless the owner asks.

## The target layout (from reference 10)

```
┌──────────────────────────────── TOOL BAR (2 thin rows, full width) ─────────────────────────────────┐
│ FILE EDIT ADD PATTERNS VIEW OPTIONS TOOLS HELP │ PAT/SONG ▶ ❚❚ ■ ● │ 125.000 │ 2:01:08 │ scope │ CPU/RAM │ icons │
│ project name · HINT BAR (live value / help)    │ master vol/pitch  │ snap · tools · pattern ▾ · window toggles │
├──────────────┬──────────────────────────────────────────┬───────────────────────────────────────────┤
│ BROWSER /    │ CHANNEL RACK (step sequencer)            │ MIXER (strips, vertical names) │ FX SLOTS │
│ LIBRARY tree │                                          │                                │ panel    │
│ (full height)├──────────────────────────────────────────┴───────────────────────────────────────────┤
│              │ PLAYLIST (largest area, spans the rest; track headers left, clips right)              │
│              │                    ┌──────── PIANO ROLL (floating/docked over playlist) ───────┐       │
└──────────────┴────────────────────┴───────────────────────────────────────────────────────────┴───────┘
```

How this maps to Audius Studio:

- **Browser → Audius Library / Stems Browser**
- **Channel Rack → Step / Channel Rack** (F6)
- **Piano roll → Piano Roll** (F7)
- **Playlist → Playlist / Arrangement** (F5)
- **Mixer + FX slots → Studio Mixer + FX chain / Clip Inspector** (F9)
- **Library toggle:** Alt+F8
- **Trellis 8×8 pad dock:** stays a collapsible dock.

The owner's default first-load view is **Library + Playlist only**. The other windows open from the toolbar's window buttons or the shortcuts, and arrange into this grid without overlapping or overflowing.

On phones and small tablets, show one main window at a time with a window switcher, and keep the transport always visible. Collapse the toolbar into a "⋯" menu rather than letting it slide sideways.
