#!/usr/bin/env python3
"""
Extract porting-relevant configuration from a zipped Wine prefix, using an allowlist.

    inspect_prefix.py <archive.zip> <output.md>

Reports:
  * user-authored launcher scripts that sit next to the prefix (secret-redacted)
  * Wine configuration from user.reg / system.reg on an explicit allowlist
    (emulated Windows version, DLL overrides, audio/graphics drivers, installed
    programs, WebView2 / .NET presence)
  * the Edge/WebView2 installer log tail and installer temp scripts

Never printed: registration / licence / account data. Image-Line registry keys are
listed by key and value *names* only (no data), and any key or value whose name looks
licence/account related is skipped entirely.
"""
from __future__ import annotations

import os
import re
import sys
import zipfile

SECRET_RE = re.compile(
    r"(?i)(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|serial|regkey|license|licence|reg(istration)?[_ -]?(code|key|name|data))"
    r"(\s*[:=]\s*|\s+)(\S+)"
)
SENSITIVE_NAME_RE = re.compile(
    r"regist|licen|serial|account|e-?mail|token|unlock|auth|login|passw|credential|activat|"
    r"(?<![a-z])key(?![a-z])|user ?name|owner|cloud|session|cookie|secret|hash|machine ?id|device ?id",
    re.I,
)

# (registry file, key-path regex, allowed value names or None = all, mode)
#   mode "values": print allowed values with data;  mode "names": key/value names only, no data
ALLOW = [
    ("user.reg", r"^Software\\Wine$", None, "values"),
    ("user.reg", r"^Software\\Wine\\DllOverrides$", None, "values"),
    ("user.reg", r"^Software\\Wine\\Drivers$", None, "values"),
    ("user.reg", r"^Software\\Wine\\Direct3D$", None, "values"),
    ("user.reg", r"^Software\\Wine\\(X11 Driver|Wayland Driver|Mac Driver)$", None, "values"),
    ("user.reg", r"^Software\\Wine\\Explorer(\\Desktops)?$", None, "values"),
    ("user.reg", r"^Software\\Wine\\AppDefaults\\[^\\]+(\\.*)?$", None, "values"),
    ("user.reg", r"^Software\\Wine\\WineASIO$", None, "values"),
    ("user.reg", r"^Control Panel\\Desktop$", {"LogPixels"}, "values"),
    ("user.reg", r"^Software\\(Wow6432Node\\)?Image-Line(\\.*)?$", None, "names"),
    ("system.reg", r"^Software\\Microsoft\\Windows NT\\CurrentVersion$",
     {"ProductName", "CurrentVersion", "CurrentBuild", "CurrentBuildNumber", "CSDVersion", "DisplayVersion",
      "CurrentMajorVersionNumber", "CurrentMinorVersionNumber"}, "values"),
    ("system.reg", r"^Software\\(Wow6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\]+$",
     {"DisplayName", "DisplayVersion", "Publisher"}, "values"),
    ("system.reg", r"^Software\\(Wow6432Node\\)?Microsoft\\EdgeUpdate\\Clients\\[^\\]+$", {"name", "pv"}, "values"),
    ("system.reg", r"^Software\\(Wow6432Node\\)?Microsoft\\NET Framework Setup\\NDP\\.*$",
     {"Version", "Install", "Release"}, "values"),
    ("system.reg", r"^Software\\Wine\\Mono$", None, "values"),
    ("system.reg", r"^Software\\(Wow6432Node\\)?Image-Line(\\.*)?$", None, "names"),
]


def redact(text: str) -> str:
    text = SECRET_RE.sub(lambda m: f"{m.group(1)}{m.group(5)}[REDACTED]", text)
    return re.sub(r"\b[A-Za-z0-9+/]{40,}={0,2}\b", "[REDACTED-LONG-TOKEN]", text)


def parse_reg(text: str):
    """Minimal Wine .reg parser -> list of (key_path, {value_name: raw_value}), plus header lines."""
    keys, header = [], []
    vals = None
    pending = None
    for line in text.splitlines():
        if pending is not None:
            pending += line.strip()
            if pending.endswith("\\"):
                pending = pending[:-1]
                continue
            line, pending = pending, None
        elif line.startswith("["):
            m = re.match(r"^\[(.*)\](?:\s+\d+)?\s*$", line)
            if m:
                vals = {}
                keys.append((m.group(1).replace("\\\\", "\\"), vals))
            continue
        elif line.startswith("#") or line.startswith(";") or not line.strip():
            if vals is None and line.strip():
                header.append(line.strip())
            continue
        if vals is None:
            header.append(line.strip())
            continue
        if line.endswith("\\"):
            pending = line[:-1]
            continue
        m = re.match(r'^(@|"(?:[^"\\]|\\.)*")=(.*)$', line)
        if m:
            name = "@" if m.group(1) == "@" else m.group(1)[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            vals[name] = m.group(2)
    return keys, header


def fmt_value(raw: str) -> str:
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    m = re.match(r'^str\(\d\):"(.*)"$', raw)
    if m:
        return m.group(1).replace("\\\\", "\\")
    m = re.match(r"^dword:([0-9a-fA-F]{8})$", raw)
    if m:
        return f"dword:{int(m.group(1), 16)}"
    if raw.startswith("hex"):
        return f"<binary, ~{raw.count(',') + 1} bytes>"
    return raw[:160]


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    zpath, out = sys.argv[1], sys.argv[2]
    zf = zipfile.ZipFile(zpath)
    names = [zi.filename for zi in zf.infolist() if not zi.is_dir()]
    prefixes = sorted({n[: n.index("/.wine/") + len("/.wine/")] for n in names if "/.wine/" in n})
    L = []
    w = L.append
    w("# Wine prefix details (allowlisted)\n")
    w("_Generated by `tools/transfer/inspect_prefix.py`. Registration/licence/account data is never printed._\n")
    w(f"Wine prefixes found: {', '.join(f'`{p}`' for p in prefixes) or 'none'}\n")

    # 1) launcher scripts next to the prefix
    w("## User-authored files next to the prefix\n")
    found = False
    for n in names:
        if "/.wine/" in n:
            continue
        base = n.rsplit("/", 1)[-1]
        ext = os.path.splitext(base)[1].lower()
        zi = zf.getinfo(n)
        head = zf.open(zi).read(4)
        if ext in (".sh", ".bash", ".desktop", ".txt", ".md", ".conf", ".ini", ".yml", ".yaml", ".toml") or head.startswith(b"#!"):
            if zi.file_size > 256 * 1024:
                w(f"- `{n}` ({zi.file_size:,} bytes, too large to show)")
                continue
            found = True
            txt = zf.read(zi).decode("utf-8", "replace")
            w(f"### `{n}` ({zi.file_size:,} bytes)\n")
            w("```bash\n" + redact(txt).replace("```", "ʼʼʼ") + "\n```\n")
        else:
            w(f"- `{n}` ({zi.file_size:,} bytes, binary/other; not shown)")
    if not found:
        w("_No launcher scripts found._\n")

    # 2) registry allowlist
    for pre in prefixes:
        for regname in ("user.reg", "system.reg"):
            path = pre + regname
            if path not in names:
                continue
            keys, header = parse_reg(zf.read(path).decode("utf-8", "replace"))
            w(f"\n## `{regname}` (allowlisted keys)\n")
            hdr = [h for h in header if h.startswith("#arch") or h.startswith("WINE REGISTRY")]
            if hdr:
                w("Header: " + "; ".join(f"`{h}`" for h in hdr) + "\n")
            shown = 0
            for kp, vals in keys:
                for fname, krx, allowed, mode in ALLOW:
                    if fname != regname or not re.match(krx, kp, re.I):
                        continue
                    if SENSITIVE_NAME_RE.search(kp):
                        break  # skip licence/account-looking keys entirely
                    if mode == "names":
                        vn = [v for v in vals if not SENSITIVE_NAME_RE.search(v)]
                        w(f"- `[{kp}]` — value names: {', '.join(f'`{v}`' for v in vn[:25]) or '(none)'}"
                          f"{' …' if len(vn) > 25 else ''}")
                    else:
                        items = [(k, v) for k, v in vals.items()
                                 if (allowed is None or k in allowed) and not SENSITIVE_NAME_RE.search(k)]
                        if not items and allowed is not None:
                            break
                        w(f"- `[{kp}]`")
                        for k, v in items[:60]:
                            w(f"    - `{k}` = `{redact(fmt_value(v))}`")
                        if not items:
                            w("    - (no values)")
                    shown += 1
                    break
            if not shown:
                w("_No allowlisted keys present._")

    # 3) misc installer artefacts
    w("\n## Installer artefacts\n")
    for n in names:
        if n.endswith("/.update-timestamp"):
            w(f"- `{n}`: `{zf.read(n).decode('utf-8', 'replace').strip()}`")
    for n in names:
        if re.search(r"/Temp/.*\.ps1$", n, re.I) and zf.getinfo(n).file_size <= 8192:
            w(f"\n### `{n}`\n")
            w("```powershell\n" + redact(zf.read(n).decode("utf-8", "replace")) + "\n```")
    logs = [n for n in names if n.lower().endswith("microsoftedgeupdate.log")]
    for n in logs:
        txt = zf.read(n).decode("utf-8", "replace").splitlines()
        errs, seen = [], set()
        for line in txt:
            if re.search(r"error|fail|0x8[0-9a-f]{7}|exit code|result|\[Edge|install", line, re.I):
                key = re.sub(r"\d", "", line)[:160]
                if key not in seen:
                    seen.add(key)
                    errs.append(line)
        w(f"\n### `{n}` — {len(txt):,} lines; notable lines (first 40, de-duplicated)\n")
        w("```text\n" + redact("\n".join(l[:300] for l in errs[:40])) + "\n```")
        w("\nLast 20 lines:\n")
        w("```text\n" + redact("\n".join(l[:300] for l in txt[-20:])) + "\n```")

    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
