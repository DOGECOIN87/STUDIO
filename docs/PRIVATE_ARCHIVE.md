# Private archive and porting notes

> **Keep this repository private while these notes and the release below exist.** The release holds a personal backup of commercial desktop music software as assets; redistributing it violates that software's licence. Before the repository is ever made public, delete that release, this file and the `analysis/` folder.

These sections were the repository's README before it became the STUDIO project page. They are kept here unchanged.

> **Removed from the working tree on 2026-10-27:** `analysis/flstudio/`, `docs/FLSTUDIO_LINUX_PORTING_REVIEW.md`, `tools/transfer/`, the `drive-transfer` and `inspect-release` workflows and `.github/transfer/`. The links below point at files that now exist only in git history: check out commit `2efb7f3` to read them. The GitHub release itself is untouched.

## 1. FL Studio → Linux Porting Review

📄 **[docs/FLSTUDIO_LINUX_PORTING_REVIEW.md](docs/FLSTUDIO_LINUX_PORTING_REVIEW.md)**: what the `FLSTUDIO` archive contains, what "semi-ported" means for it, the startup blocker (`WINTRUST_DefaultVerify returning 80096004` / Wine bug 60273), and effort estimates for each route:

| Route | Effort |
|---|---|
| A. Make the existing Wine setup work (e.g. via [`Torbuntu/fl-studio-linux-setup`](https://github.com/Torbuntu/fl-studio-linux-setup)) | 0.5–2 days |
| A+. Reproducible Wine package | 2–4 weeks + upkeep |
| B. True native port (Image-Line only, needs source) | ~1–2 years to beta |
| C. Port from binaries (reverse engineering) | not viable |
| D. Clean-room FL-like DAW (started in `app/`) | MVP in repo; full parity many person-years |

Supporting analysis (text only, generated from the archive):
- [`analysis/flstudio/REPORT.md`](analysis/flstudio/REPORT.md): inventory, toolchains, signatures, porting signals
- [`analysis/flstudio/PREFIX_DETAILS.md`](analysis/flstudio/PREFIX_DETAILS.md): launcher script and allowlisted Wine configuration
- [`analysis/flstudio/RELEASE_VERIFICATION.md`](analysis/flstudio/RELEASE_VERIFICATION.md): end-to-end checksum verification of the release
- `analysis/flstudio/{manifest,binaries}.tsv`, `summary.json`: full listings

---

## 2. FL Studio Archive Backup (`FLSTUDIO.zip`)

Stored as assets of the release **[`flstudio-archive-2026-10-14`](https://github.com/DOGECOIN87/DAW/releases/tag/flstudio-archive-2026-10-14)**. GitHub limits each asset to under 2 GiB, so the zip is split into two byte-exact parts:

| File | Size (bytes) | SHA-256 |
|---|---:|---|
| `FLSTUDIO.zip.part-00` | 1,394,723,771 | `9e6fa0dff0616d78f79c3354e98455768600d6ce339e019d9ce67e52fd8cb671` |
| `FLSTUDIO.zip.part-01` | 1,394,723,771 | `3cc8cfe1a3c2202048d272ee27f46766973cce5e6069562aef6e3b2b91b111c9` |
| `FLSTUDIO.zip` (re-joined) | 2,789,447,542 | `843750711a8036919668dc833d3bac21cd5ea159c9c13e160843e6ccdab0f40e` |

### Restore

```sh
gh release download flstudio-archive-2026-10-14 -R DOGECOIN87/DAW   # or download the 3 files from the release page

# Linux / macOS
cat FLSTUDIO.zip.part-00 FLSTUDIO.zip.part-01 > FLSTUDIO.zip
sha256sum -c SHA256SUMS.txt          # macOS: shasum -a 256 -c SHA256SUMS.txt
```

```bat
:: Windows (Command Prompt)
copy /b FLSTUDIO.zip.part-00 + FLSTUDIO.zip.part-01 FLSTUDIO.zip
certutil -hashfile FLSTUDIO.zip SHA256
```
## 3. Audius upstream forks — what applies to this DAW

📄 **[docs/AUDIUS_UPSTREAM_APPLIED.md](docs/AUDIUS_UPSTREAM_APPLIED.md)**: an evidence-backed review of the three Audius forks ([`apps`](https://github.com/DOGECOIN87/apps), [`api2`](https://github.com/DOGECOIN87/api2), [`pedalboard`](https://github.com/DOGECOIN87/pedalboard)) against this repo's constraints (no build step, static Cloudflare Pages hosting, Chrome 95 / Safari 14, offline-first, unofficial positioning).

- **`apps` → `packages/sdk`**: a no-build browser bundle (`dist/sdk.min.js`, 1.05 MB / **241 KB gzipped**, exposes `window.audiusSdk`) with `oauth.login()`, `uploads.createAudioUpload()` and `tracks.createTrack()` — i.e. **publish the master bounce, and each exported stem under Audius's 12 official stem categories, straight from the Export dialog**. Read-only access needs no API key (`{ appName }` config). Bundle passes the old-browser probe.
- **`apps` → `packages/harmony`** *(partly applied — see [`docs/HARMONY_TOKEN_MAP.md`](docs/HARMONY_TOKEN_MAP.md) and `HANDOVER.md` §12)*: Audius's design system, emitted as plain CSS custom properties (8 colour themes, a 4px spacing grid, radii, motion, shadows, z-index layers, type scale). We were already shipping its `avenir.css` verbatim as `app/public/audius-fonts.css` (six identical base64 faces, now attributed in `THIRD_PARTY_NOTICES.md`). The **Audius Neue Dark** theme has been corrected onto Harmony's real `default-dark` tokens — it claimed to be official and was not — and `forest`/`daylight` were verified as faithful `matrix`/`day` mappings. `audius-dark` stays as the deliberate hybrid it is: Harmony `dark` neutrals + Harmony `day` accents.
- **`api2` → `api/swagger/swagger-v1.yaml`**: the endpoints a DAW actually wants — `GET /v1/tracks/search?key=&bpm_min=&bpm_max=` (find material at the session's tempo and key), `GET /v1/tracks/remixables`, `GET /v1/tracks/{id}/stems`, `GET /v1/tracks/{id}/stream`, `GET /v1/resolve?url=`. The discovery node answers cross-origin (`cors.New()` → `AllowOrigins: "*"`), so a static site can call it with plain `fetch` and no SDK.
- **`pedalboard`: not applicable.** Despite the name it is not an audio-DSP library — it is Audius's server-side plugin monorepo (notifications, staking, rewards, solana-relay, SLA auditor) that needs a discovery DB, Redis and delegate keys. Its only transferable fact is that BPM/key analysis is produced by the storage node at upload time, which is why publishing returns the analysed tempo and key.

## Tooling

- [`tools/transfer/analyze_zip.py`](tools/transfer/analyze_zip.py): text-only archive inventory and porting-signal analyzer (PE/ELF/Mach-O, Delphi/MSVC/.NET fingerprints, Authenticode, plugin entry points).
- [`tools/transfer/inspect_prefix.py`](tools/transfer/inspect_prefix.py): allowlisted Wine-prefix inspector. It never prints licence, registration or account data.
- [`.github/workflows/drive-transfer.yml`](.github/workflows/drive-transfer.yml): the one-off Google Drive → Release transfer. It downloaded the file, verified it, analyzed it, waited for approval, then split and published it. Now manual-only, and it needs a new `.github/transfer/request.json` to run again.
- [`.github/workflows/inspect-release.yml`](.github/workflows/inspect-release.yml): re-verifies the release end to end and regenerates the analysis. Manual-only; run it from the Actions tab once this branch is merged into the default branch.
