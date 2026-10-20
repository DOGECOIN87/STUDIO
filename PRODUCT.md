# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Music makers in the Audius community: producers and artists who already upload to Audius and want to sketch, chop and arrange stems in a browser, on a desktop, a tablet or a phone (the owner tests on a Samsung Galaxy Note 3, 360×640 CSS px). Many know desktop DAWs and expect their layout and shortcuts.

## Product Purpose

Audius Studio (https://audius-studio.online) is a browser DAW: load stems, arrange them on a playlist, slice and edit clips, program drums and melodies, mix with EQ and effects, and export WAV, with no install and no account. Success is a producer finishing an idea in the browser on whatever screen they have, without the layout fighting them.

## Positioning

An unofficial, community-built studio for the Audius community, made by a member of that community. It is not an official Audius product: never call it official or imply Audius made, owns or endorses it.

## Operating Context

- Sessions are long and hands-on: dragging clips, tapping pads, riding faders while audio plays. Screens range from 4K monitors to a 360px-wide phone in either orientation.
- Workflow and window model follow familiar desktop DAWs (FL Studio is the owner's layout reference, in `docs/design-reference/`): a tool bar with transport, a library on the left, a step/channel rack, a piano roll, a playlist, and a mixer with effect slots. Shortcuts: F5 Playlist, F6 Channel Rack, F7 Piano Roll, F9 Mixer, Alt+F8 Library.
- Static hosting on Cloudflare Pages; there is no server API in production.

## Capabilities and Constraints

- Web Audio engine; built-in demo session ("Untitled", 138 BPM, 5 re-synthesized stems from the owner's own session file — see `tools/flp-import/`); uploads (WAV, MP3, FLAC, OGG, M4A); clip slice, slip, trim and paint; step sequencer; piano roll; 10-band parametric EQ and FX mixer (Master Limiter, $AUDIO Multiband Clipper); Clip Inspector; Trellis 8×8 pad dock; WAV master and stem export; project save/load (localStorage `audius_studio_projects_v1` and `.dawproj.json`).
- Vanilla HTML, CSS and ES-module JavaScript in `app/public` (no build step). The playlist is drawn on a canvas.
- Default first view: Library + Playlist only, with the Mixer and Trellis closed. Every panel has a close (✕) button; delete actions are one click.
- Keep the 3-column desktop layout, 1:1 alignment between track headers and playlist lanes, the five windows plus the Trellis dock, and the keyboard mappings.
- Everything fits in one view: no horizontal page scroll and no sideways-scrolling strips in the bars, at any size from 320px wide up to 4K.
- Several themes (Audius Signature Dark default, Neue Dark, Day, Matrix, Trending Blue, Gold & Amethyst, Underground Neon, Platinum Slate, Silver Ice) and official Audius wallpapers.

## Brand Commitments

- Name: **Audius Studio**; domain `audius-studio.online`.
- Follow https://brand.audius.co/: official Audius logos and `$AUDIO` assets in `app/public/assets/audius/` (white single-colour lockup on dark backgrounds, full colour only on light ones; wordmark always with the glyph), Audius colours, and the Audius Harmony font Avenir Next LT Pro.
- Use FL Studio for layout and behaviour only: never its names ("FL Studio", "Fruity", "Image-Line"), logos, icons, skins, knob graphics or plugin names.
- Icons are Lucide (ISC), inlined as an SVG sprite.

## Evidence on Hand

- Official Audius logos, tier badges and wallpapers in `app/public/assets/audius/`.
- Layout reference screenshots and notes in `docs/design-reference/` (reference only, never shipped).
- No testimonials, user counts or partnerships exist; do not invent them.

## Product Principles

1. The work area comes first: tracks, clips and controls get the space, chrome stays compact.
2. Familiar to DAW users: standard window roles, shortcuts and controls, so nothing needs explaining.
3. Works on every screen, phone included, with nothing clipped, overlapping or sliding sideways.
4. Clearly Audius-community, clearly unofficial.

## Accessibility & Inclusion

- Readable text of 15–16px, including on a 360px phone.
- 44×44px touch targets on touch devices; multi-touch on pads and faders keeps working.
- Respect reduced motion (keep a gentle alternative rather than removing feedback) and keep visible keyboard focus.
