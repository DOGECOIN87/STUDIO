# DAW

Under construction.

> **Keep this repository private.** It holds a personal backup of FL Studio (commercial software © Image-Line) as release assets. Redistributing it violates the FL Studio EULA.

## FL Studio → Linux porting review

📄 **[docs/FLSTUDIO_LINUX_PORTING_REVIEW.md](docs/FLSTUDIO_LINUX_PORTING_REVIEW.md)**: what the `FLSTUDIO` archive contains, what "semi-ported" means for it, the likely startup blocker, and effort estimates for each route:

| Route | Effort |
|---|---|
| A. Make the existing Wine setup work | 0.5–2 days |
| A+. Reproducible Wine package | 2–4 weeks + upkeep |
| B. True native port (Image-Line only, needs source) | ~1–2 years to beta |
| C. Port from binaries (reverse engineering) | not viable |
| D. Clean-room FL-like DAW | MVP 6–12 months |

Supporting analysis (text only, generated from the archive):
- [`analysis/flstudio/REPORT.md`](analysis/flstudio/REPORT.md): inventory, toolchains, signatures, porting signals
- [`analysis/flstudio/PREFIX_DETAILS.md`](analysis/flstudio/PREFIX_DETAILS.md): launcher script and allowlisted Wine configuration
- [`analysis/flstudio/RELEASE_VERIFICATION.md`](analysis/flstudio/RELEASE_VERIFICATION.md): end-to-end checksum verification of the release
- `analysis/flstudio/{manifest,binaries}.tsv`, `summary.json`: full listings

## FL Studio archive backup (`FLSTUDIO.zip`)

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

## Tooling

- [`tools/transfer/analyze_zip.py`](tools/transfer/analyze_zip.py): text-only archive inventory and porting-signal analyzer (PE/ELF/Mach-O, Delphi/MSVC/.NET fingerprints, Authenticode, plugin entry points).
- [`tools/transfer/inspect_prefix.py`](tools/transfer/inspect_prefix.py): allowlisted Wine-prefix inspector. It never prints licence, registration or account data.
- [`.github/workflows/drive-transfer.yml`](.github/workflows/drive-transfer.yml): the one-off Google Drive → Release transfer. It downloaded the file, verified it, analyzed it, waited for approval, then split and published it. Now manual-only, and it needs a new `.github/transfer/request.json` to run again.
- [`.github/workflows/inspect-release.yml`](.github/workflows/inspect-release.yml): re-verifies the release end to end and regenerates the analysis. Manual-only; run it from the Actions tab once this branch is merged into the default branch.
