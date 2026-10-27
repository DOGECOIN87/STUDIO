# Design reference (inspiration only)

The owner's mock-ups for STUDIO's look. They are reference material only:

- Never ship them, and never copy other products' artwork, skins, knob graphics, icons, fonts or names into `app/public`.
- The look stays Audius: brand colours, Avenir Next, and the official logos in `app/public/assets/audius/`, following https://brand.audius.co/.
- STUDIO is an unofficial, community-built app, and nothing in it may imply it is an Audius product.
- This folder sits outside `app/public`, so the Cloudflare deploy never publishes it.

### Owner's preferred style (AI-generated mock-ups the owner shared)

These are AI-generated STUDIO mock-ups, and the owner said: **"I like the version of the top buttons."** Treat `31` as the target **button language** for the whole app, starting with the tool bar. Treat `30` as mood only.

| File | What to take from it |
|---|---|
| `31-owner-liked-top-buttons.jpg` | **The button style to adopt.** The top bar sits in a rounded, softly raised navy panel. Each control is a separate rounded-rectangle button (radius about 12px) with a slightly lighter navy fill than its panel, a hairline light border, a faint top highlight and a soft shadow. Icons and labels are white and bold, sitting side by side with even padding. **PAT/SONG** is a segmented control on a darker inset track; the active segment is a magenta→violet gradient with a soft glow. **Play** is larger and lit, with a violet gradient and an outer glow. **Stop** and **⋯** use the plain button style. **Tempo** sits in a dark inset well, with the bright blue number and a stacked up/down stepper. **Meter** has an icon and a label. **Settings** is a square icon button. The second row holds equal-width icon+label buttons (Tools, More, Stems, Play, Step, Keys, Mix, Pads), and the selected one (Pads) has a cyan-blue lit border and glow. Section titles are spaced uppercase with a violet icon ("QUICK NUDGE & TRIM", "TRELLIS MULTI-TOUCH SLICE PADS"). Pads may borrow only the neon border in their track colour with a soft glow. **The mock-up is wrong to draw waveforms inside them:** in STUDIO these are pads you tap, not waveform displays, so never put waveforms, headphone/S/M chips or other clip-style content on the pads. |
| `30-owner-mood-desktop-studio.jpg` | Mood only, for a desktop layout in the same language: the transport row in raised button groups, a master meter, track rows with coloured left edges and icons, and an FX rack whose sections have power toggles and knobs with value arcs in each section's colour. Its pad area repeats the same mistake (waveforms on pads), so ignore that part. |

Keep Audius brand rules over the mock-ups: on dark backgrounds the Audius lockup stays white single-colour (the mock-ups' gradient glyph is not allowed there), and the type stays Avenir Next. Keep every constraint in `PRODUCT.md` too: 15px text minimum, 44px touch targets, nothing sliding sideways.
