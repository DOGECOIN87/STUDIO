# STUDIO DAW API

**The DAW, fully functional via an API — in the style of [api-anything](https://github.com/DOGECOIN87/api-anything).**

Teach an agent (or a script) the DAW once; after that it calls the workstation
like an API instead of driving a browser. Every call answers with the
api-anything envelope:

```json
{"ok":true,"class":"ok","tier":3,"data":{ ... },"ms":42}
{"ok":false,"class":"blocked","reason":"no DAW session is connected...","next":"open the DAW in a browser tab...","ms":1}
```

- `class` — api-anything's failure classes: `ok | drift | auth | rate | blocked | input | error`
- `tier` — `1`: the local server ran it over plain HTTP. `3`: the live DAW page ran it (the real Web Audio engine).
- `next` — what to try next when `ok` is false.

## Quickstart

```sh
npm start                                  # server on :3000 (+ preview ports)
# open http://127.0.0.1:3000/ in one browser tab — its bridge connects automatically

curl -s -X POST http://127.0.0.1:3000/api/call \
  -H 'content-type: application/json' \
  -d '{"op":"chopClips","args":{"preset":"1bar"}}'

curl -s -X POST http://127.0.0.1:3000/api/call \
  -H 'content-type: application/json' \
  -d '{"op":"exportWav","args":{"mode":"master","bitDepth":24}}'
# -> {"ok":true,...,"data":{"files":[{"name":"Untitled-24bit.wav","url":"/api/exports/Untitled-24bit.wav","bytes":...}]}}
```

The same call through the bundled CLI or MCP server:

```sh
node tools/daw-api/daw-api.mjs call chopClips preset=1bar
node tools/daw-api/daw-api.mjs call exportWav mode=stems bitDepth=16
node tools/daw-api/daw-api.mjs ops --writes      # the catalog with params
```

```json
{ "mcpServers": { "audius-studio": { "command": "node", "args": ["app/api/mcp.mjs"] } } }
```

(Already wired in the repo's `.mcp.json`. Start it with `--allow-writes` when
the agent should edit the session; like api-anything, writes are hidden from
`list_operations` and refused by `call_operation` otherwise.)

## Architecture

```
agent / script / CLI (tools/daw-api) / MCP (app/api/mcp.mjs)
        |  POST /api/call {"op","args"}          api-anything envelope out
        v
app/server.mjs  ->  app/api/router.mjs           catalog: app/api/operations.json
        |                 |
        | tier 1          | tier 3
        v                 v
  server disk       app/api/ws-hub.mjs  <== WebSocket /api/ws ==>  DAW browser tab
  (projects,          (zero-dep RFC 6455 hub,                    app/public/api-bridge.js
   exports,            sessions, timeouts)                       + handlers in app.js
   imports)                                                        |
                                                                   v
                                                     the real session: Web Audio engine,
                                                     playlist, mixer, undo, offline render
```

- **Tier 1** operations run on the server with no browser: health, sessions,
  project files, exports and imports storage.
- **Tier 3** operations run **inside a live DAW tab**: the hub routes the call
  over the WebSocket bridge, `api-bridge.js` dispatches it to a handler in
  `app.js`, and the handler reuses the exact code paths the UI uses (same undo
  snapshots, same clamps, same engine sync), so an API call and a click leave
  the session in the same state.
- No tab open? Tier-3 calls fail fast with `class:"blocked"` and a `next` hint
  — never a silent no-op.
- On static hosting (Cloudflare Pages) there is no `/api`: the bridge probe
  fails and the module stays dormant. The DAW itself never depends on it.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | server + api health, session count |
| `GET /api/sites` | api-anything `list_sites` shape |
| `GET /api/operations[?op=&executor=&readOnly=]` | api-anything `list_operations` shape: the full catalog with typed params |
| `GET /api/sessions` | connected DAW tabs (newest answers calls; target one with `"session"` in the call body) |
| `POST /api/call` | `{"site?","op","args?","session?"}` -> envelope |
| `POST /api/exports/upload?name=` | binary WAV upload (used by `exportWav`) |
| `GET /api/exports` / `GET /api/exports/<name>` / `DELETE` | rendered WAVs, download, delete |
| `POST /api/imports/upload?name=` | binary source-audio upload for `importAudio url=/api/imports/<name>` |
| `GET /api/imports` / `GET /api/imports/<name>` / `DELETE` | the import inbox |
| `GET|POST /api/projects[...]` | the pre-existing project persistence used by the app UI |
| `WS /api/ws` | the page bridge (JSON text frames; see `app/api/ws-hub.mjs`) |

CORS is open on `/api/*` so any local tool can call it. There is no auth: like
api-anything this is a **local workstation API** — it drives your machine, your
session, your files. Keep the server on a trusted network (set `HOST`/`PORT`
env to change the bind).

## Operations (56)

`GET /api/operations` is the source of truth (params carry `type`, `required`,
`default`, `pattern`, `hint` — api-anything's ParamSchema fields). `?` = optional.

| operation | tier | kind | params |
|---|---|---|---|
| `getHealth` | 1 | read | — |
| `listSessions` | 1 | read | — |
| `listProjectFiles` | 1 | read | — |
| `getProjectFile` | 1 | read | name |
| `putProjectFile` | 1 | write | name, project |
| `deleteProjectFile` | 1 | write | name |
| `listExports` | 1 | read | — |
| `deleteExport` | 1 | write | name |
| `listImports` | 1 | read | — |
| `getSession` | 3 | read | — |
| `getTransport` | 3 | read | — |
| `getTracks` | 3 | read | — |
| `getClips` | 3 | read | trackId?, clipIds? |
| `getAssets` | 3 | read | — |
| `getMarkers` | 3 | read | — |
| `getMeters` | 3 | read | — |
| `listProjects` | 3 | read | — |
| `newSession` | 3 | write | name?, bpm? |
| `loadDemo` | 3 | write | — |
| `saveProject` | 3 | write | name? |
| `loadProject` | 3 | write | name?, project? |
| `setProjectInfo` | 3 | write | name?, bpm?, masterVolumeDb?, metronome?, loopEnabled?, loopStartBeat?, loopEndBeat? |
| `undo` | 3 | write | — |
| `redo` | 3 | write | — |
| `play` | 3 | write | fromBeat? |
| `pause` | 3 | write | — |
| `stop` | 3 | write | — |
| `seek` | 3 | write | beat?, bar?, seconds? |
| `setTempo` | 3 | write | bpm |
| `setLoop` | 3 | write | enabled?, startBeat?, endBeat? |
| `setMetronome` | 3 | write | on |
| `addTrack` | 3 | write | name?, color? |
| `removeTrack` | 3 | write | trackId |
| `renameTrack` | 3 | write | trackId, name |
| `setTrackMix` | 3 | write | trackId, volumeDb?, pan?, muted?, solo?, eqLowDb?, eqMidDb?, eqHighDb? |
| `selectTrack` | 3 | write | trackId |
| `importAudio` | 3 | write | name?, base64?, url?, trackId?, startBeat?, addClip? |
| `removeAsset` | 3 | write | assetId |
| `addClip` | 3 | write | assetId, trackId?, startBeat?, durationBeats? |
| `selectClips` | 3 | write | clipIds?, trackId?, all? |
| `moveClips` | 3 | write | clipIds?, deltaBeats?, deltaTracks?, startBeat?, trackId? |
| `trimClips` | 3 | write | clipIds?, startBeat?, endBeat?, durationBeats? |
| `splitClips` | 3 | write | atBeat, clipIds? |
| `splitAtPlayhead` | 3 | write | clipIds? |
| `chopClips` | 3 | write | clipIds?, everyBeats?, preset?, transients? |
| `duplicateClips` | 3 | write | clipIds? |
| `reverseClips` | 3 | write | clipIds? |
| `muteClips` | 3 | write | clipIds?, muted? |
| `deleteClips` | 3 | write | clipIds? |
| `slipClips` | 3 | write | clipIds?, deltaSec?, deltaBeats? |
| `setClipParams` | 3 | write | clipIds?, gainDb?, pitchSemitones?, pan?, fadeInBeats?, fadeOutBeats?, reverse?, muted?, color?, name?, playbackRate? |
| `clearPlaylist` | 3 | write | — |
| `addMarker` | 3 | write | beat, name?, color? |
| `removeMarker` | 3 | write | markerId |
| `exportWav` | 3 | write | mode?, bitDepth?, sampleRate?, range?, filename? |
| `setTool` | 3 | write | tool |

### What the tier-3 set covers

- **Session & projects** — full state (`getSession`), new/demo sessions, save &
  load across browser storage and server disk, session settings, undo/redo.
- **Transport** — play/pause/stop/seek (beat, bar or seconds), tempo, loop
  region, metronome.
- **Tracks & mixer** — add/remove/rename tracks, mute/solo, volume, pan and
  the 3-band EQ per track, live meters, master volume.
- **Stems** — import audio from base64 or a URL (anything the browser decodes:
  WAV/MP3/FLAC/OGG/M4A), list, remove.
- **Playlist editing** — add/move/trim/split/slip/duplicate/reverse/mute/
  delete clips; the one-click chops (1 beat, 1 bar, 1/2 bar, 1/8 note,
  transient auto-slice); split at playhead; per-segment inspector params
  (gain, pitch, pan, fades, reverse, color); markers; selection and tools.
- **Export** — offline render (faster than realtime) of the master mixdown or
  per-track stems to 16/24/32-bit WAV at 44.1/48 kHz, full song or loop
  region, stored on the server with a download URL.

## Big audio in and out

WebSocket call payloads are capped (64 MB) and JSON+base64 is wasteful, so big
files travel over plain HTTP:

```sh
# in: upload, then reference by url
curl -s --data-binary @kick.wav 'http://127.0.0.1:3000/api/imports/upload?name=kick.wav'
node tools/daw-api/daw-api.mjs call importAudio name=kick.wav url=/api/imports/kick.wav

# out: exportWav stores the render on the server
curl -s -X POST http://127.0.0.1:3000/api/call -H 'content-type: application/json' \
  -d '{"op":"exportWav","args":{"mode":"master"}}'
curl -s -O -J 'http://127.0.0.1:3000/api/exports/Untitled-24bit.wav'
```

Storage lives in `app/projects/` (git-ignored): `.dawproj.json` saves plus
`exports/` and `imports/`. Limits: `DAW_EXPORT_MAX_BYTES` (512 MB),
`DAW_IMPORT_MAX_BYTES` (256 MB), `DAW_CALL_MAX_BYTES` (96 MB).

## api-anything itself can call the DAW

`sites/audius-studio.json` is a site spec in api-anything's own format
(validated against its zod schema). Drop it in `~/.api-anything/sites/` and the
real tool works against this server:

```sh
api-anything call audius-studio health        # {"ok":true,"class":"ok","tier":1,...}
api-anything call audius-studio projectFiles
api-anything call audius-studio getSession    # tier-3 read of the live session
api-anything call audius-studio setTempo bpm=140 --allow-writes
api-anything call audius-studio exportWav mode=stems --allow-writes
```

It ships an 18-operation starter set (discovery + session reads + transport +
chop/split + export); the native API above exposes all 56.

## Files

| File | Role |
|---|---|
| `app/api/operations.json` | the catalog: every operation with params, tier, readOnly, timeouts |
| `app/api/router.mjs` | all `/api/*` HTTP routes, arg validation, envelope, storage |
| `app/api/envelope.mjs` | envelope + api-anything-style param coercion/validation |
| `app/api/ws-hub.mjs` | zero-dependency WebSocket server + session hub |
| `app/api/mcp.mjs` | zero-dependency stdio MCP server (`list_sites`, `list_operations`, `call_operation`) |
| `app/public/api-bridge.js` | browser side: probe, connect, dispatch calls to app.js handlers |
| `app/public/app.js` | `buildApiBridgeHandlers()` — the tier-3 operations against the live session |
| `tools/daw-api/daw-api.mjs` | CLI (`sites`, `ops`, `call`, `status`) |
| `sites/audius-studio.json` | api-anything-compatible site spec |
| `test/api/smoke.mjs` | 36-check smoke test, no browser needed |

## Tests

```sh
node test/api/smoke.mjs
```

Boots the real router + hub on an ephemeral port and exercises: tier-1 calls,
every validation class, uploads/downloads and traversal safety, the MCP server
(including the write gate), the CLI, a raw-WebSocket fake page (fragmented
masked frames, a 300 KB result, hub timeouts, disconnect -> blocked), the real
`api-bridge.js` module end to end, and catalog/code consistency. What it
cannot cover here: a real browser DOM/Web Audio run (this sandbox has no
browser) — the tier-3 handlers mirror the UI code paths one-for-one and are
checked statically against them.
