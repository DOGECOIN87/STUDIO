# Audius upstream forks — what is actually applicable to Audius Studio

> Question answered: **can `DOGECOIN87/pedalboard`, `DOGECOIN87/api2` and `DOGECOIN87/apps` be applied usefully to this DAW?**
> Short answer: **two of the three, yes — and one of them (the SDK in `apps`) unlocks the feature this product is missing.** `pedalboard` is essentially not applicable.
>
> Researched 2026-10-21 against `main` of each fork and its upstream parent. Everything marked **[verified]** was executed or read in this workspace; everything marked **[live check]** cannot be verified from this sandbox (it has no route to `api.audius.co`) and needs one browser test on the real site.

---

## 1. What each fork actually is

| Fork | Reality | Browser-useful? |
|---|---|---|
| [`DOGECOIN87/apps`](https://github.com/DOGECOIN87/apps) (← `AudiusProject/apps`) | The Audius client monorepo: `packages/sdk` (`@audius/sdk`), `packages/web` (React app), `packages/mobile`, `packages/common`, `packages/harmony` (design tokens), `packages/libs`, `packages/embed` | **Yes — `packages/sdk` and `packages/harmony`** |
| [`DOGECOIN87/api2`](https://github.com/DOGECOIN87/api2) (← `AudiusProject/api`) | The Go **discovery node**: REST `/v1` API (`api/server.go` routes), SQL (`api/dbv1/`), and the full OpenAPI spec `api/swagger/swagger-v1.yaml` (542 KB) | **Yes — as a specification, not as a service.** We consume the *public* API; we never run this |
| [`DOGECOIN87/pedalboard`](https://github.com/DOGECOIN87/pedalboard) (← `AudiusProject/pedalboard`) | **Not** Spotify's audio-DSP library despite the name. It is Audius's *server-side plugin monorepo*: `notifications`, `staking`, `trending-challenge-rewards`, `solana-relay`, `sla-auditor`, `archiver`, `crm`, `publish-scheduled-releases`, `backfill-audio-analyses`, `anti-abuse-oracle`, `verified-notifications` + `packages/basekit` (App/db/tick scaffolding). All Node services that sit next to a discovery DB, Redis and delegate keys | **No.** Nothing here runs in a browser, and we have no DB, no indexer and no delegate wallet |

**Important naming trap:** `pedalboard` sounds like it would give us audio effects. It does not — our FX story (WASM plugin host, Mammoth synth, Gate Shaper) is unrelated and stays as-is.

---

## 2. Verified facts that decide the design

These were measured here, not guessed.

**The SDK ships a no-build-step browser bundle.** `@audius/sdk@17.0.0` (Apache-2.0) publishes `dist/sdk.min.js`: **1,057,595 bytes raw / 247,023 bytes gzipped**, a single IIFE that ends with `window.audiusSdk = …`. **[verified]** by executing the published tarball in Node with a `window` shim:

```
window.audiusSdk typeof: function
services: challenges, coins, comments, dashboardWalletUsers, developerApps, events,
          explore, genres, notifications, oauth, playlists, prizes, resolve, rewards,
          search, solanaWallet, tips, tokenStore, tracks, uploads, users, wallets
```

That matters because this repo is deliberately build-free (`app/public` is vanilla ES modules, per `PRODUCT.md` / `CLAUDE.md`). A `<script src="vendor/audius-sdk.min.js">` injected *on demand* fits without touching that rule.

**It is old-browser clean.** Syntax probe of `sdk.min.js` **[verified]**: no `findLast`, no `findLastIndex`, no `.at(`, no `structuredClone`, no `Object.hasOwn`, no `??=`/`||=`, no `Array.fromAsync`, no dynamic `import()`. It does use `AbortController`, `WebSocket`, `crypto.subtle`, `BigInt` — all present in Chrome 95 (Galaxy Note 3) and Safari 14, so the repo's browser floor is respected.

**Read-only access needs no API key at all.** `packages/sdk/src/sdk/types.ts` has a `ConfigWithAppNameSchema`: `audiusSdk({ appName: 'Audius Studio' })` is a valid config. **[verified]** — with `fetch` stubbed to record URLs, that instance issued:

```
GET https://api.audius.co/health_check
GET https://api.audius.co/v1/tracks/remixables?limit=2&api_key=&app_name=Audius%20Studio
```

So the *browse-and-import* half of the integration can ship with zero setup, and an API key becomes optional (higher rate limits) rather than a blocker.

**Constructing the SDK touches the network immediately.** `new StorageNodeSelector(...)` calls `updateAvailableStorageNodes()` inside the constructor. **[verified]**: with the network blocked the SDK object still constructs, and the failure surfaces as an *unhandled rejection*. Conclusion: the SDK must be **lazy-loaded on first open of the Audius panel**, and we must attach an `unhandledrejection` guard so a dead network can never take the DAW down. The DAW itself must never import it at page load.

**`apiEndpoint` override is not a reliable proxy knob in 17.0.0.** Setting `apiEndpoint` still hit `https://api.audius.co/health_check`, and the calls then failed internally (`Cannot read properties of undefined (reading 'network')`) in the harness. **[verified]** → if we ever need a same-origin proxy, do it at the network layer (`_redirects`, a Pages Function, or the local Node server), not by reconfiguring the SDK.

**The discovery node allows cross-origin browser calls.** `api2/api/server.go:366` is `app.Use(cors.New())`, and fiber v2's default is `AllowOrigins: "*"` (`gofiber/fiber/middleware/cors/cors.go:72` and `:100-102`). **[verified from source]** → a static site on Cloudflare Pages can call `/v1/...` directly with plain `fetch`. **[live check]** one devtools confirmation from the real site.

**Audio bytes are the one open CORS question.** `api2/api/dbv1/media_link.go` builds stream links as `https://<storage node>/tracks/cidstream/<cid>?signature=…` (signed, with `mirrors[]`). Storage-node CORS headers are *not* in any of these three repos (creator-node lives in `audius-protocol`), so whether `fetch()` on that URL is allowed from our origin is unknown. **[live check]** — and there are three fallbacks, in order of preference:

1. Cloudflare Pages Function that fetches the audio server-side and streams it back from our origin (our `app/public/_headers` already sets `Access-Control-Allow-Origin: *`).
2. `app/public/_redirects` proxy — works only for a *fixed* host, so it can proxy `api.audius.co` but not per-track storage nodes.
3. Ubuntu/desktop path: a new `POST /api/imports/fetch?url=` on the zero-dependency server (`app/api/router.mjs` already owns an imports inbox at `/api/imports/*`) fetches server-side, where CORS does not exist. Only allow `*.audius.co` hosts.

**Uploads return BPM and key.** `packages/sdk/src/sdk/api/uploads/UploadsApi.ts` → `createAudioUpload({ file, userId })` resolves to `{ trackCid, previewCid, origFileCid, origFilename, duration, bpm, musicalKey }`, the last two from the storage node's `audio_analysis_results`. Publishing a bounce therefore *also* gives us Audius's measured BPM/key to compare against the session's.

**The DN can mediate writes — no wallet needed.** `api2/api/server.go:561` registers `POST /v1/tracks` behind `requireAuthMiddleware` + `requireWriteScope`, and `TracksApi.createTrack` in the SDK falls back to `super.createTrack(...)` (the DN endpoint) whenever there is no `entityManager`. **[verified from source]** → an OAuth login is sufficient to publish; we do not have to implement Solana/Ethereum signing in the browser. **[live check]** that a third-party OAuth app with `write` scope is actually permitted on `POST /v1/tracks`.

---

## 3. What we would take, ranked

### ① Read-only Audius browser in the Library — from **api2**'s swagger *(no SDK, no key)*

Endpoints worth wiring, all confirmed in `api2/api/swagger/swagger-v1.yaml` and the route table in `api2/api/server.go`:

| Endpoint | Why a DAW wants it |
|---|---|
| `GET /v1/tracks/search` with `query`, `key[]`, `bpm_min`, `bpm_max`, `genre`, `only_downloadable`, `has_downloads` | "Find material at **my session's tempo and key**" — the single most DAW-shaped query Audius offers |
| `GET /v1/tracks/remixables` | "Tracks that have stems available for remixing" (spec wording) — a ready-made sample crate |
| `GET /v1/tracks/{id}/stems` → `{id, parent_id, category, cid, user_id, orig_filename, blocknumber}` (`api/v1_track_stems.go`) | Load a track's **official stems** straight onto separate playlist lanes |
| `GET /v1/tracks/{id}/stream?no_redirect=true` | Signed audio URL + mirrors, for import into the stem pool |
| `GET /v1/tracks/trending`, `/trending/underground`, `/latest`, `/feeling-lucky`, `/most-shared` | Browse without typing |
| `GET /v1/resolve?url=` | Paste any `audius.co/…` link → track/user/playlist |

Track objects also carry `bpm`, `is_custom_bpm`, `musical_key`, `is_custom_musical_key` and `audio_analysis_error_count` (swagger `track:` schema at line 15055, fields at 15233–15241). Importing a track can therefore **set the session tempo** (`setProjectInfo`) and show the key in the clip inspector — our demo session is 138 BPM, so tempo-matched search is immediately useful.

Implementation shape: one new module `app/public/audius-client.js` (~300 lines, plain `fetch`, no dependency), a collapsible **Audius** section in the existing Library panel, and graceful `apiError("blocked", …)` classification when offline. Effort **≈ half a day**. The only unknown is the audio-byte CORS question above.

### ② Publish the bounce (and stems) to Audius — from **apps**' `packages/sdk`

The export dialog (`executeExport()` in `app/public/app.js`, ~line 5415) already renders a master WAV or one WAV per unmuted track. Both are exactly what Audius wants:

- `uploads.createAudioUpload({ file, userId })` → CID + analysed `bpm`/`musicalKey`
- `tracks.createTrack({ audioFile, metadata, userId })`. The verified `create_track_request_body` (`api2/api/swagger/swagger-v1.yaml:11218`) accepts `title, genre, mood, description, tags, bpm, musical_key, release_date, track_cid, orig_file_cid, orig_filename, duration, cover_art_sizes, preview_cid, preview_start_seconds, is_downloadable, is_unlisted, is_stream_gated, stream_conditions, download_conditions, field_visibility, placement_hosts, stem_of { category, parent_track_id }, remix_of, isrc, iswc, license, no_ai_use, territory_codes` plus the DDEX fields. So the session supplies the tempo and key (`release_date` is how a scheduled release is expressed), and the track *response* schema reports back `is_custom_bpm` / `is_custom_musical_key` / `is_scheduled_release` (swagger ~line 15233)
- **`remix_of` closes the loop:** import a track's stems (①) → chop and bounce → publish the result as a *remix of that track*. The whole Audius → Studio → Audius round trip is expressible in two API calls
- `oauth.login()` / `oauth.handleRedirect()` — PKCE, tokens persisted by `TokenStoreLocalStorage`
- Per-stem publishing uses the official categories from `packages/sdk/src/sdk/types/StemCategory.ts`: `INSTRUMENTAL, LEAD_VOCALS, MELODIC_LEAD, PAD, SNARE, KICK, HIHAT, PERCUSSION, SAMPLE, BACKING_VOX, BASS, OTHER`. Our per-track stem export maps onto these one-for-one — **export 5 stems → publish a parent track + 5 remixable stems** is a genuinely differentiated feature for the Audius community.
- Scheduled releases are real backend behaviour (`pedalboard/apps/publish-scheduled-releases`), so a "publish at" date is legitimate, not speculative.

Costs: vendor `sdk.min.js` (241 KB gz) into `app/public/vendor/`, add an Apache-2.0 entry to `THIRD_PARTY_NOTICES.md`, and lazy-load it. Effort **≈ 1–2 days** after ①, and it needs the owner to create an app at `api.audius.co/plans` (API key + client ID + redirect URI `https://audius-studio.online/…`). **The key and client secret are typed into the app's own settings and kept in `localStorage` — never pasted into chat** (`HANDOVER.md` §2 rule 4).

### ③ Audius operations in the DAW API — from **api2** + our existing api-anything idiom

This repo already exposes the workstation as 56 operations (`app/api/operations.json`, `sites/audius-studio.json`). Adding `audiusSearch`, `audiusRemixables`, `audiusTrackStems`, `audiusImport`, `audiusPublish` as tier-3 bridge handlers means an agent can do:

```sh
api-anything call audius tracksRemixables limit=5 --allow-writes
api-anything call audius-studio audiusImport trackId=D7KyD what=stems --allow-writes
```

Optionally generate `sites/audius.json` from `api2/api/swagger/swagger-v1.yaml` so api-anything can speak to Audius directly next to our own spec (note: api-anything's own site specs are *captured from traffic*; ours would be *authored from OpenAPI*, which needs saying out loud in the file). Effort **≈ 2–3 h** once ① exists.

### ④ Harmony design tokens — from **apps**' `packages/harmony`

**Harmony is Audius's own design system.** `packages/harmony/src/foundations/` emits the whole visual language as **plain CSS custom properties** (no build step, no runtime, drop-in for a static site):

| File | Contents |
|---|---|
| `color/primitive.css` (446 lines) | ~40 colour vars × 8 themes: `:root` (day), `day`, `classic-light`, `classic-dark`, `default-light`, `default-dark` (the "Neue" system), `dark`, `matrix`. Each theme = primary/secondary ramps (`p-100…p-500`, `s-100…s-500`), a neutral ramp `n-25 … n-950`, plus `white`, `background`, `blue`, `orange`, `red`, `green`, `gradient`, `trending-blue`, `glass-overlay` |
| `color/semantic.css` (27 lines) | Role tokens over the primitives: `--harmony-text-heading/-default/-subdued/-disabled`, `--harmony-bg-default/-surface-1/-surface-2/-white`, `--harmony-border-default/-strong/-negative`, `--harmony-focus` |
| `typography/fonts.css` | Type scale `--harmony-font-2xs…9xl` (10–96 px), line heights, weights (100/400/500/600/700/900), and the font stack `'Avenir Next LT Pro', 'Helvetica Neue', …` |
| `typography/avenir.css` (242 KB) | The six Avenir Next LT Pro faces as base64 woff2 |
| `spacing/spacing.css` | 4 px grid: `--harmony-unit-1…24`, `--harmony-spacing-xs…5xl` |
| `corner-radius/corner-radius.css` | `xs 2px → 2xl 32px` |
| `motion/motion.css` | `--harmony-quick 0.07s`, `--harmony-expressive 0.18s`, `--harmony-hover/press 0.12s cubic-bezier(0.44,0,0.56,1)`, `--harmony-calm 0.5s` |
| `shadows/shadows.css`, `layers/layers.css` | 5 shadow presets; z-index layers `0 / 10000 / 20000 / 30000` |

#### We already consume Harmony — one file, byte-for-byte

`app/public/audius-fonts.css` (241,960 B) **is** `packages/harmony/src/foundations/typography/avenir.css` (242,079 B) with a different header comment and the whitespace minified. **[verified]** — all six base64 woff2 payloads have identical SHA-256 digests (`588288aa…`, `9a638b44…`, `7663ee06…`, `c7a0ae10…`, `964343e1…`, `c33ce228…`), weights 100/400/500/600/700/900. It is not credited in `THIRD_PARTY_NOTICES.md`, which currently lists only Lucide. That is a one-paragraph fix. (Separately: Avenir Next LT Pro is a commercial typeface that Harmony redistributes; we use it under `PRODUCT.md`'s brand.audius.co instruction — worth knowing, not worth changing.)

#### Two of our themes are already exact Harmony mappings

**[verified]** by comparing every value in `app/public/styles.css` against `primitive.css`:

| Our theme | Harmony theme | Status |
|---|---|---|
| `forest` ("Matrix") | `matrix` | **Exact.** `#010B06/#041308/#0A1F0D/#0F2F15/#123F1B/#166527` = `n-25/n-50/n-100/n-150/n-200/n-300`; `#0BD90B` = primary, `#3DF23D` = `p-500`, `#3EF56B` = `n-800`, `#9BFFA7` = `n-900`, `#34D561` = `n-700` |
| `daylight` ("Audius Day") | `day` | **Exact.** `#F6F5F7` = background, `#EFEFF1` = `n-100`, `#E7E7EA` = `n-150`, `#D6D5DB` = `n-200`, `#CC0FE0` = primary, `#D63FE6` = `p-100`, `#7E1BCC` = secondary, `#6C6780` = neutral |
| `audius-dark` (default) | `dark` (classic) | **Partial.** Neutrals are Harmony's (`#2F3348` = white, `#353A51` = `n-50`, `#3C425D` = `n-100`, `#444B69` = `n-150`, `#A6AAC0` = `n-600`, `#F9344C` = red, `#15D864` = light-green), but `--bg-darkest #1B1C2A`, `--bg-panel #242538`, `--bg-header #2A2E43` are invented steps (Harmony: background `#202131`, `n-25 #30354a`), and the accent is the *day* magenta `#CC0FE0` rather than dark's `#d767e1` (which we do carry as `--accent-orange-bright`). A deliberate hybrid — probably keep it |
| `amoled` ("Neue Dark") | `default-dark` | **Drifted, and mislabelled.** `styles.css` comments it "Official Audius Neue Dark (from @audius/harmony defaultDarkPrimitives)" and `index.html:253` advertises "#0F0F0F Pitch Black & #806AD8 / #C67CFF", but the block uses `#0A0A0E / #14141B / #1F1F2B / #1A1829 / #26233A / #352F52 / #2E2B44` against Harmony's `#000000 / #0f0f0f / #141414 / #1f1f1f / #292929 / #333333 / #292929`, muted text `#9E9EAE` vs `n-600 #8f8f8f`, and accent `#A74CFF` — which is `default-light`'s *secondary*, not `default-dark`'s primary `#806ad8`. Only `#C67CFF` (= secondary) is right |

So the honest scope is small: **one theme is mislabelled and worth correcting**, the other three "official" ones are already right, and the rest are ours by design.

#### Two landmines if we copy Harmony CSS verbatim

1. **`semantic.css` uses `color-mix()`** — `--harmony-focus: color-mix(in srgb, var(--harmony-secondary) 70%, transparent)`. That is explicitly banned by `CLAUDE.md` and unsupported in Chrome 95 / Safari 14, so it must be precomputed (e.g. `rgba(198,124,255,0.7)` per theme).
2. **8-digit hex.** `:root`, `day`, `dark` and `matrix` write colours as `#cc0fe0ff`. `app.js` reads tokens straight into canvas (`syncCanvasTheme()` at `app.js:1256`, `--accent-orange` at `app.js:780`) and our `--cv-*` palette is `rgba()`, so any adopted value should be normalised to 6-digit hex / rgba rather than pasted as-is.

#### What is *not* worth taking

`packages/harmony` also carries React components, Emotion theming (`ThemeProvider.tsx`, `emotion.d.ts`), an icon set and Lottie JSON, and a rollup pipeline. We want only the emitted `.css` values — never the package.

**Status — partly shipped 2026-10-21.** Done: the `amoled` correction, the font/value attribution in `THIRD_PARTY_NOTICES.md`, and the full provenance map in [`docs/HARMONY_TOKEN_MAP.md`](HARMONY_TOKEN_MAP.md) — see `HANDOVER.md` §12 for the change and its verification (`tools/smoke.mjs` 91/91, api 36/36, wasm-fx 43/43, mammoth 108/108, midi-codec 35/35). Still open: the additive non-colour token layer (spacing / radius / motion / shadows / layers / type scale) and any re-mapping of the default `audius-dark` theme, both of which need a rendered layout pass this sandbox cannot do (no browser binaries available).

### ⑤ Not applicable — do not spend time here

- **All of `pedalboard`** except as reading: no browser surface, needs a discovery DB + Redis + delegate keys.
- `packages/web`, `packages/mobile`, `packages/libs`, `packages/embed`: React/React Native, bundlers, Redux — incompatible with a build-free static app. Read them for *behaviour* (their stem-upload flow, `packages/common/src/store/stems-upload/`) and copy nothing.
- Harmony's TypeScript token pipeline: we only want the emitted `.css` values.
- `api2` as a service: never run it; we are a client of the public network.

---

## 4. Constraints these must respect

1. **Unofficial positioning** (`PRODUCT.md`): the panel says "community-built, not an official Audius product"; no implication of endorsement.
2. **No build step, static hosting**: vendored file + ES module + plain `fetch`; SDK lazy-loaded only.
3. **Offline-first**: every Audius call is opt-in, wrapped, and classifies failure (`blocked` / `rate` / `auth`) instead of throwing into the UI; the DAW works identically with no network.
4. **Old browsers**: Chrome 95 / Safari 14 floor — the bundle passes that probe, and any new CSS must keep the existing restrictions (`CLAUDE.md`).
5. **Rate limits**: free plan is 10 req/s and 500 k req/month per key; `app_name`-only access is the lower tier → debounce search, cache the last result set in the panel, never poll.
6. **Licence**: `apps` and `api2` are Apache-2.0 → vendored `sdk.min.js` gets a notice in `THIRD_PARTY_NOTICES.md`; generated specs keep their source commit SHA.
7. **`?v=` bump** on `styles.css` / `app.js` whenever they change (`CLAUDE.md`).

## 5. Suggested order

| Step | Source | Effort | Needs from owner |
|---|---|---|---|
| 1. Audius browser + import (read-only, no key) | api2 swagger | ~0.5 day | one live CORS check in devtools |
| 2. Audio proxy if step 1's byte fetch is blocked | our repo | ~2 h | deploy decision (Pages Function vs `_redirects` vs local server fetch) |
| 3. Audius ops in the DAW API + `sites/audius.json` | api2 swagger | ~3 h | — |
| 4. Publish master (OAuth + `createTrack`) | apps SDK | ~1 day | API app: key, client ID, redirect URI |
| 5. Publish stems with categories + scheduled release | apps SDK | ~0.5 day | — |
| 6. Harmony token alignment | apps harmony | ~2 h | theme sign-off |

Steps 1 and 3 need nothing from anyone and are testable offline against a mock `/v1` server; steps 4–5 need the owner's API app and a live browser.
