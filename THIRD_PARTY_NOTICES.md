# Third-party notices

## Lucide icons

The inline SVG icon sprite in `app/public/index.html` uses icons from [Lucide](https://lucide.dev) v1.59.0 (`lucide-static`), distributed under the ISC License:

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## @audius/harmony — Avenir Next LT Pro webfonts and theme values

`app/public/audius-fonts.css` is the six Avenir Next LT Pro faces (weights 100 / 400 / 500 / 600 / 700 / 900) from the Audius design system package [`@audius/harmony`](https://github.com/AudiusProject/apps/tree/main/packages/harmony) v0.5.3, file `packages/harmony/src/foundations/typography/avenir.css`, taken from `DOGECOIN87/apps@874efb690fb6ee68696630e4271dcc305b53fe9c` and minified. The base64 payloads are byte-identical to the upstream file (SHA-256 digests of all six faces match).

Colour values in the `amoled` (Audius Neue Dark), `forest` (Matrix) and `daylight` (Audius Day) blocks of `app/public/styles.css` are taken from the same package's `foundations/color/primitive.css` themes `default-dark`, `matrix` and `day`. Only colour *values* are reused; no Harmony code, component, build pipeline or CSS file is copied or shipped.

The `apps` repository is licensed Apache-2.0; the `@audius/harmony` package declares ISC. Both are reproduced here:

```
ISC License

Copyright (c) Audius and the @audius/harmony contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

```
Apache License, Version 2.0 (the `apps` repository)

Copyright (c) Audius

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations
under the License.
```

**Note on the typeface itself:** Avenir Next LT Pro is a commercial design by Linotype/Monotype. Audius redistributes these webfonts in Harmony and publishes them on brand.audius.co for Audius-branded use, which is the basis for our use. The licence of the *font design* is separate from the licence of the *code* above and is not granted by it. This app is an unofficial, community-built project and is not an Audius product.

## lamejs (MP3 encoder)

MP3 export uses [lamejs](https://github.com/zhuker/lamejs), a JavaScript port of the [LAME](https://lame.sourceforge.io/) MP3 encoder, shipped unmodified as its own file, `app/public/vendor/lame.min.js`. It is licensed under the GNU Lesser General Public License (LGPL); the LAME project's licence notes are in `app/public/vendor/LAME-LICENSE.txt`. STUDIO loads it as a separate script and does not change it, so it can be replaced with another build of the library.

## LMN-3 DAW (reference only, no code used)

STUDIO understands the LMN-3 MIDI controller (`app/public/lmn3-controller.js`). Its encoder, button and octave message numbers follow the [LMN-3 DAW](https://github.com/FundamentalFrequency/LMN-3-DAW) by Fundamental Frequency (fork: `DOGECOIN87/LMN-3-DAW`), and the button behaviour mirrors that app's track view. LMN-3 DAW is GPLv3. No LMN-3 source code is copied, translated or included. Only the controller's MIDI message numbers, an interface needed to work with the hardware, come from it.

## Audius API

The Browse Audius panel (`app/public/audius-client.js`) reads the public Audius API at `https://api.audius.co/v1`. STUDIO is a community-built app, not an official Audius product. It previews tracks through Audius streaming and imports only tracks and stems that their artists made downloadable.
