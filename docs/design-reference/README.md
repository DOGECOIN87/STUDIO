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

## Described only (owner's screenshots; add the files here if available)

| Suggested file | What it shows / what to take from it |
|---|---|
| `06-mixer-wide-vertical-names.jpg` | Mixer in the "Wide" layout preset. A dB ruler runs down the left, the Master strip is separated from the inserts, and strip names are vertical (Kick, ClapSnare, Hats, Snare, DRUMS, Snare Processed, Insert 7…). The selected strip is outlined in the accent colour, with routing arrows at the bottom. |
| `07-classic-channel-rack-mixer-sidechain.jpg` | Classic layout. A small floating controller plugin window, the channel rack (Pattern 1, swing slider, rows of 16 step buttons per channel), and a "Mixer – Sidechain" window. That window has its strips, a tall master level meter, and a right-hand IN / 8 slots / OUT effects panel. |
| `08-full-screen-classic.jpg` | Whole-application screenshot in which **everything fits one screen**. One toolbar row along the top: menu, song position, transport, tempo, pattern, hint text, window buttons. A browser tree runs down the left; the channel rack is top-centre, a plugin window floats over it, the playlist is top-right with colour-coded tracks and clips, and the mixer with its effects panel is bottom-right. |
| `09-numbered-window-map.jpg` | Numbered diagram of the windows tiling the screen: pattern/channel rack, playlist, plugin windows, piano roll, mixer and the mixer effects panel. |
| `10-annotated-main-layout.jpg` | **The primary layout target.** The labelled full-screen layout explained below. |

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
