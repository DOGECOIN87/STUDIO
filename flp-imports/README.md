# Acquired demo-source sessions (`.flp`)

The owner's own FL Studio session files, downloaded from their Google Drive on
2026-10-20 so the best of them could become this DAW's built-in demo. They live
**outside `app/public/` on purpose**: this folder is never deployed to
audius-studio.online. Keep the repository private.

| File | Google Drive file ID | Size (bytes) | SHA-256 |
|---|---|---:|---|
| `untitled.flp` | `1TntCuSDtCniCZwbtdR5EhQq-5KMjvWL4` | 218,975 | `906aa616f031e4d04e4880c900bb0090eb8169f91ff87a14792df39e195de254` |
| `Project 1 - mattrick_5.flp` | `1qcgdH6krCGP9Bc3Ka6G5yf7c0tsbsP0o` | 394,361 | `4e180f6835e56cb45e8081439d9b8d4a7c9d9dbc0e17a03f7f0c8b526c87c140` |
| `feb16thflat rite_2.flp` | `1fljHZk5-y5ScL95KV7Re5u8v4NKyBdDC` | 529,935 | `e69b6c723d1933373f3b5f478600d9166396e0432778f5ee8a5fe2418c37217d` |

Verify with `sha256sum -c SHA256SUMS.txt` in this folder.

Notes:

- Drive actually contains a **fourth** `.flp`, `naught.flp` (134,468 bytes,
  last modified 2020-08-05, Drive ID `11SQKe1KL-5WIpZcW-YYq10o3JPtOJ1Fq`). The
  request was for three files and the three above were all uploaded on
  2026-10-20, so `naught.flp` was left alone. Say the word if it should be
  pulled in too.
- A `.flp` file contains note/arrangement data and *references* to samples and
  plug-ins — not the audio itself. The demo conversion therefore re-synthesizes
  the sounds in the browser; see `tools/flp-import/README.md`.
- Scoring that picked the demo source: `analysis/flp-demo/REPORT.md`
  (winner: `untitled.flp`, 83.1/100 on a demo-suitability rubric).
