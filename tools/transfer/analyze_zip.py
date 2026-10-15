#!/usr/bin/env python3
"""
Text-only inventory + porting-signal analysis of a (Windows) application archive.

    analyze_zip.py <archive.zip> <output-dir>

What it produces (no binaries, no file contents except version strings and
short, secret-redacted excerpts of user-authored porting scripts/notes):

    REPORT.md        human-readable summary
    summary.json     machine-readable summary
    manifest.tsv(.gz) every entry: path, size, compressed size, mtime, detected kind
    binaries.tsv     every PE/ELF/Mach-O binary with arch, toolchain hints, imports

It never fails hard: any per-file error is recorded and analysis continues.
"""
from __future__ import annotations

import collections
import datetime as dt
import gzip
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

try:
    import pefile  # type: ignore
except Exception:  # pragma: no cover
    pefile = None

HEAD = 8192
MAX_PE_BYTES = 768 * 1024 * 1024
TIME_BUDGET_S = 25 * 60
EXCERPT_MAX_FILES = 40
EXCERPT_MAX_LINES = 150
EXCERPT_MAX_BYTES = 256 * 1024

MACHINES = {0x14C: "x86", 0x8664: "x64", 0xAA64: "arm64", 0x1C0: "arm", 0x1C4: "armnt", 0xA641: "arm64ec"}
SUBSYSTEMS = {1: "native", 2: "gui", 3: "console", 9: "wince", 10: "efi-app"}

# substrings searched in raw binary data -> label
MARKERS = [
    (rb"Embarcadero", "Embarcadero"),
    (rb"Borland", "Borland"),
    (rb"Vcl.Forms", "Delphi VCL (Windows-only UI)"),
    (rb"Vcl.Controls", "Delphi VCL (Windows-only UI)"),
    (rb"FMX.Forms", "Delphi FireMonkey (cross-platform UI)"),
    (rb"FMX.Types", "Delphi FireMonkey (cross-platform UI)"),
    (rb"System.SysUtils", "Delphi RTL (namespaced, XE2+)"),
    (rb"Winapi.Windows", "Delphi Winapi units"),
    (rb"FastMM", "FastMM (Delphi memory manager)"),
    (rb"madExcept", "madExcept (Delphi)"),
    (rb"EurekaLog", "EurekaLog (Delphi)"),
    (rb"Free Pascal", "Free Pascal"),
    (rb"Lazarus", "Lazarus"),
    (rb"JUCE v", "JUCE"),
    (rb"juce::", "JUCE"),
    (rb"Steinberg", "Steinberg SDK strings"),
    (rb"VST3", "VST3 strings"),
    (rb"clap_entry", "CLAP"),
    (rb"Qt5Core", "Qt5"),
    (rb"Qt6Core", "Qt6"),
    (rb"libcef", "CEF/Chromium"),
    (rb"WebView2", "WebView2"),
    (rb"python3", "mentions python3 (embedded Python?)"),
    (rb"ASIO", "ASIO strings"),
    (rb"GCC: (", "GCC"),
    (rb"clang version", "Clang"),
    (rb"/rustc/", "Rust"),
    (rb"Go build ID", "Go"),
    (rb"wine_get_version", "Wine-aware"),
    (rb"Electron", "Electron"),
]

PORTING_NAME_HINTS = re.compile(
    r"(?<![a-z])(linux|wine|wineasio|winetricks|proton|yabridge|bottles|lutris|appimage|flatpak|snapcraft|"
    r"pipewire|jackd?|alsa|porting|ported|port|ubuntu|debian|arch ?linux|fedora|steamos)(?![a-z])", re.I)
SOURCE_EXT = {
    ".pas": "Pascal", ".pp": "Pascal", ".dpr": "Delphi project", ".dpk": "Delphi package", ".dfm": "Delphi VCL form",
    ".fmx": "Delphi FMX form", ".dproj": "Delphi project", ".groupproj": "Delphi group", ".lpr": "Lazarus project",
    ".lpi": "Lazarus project", ".lfm": "Lazarus form", ".c": "C", ".cc": "C++", ".cpp": "C++", ".cxx": "C++",
    ".h": "C/C++ header", ".hh": "C++ header", ".hpp": "C++ header", ".rs": "Rust", ".go": "Go", ".cs": "C#",
    ".java": "Java", ".swift": "Swift", ".m": "Obj-C", ".mm": "Obj-C++", ".py": "Python", ".js": "JavaScript",
    ".ts": "TypeScript", ".lua": "Lua",
}
BUILD_FILES = {"cmakelists.txt", "makefile", "meson.build", "configure.ac", "configure", "pkgbuild", "dockerfile",
               "build.sh", "cargo.toml", "package.json", "snapcraft.yaml", "setup.py", "pyproject.toml"}
BUILD_EXT = {".sln", ".vcxproj", ".csproj", ".cmake", ".mk", ".pro", ".spec"}
LINUX_ARTIFACT_EXT = {".so", ".sh", ".desktop", ".appimage", ".flatpakref", ".deb", ".rpm", ".service"}
MAC_ARTIFACT_EXT = {".dylib", ".app", ".component", ".plist", ".dmg", ".pkg", ".icns", ".bundle"}
PLUGIN_EXT = {".vst3": "VST3", ".clap": "CLAP", ".aaxplugin": "AAX", ".component": "AudioUnit", ".vst": "VST(mac)"}
AUDIO_EXT = {".wav", ".ogg", ".flac", ".mp3", ".aif", ".aiff", ".wv"}
TEXTISH_EXT = {".sh", ".bash", ".desktop", ".md", ".txt", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".bat",
               ".cmd", ".ps1", ".reg", ".nfo", ".json", ".xml"}
WINE_PREFIX_RE = re.compile(r"(^|/)(drive_c|dosdevices)(/|$)|(^|/)(system|user|userdef)\.reg$", re.I)
# Licensing-related *names* only (contents are never read). Can be legitimate, e.g. FLRegkey.reg
# downloaded from an Image-Line account, so hits are reported neutrally for a human to judge.
CRACK_NAME_RE = re.compile(
    r"crack|keygen|key[\s_-]?gen|patcher|activator|regkey|serial[\s_-]?(number|key)|\.nfo$|"
    r"(?<![a-z])r2r(?![a-z])|audioutopia|audioz|vr[\s_-]?team",
    re.I,
)
SECRET_RE = re.compile(
    r"(?i)(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|serial|regkey|license|licence|reg(istration)?[_ -]?(code|key|name|data))"
    r"(\s*[:=]\s*|\s+)(\S+)"
)


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return str(n)


def kind_from_head(b: bytes) -> str:
    if b.startswith(b"MZ"):
        if len(b) >= 0x40:
            off = int.from_bytes(b[0x3C:0x40], "little")
            if off + 4 <= len(b) and b[off:off + 4] == b"PE\0\0":
                return "pe"
        return "mz"
    if b.startswith(b"\x7fELF"):
        return "elf"
    if b[:4] in (b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe"):
        return "macho"
    if b[:4] == b"\xca\xfe\xba\xbe":
        return "macho-fat|java-class"
    if b.startswith(b"PK\x03\x04"):
        return "zip"
    if b.startswith(b"FLhd"):
        return "flp-project"
    if b.startswith(b"#!"):
        return "script"
    if b.startswith(b"RIFF") and b[8:12] == b"WAVE":
        return "wav"
    if b.startswith(b"OggS"):
        return "ogg"
    if b.startswith(b"fLaC"):
        return "flac"
    if b.startswith(b"ID3") or b[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "mp3"
    if b.startswith(b"\x89PNG"):
        return "png"
    if b[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if b.startswith(b"MSCF"):
        return "cab"
    if b.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7z"
    if b.startswith(b"\x1f\x8b"):
        return "gzip"
    if b.startswith(b"%PDF"):
        return "pdf"
    if b.startswith(b"\xd0\xcf\x11\xe0"):
        return "ole/msi"
    if b.startswith(b"CcnK") or b.startswith(b"FPCh"):
        return "vst2-preset"
    if not b:
        return "empty"
    sample = b[:2048]
    if b"\0" not in sample:
        try:
            sample.decode("utf-8")
            return "text"
        except UnicodeDecodeError:
            pass
        if sample.startswith(b"\xff\xfe") or sample.startswith(b"\xfe\xff"):
            return "text-utf16"
    elif sample.startswith(b"\xff\xfe") or sample.startswith(b"\xfe\xff"):
        return "text-utf16"
    return "data"


def safe_decode(s) -> str:
    if isinstance(s, bytes):
        for enc in ("utf-8", "utf-16", "latin-1"):
            try:
                return s.decode(enc).strip("\x00")
            except Exception:
                continue
    return str(s)


def analyze_pe(data: bytes) -> dict:
    info: dict = {}
    if pefile is None:
        info["error"] = "pefile not installed"
        return info
    pe = pefile.PE(data=data, fast_load=True)
    try:
        info["machine"] = MACHINES.get(pe.FILE_HEADER.Machine, hex(pe.FILE_HEADER.Machine))
        info["is_dll"] = bool(pe.FILE_HEADER.Characteristics & 0x2000)
        info["pe32plus"] = pe.OPTIONAL_HEADER.Magic == 0x20B
        info["subsystem"] = SUBSYSTEMS.get(pe.OPTIONAL_HEADER.Subsystem, str(pe.OPTIONAL_HEADER.Subsystem))
        ts = pe.FILE_HEADER.TimeDateStamp
        info["timestamp"] = (dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d")
                             if 946684800 < ts < 2051222400 else f"raw:{ts}")
        info["linker"] = f"{pe.OPTIONAL_HEADER.MajorLinkerVersion}.{pe.OPTIONAL_HEADER.MinorLinkerVersion}"
        info["sections"] = [s.Name.rstrip(b"\0").decode("latin-1", "replace") for s in pe.sections]
        dd = pe.OPTIONAL_HEADER.DATA_DIRECTORY
        info["authenticode_present"] = len(dd) > 4 and dd[4].VirtualAddress != 0 and dd[4].Size > 0
        info["dotnet"] = len(dd) > 14 and dd[14].VirtualAddress != 0
        try:
            info["rich_header"] = pe.parse_rich_header() is not None
        except Exception:
            info["rich_header"] = False
        dirs = [pefile.DIRECTORY_ENTRY[k] for k in (
            "IMAGE_DIRECTORY_ENTRY_IMPORT", "IMAGE_DIRECTORY_ENTRY_EXPORT",
            "IMAGE_DIRECTORY_ENTRY_RESOURCE", "IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT")]
        try:
            pe.parse_data_directories(directories=dirs)
        except Exception as e:  # keep going with what we have
            info["parse_warning"] = f"{type(e).__name__}: {e}"[:200]
        imps = []
        for attr in ("DIRECTORY_ENTRY_IMPORT", "DIRECTORY_ENTRY_DELAY_IMPORT"):
            for entry in getattr(pe, attr, []) or []:
                try:
                    imps.append(entry.dll.decode("latin-1").lower())
                except Exception:
                    pass
        info["imports"] = sorted(set(imps))
        exps = []
        exp = getattr(pe, "DIRECTORY_ENTRY_EXPORT", None)
        if exp is not None:
            for s in exp.symbols:
                if s.name:
                    exps.append(s.name.decode("latin-1", "replace"))
        info["export_count"] = len(exps)
        notable = {"VSTPluginMain", "main", "GetPluginFactory", "clap_entry", "CreatePlugInstance",
                   "DllRegisterServer", "DllGetClassObject", "ASIOInit", "PyInit", "dllmain"}
        info["notable_exports"] = sorted({e for e in exps if e in notable or e.startswith("PyInit_")})[:20]
        # version info
        ver = {}
        for fi in getattr(pe, "FileInfo", []) or []:
            for entry in (fi if isinstance(fi, list) else [fi]):
                for st in getattr(entry, "StringTable", []) or []:
                    for k, v in st.entries.items():
                        k2 = safe_decode(k)
                        if k2 in ("CompanyName", "FileDescription", "FileVersion", "ProductName", "ProductVersion",
                                  "OriginalFilename", "InternalName", "LegalCopyright"):
                            ver[k2] = safe_decode(v)[:120]
        info["version"] = ver
        # resources: RCDATA names (Delphi: DVCLAL, PACKAGEINFO), count of resource types
        rc_names, rtypes = [], collections.Counter()
        res = getattr(pe, "DIRECTORY_ENTRY_RESOURCE", None)
        if res is not None:
            for t in res.entries:
                tname = str(t.name) if t.name is not None else pefile.RESOURCE_TYPE.get(t.struct.Id, str(t.struct.Id))
                n_items = len(getattr(getattr(t, "directory", None), "entries", []) or [])
                rtypes[tname] += n_items
                if t.struct.Id == 10 and hasattr(t, "directory"):  # RT_RCDATA
                    for e in t.directory.entries:
                        if e.name is not None:
                            rc_names.append(str(e.name))
        info["rcdata_names_sample"] = sorted(set(rc_names))[:40]
        info["rcdata_named_count"] = len(rc_names)
        info["resource_types"] = dict(rtypes)
    finally:
        try:
            pe.close()
        except Exception:
            pass
    return info


def toolchain_hints(info: dict, data: bytes) -> list[str]:
    hints = []
    secs = set(info.get("sections", []))
    rcn = set(info.get("rcdata_names_sample", []))
    if {"DVCLAL", "PACKAGEINFO"} & rcn:
        hints.append("Delphi/C++Builder (DVCLAL/PACKAGEINFO resources)")
    if {".itext", ".didata"} & secs:
        hints.append("Embarcadero linker sections (.itext/.didata)")
    if {"CODE", "DATA", "BSS"} <= secs:
        hints.append("Legacy Borland/Delphi section layout")
    if info.get("dotnet"):
        hints.append(".NET assembly")
    if info.get("rich_header"):
        hints.append("Microsoft linker (Rich header)")
    imps = set(info.get("imports", []))
    if any(i.startswith(("vcruntime", "msvcp", "ucrtbase", "api-ms-win-crt")) for i in imps):
        hints.append("MSVC runtime imports")
    if any(i.startswith(("libgcc", "libstdc++", "libwinpthread")) for i in imps):
        hints.append("MinGW/GCC runtime imports")
    for needle, label in MARKERS:
        if needle in data and label not in hints:
            hints.append(label)
    m = re.search(rb"FPC \d+\.\d+\.\d+", data)
    if m:
        hints.append("Free Pascal " + m.group(0).decode("latin-1"))
    m = re.search(rb"Embarcadero Delphi for [A-Za-z0-9 ]{0,40}compiler version [0-9.]+", data)
    if m:
        hints.append(m.group(0).decode("latin-1"))
    tpf0 = data.count(b"TPF0")
    if tpf0:
        hints.append(f"Delphi streamed forms/frames (TPF0) x{tpf0}")
    return hints


def file_cmd(path: str) -> str:
    try:
        return subprocess.run(["file", "-b", path], capture_output=True, text=True, timeout=30).stdout.strip()[:200]
    except Exception as e:
        return f"file failed: {e}"


def elf_needed(path: str) -> list[str]:
    try:
        out = subprocess.run(["readelf", "-d", path], capture_output=True, text=True, timeout=30).stdout
        return re.findall(r"Shared library: \[([^\]]+)\]", out)
    except Exception:
        return []


def authenticode_check(path: str) -> dict:
    exe = shutil.which("osslsigncode")
    if not exe:
        return {"status": "skipped (osslsigncode not installed)"}
    try:
        p = subprocess.run([exe, "verify", "-in", path, "-CAfile", "/etc/ssl/certs/ca-certificates.crt"],
                           capture_output=True, text=True, timeout=120)
        out = (p.stdout or "") + "\n" + (p.stderr or "")
        cur = re.search(r"Current message digest\s*:\s*([0-9A-Fa-f]+)", out)
        calc = re.search(r"Calculated message digest\s*:\s*([0-9A-Fa-f]+)", out)
        subj = re.findall(r"Subject:\s*(.+)", out)
        res = {
            "digest_match": (cur.group(1).lower() == calc.group(1).lower()) if (cur and calc) else None,
            "signer_subject": subj[0].strip()[:200] if subj else None,
            "verify_ok": "Signature verification: ok" in out,
        }
        if "No signature found" in out or "Unable to extract existing signature" in out:
            res["status"] = "unsigned"
        elif res["digest_match"] is False:
            res["status"] = "SIGNED BUT FILE MODIFIED (digest mismatch)"
        elif res["digest_match"]:
            res["status"] = "signed, digest intact" + ("" if res["verify_ok"] else " (chain/timestamp not fully verified)")
        else:
            res["status"] = "unknown"
        return res
    except Exception as e:
        return {"status": f"error: {e}"}


def redact(text: str) -> str:
    text = SECRET_RE.sub(lambda m: f"{m.group(1)}{m.group(5)}[REDACTED]", text)
    text = re.sub(r"\b[A-Za-z0-9+/]{40,}={0,2}\b", "[REDACTED-LONG-TOKEN]", text)
    return text


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    zpath, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    t0 = time.time()
    errors: list[str] = []
    zf = zipfile.ZipFile(zpath)
    infos = zf.infolist()

    manifest_rows = []
    bin_rows = []
    dir_stats = collections.defaultdict(lambda: [0, 0])  # prefix -> [files, bytes]
    ext_stats = collections.defaultdict(lambda: [0, 0])
    kind_stats = collections.defaultdict(lambda: [0, 0])
    total_unc = total_comp = 0
    n_files = n_dirs = 0
    pe_list = []
    other_bins = []
    signals = collections.defaultdict(list)
    excerpt_candidates = []
    encrypted = 0
    names_lower = []

    for zi in infos:
        name = zi.filename.replace("\\", "/")
        if zi.is_dir():
            n_dirs += 1
            continue
        n_files += 1
        total_unc += zi.file_size
        total_comp += zi.compress_size
        names_lower.append(name.lower())
        parts = name.split("/")
        for depth in range(1, min(4, len(parts))):
            pre = "/".join(parts[:depth]) + "/"
            dir_stats[pre][0] += 1
            dir_stats[pre][1] += zi.file_size
        base = parts[-1]
        ext = os.path.splitext(base)[1].lower()
        ext_stats[ext or "(none)"][0] += 1
        ext_stats[ext or "(none)"][1] += zi.file_size
        head = b""
        kind = "?"
        if zi.flag_bits & 0x1:
            encrypted += 1
            kind = "encrypted"
        else:
            try:
                with zf.open(zi) as fh:
                    head = fh.read(HEAD)
                kind = kind_from_head(head)
            except Exception as e:
                kind = "unreadable"
                errors.append(f"read {name}: {type(e).__name__}: {e}"[:300])
        kind_stats[kind][0] += 1
        kind_stats[kind][1] += zi.file_size
        mtime = "%04d-%02d-%02d %02d:%02d" % zi.date_time[:5]
        manifest_rows.append((name, zi.file_size, zi.compress_size, mtime, kind))

        low = name.lower()
        if kind == "pe":
            pe_list.append(zi)
        elif kind in ("elf", "macho", "macho-fat|java-class"):
            other_bins.append((zi, kind))
        if kind == "elf" or ext in LINUX_ARTIFACT_EXT:
            signals["linux_artifacts"].append(name)
        if kind in ("macho",) or ext in MAC_ARTIFACT_EXT or ".app/" in low:
            signals["macos_artifacts"].append(name)
        if WINE_PREFIX_RE.search(name):
            signals["wine_prefix_markers"].append(name)
        if ext in SOURCE_EXT:
            signals[f"source:{SOURCE_EXT[ext]}"].append(name)
        if base.lower() in BUILD_FILES or ext in BUILD_EXT:
            signals["build_files"].append(name)
        for pext, label in PLUGIN_EXT.items():
            if f"{pext}/" in low or low.endswith(pext):
                signals[f"plugin_bundle:{label}"].append(name)
        if kind == "flp-project" or ext == ".flp":
            signals["fl_projects"].append(name)
        if ext in AUDIO_EXT:
            signals["audio_files"].append(name)
        if CRACK_NAME_RE.search(base):
            signals["licensing_name_hits"].append(name)
        if ext == ".reg":
            signals["registry_files(contents not read)"].append(name)
        if PORTING_NAME_HINTS.search(name):
            signals["porting_named_paths"].append(name)
        if (ext in TEXTISH_EXT or base.lower() in BUILD_FILES) and ext not in (".reg", ".json", ".xml") \
                and zi.file_size <= EXCERPT_MAX_BYTES and kind in ("text", "script"):
            score = 0
            if PORTING_NAME_HINTS.search(name):
                score += 3
            if ext in (".sh", ".bash", ".desktop", ".yml", ".yaml", ".toml") or base.lower() in BUILD_FILES:
                score += 2
            if re.search(r"readme|notes?|todo|install|build|setup|howto", base, re.I):
                score += 1
            if score:
                excerpt_candidates.append((score, name, zi))

    # ---- binary analysis -------------------------------------------------
    pe_list.sort(key=lambda z: -z.file_size)
    imports_counter = collections.Counter()
    toolchain_counter = collections.Counter()
    arch_counter = collections.Counter()
    plugin_kinds = collections.Counter()
    vendor_counter = collections.Counter()
    main_bins = []
    pe_done = 0
    budget_hit = False
    tmpdir = tempfile.mkdtemp(prefix="za-")
    main_name_re = re.compile(r"(^|/)(fl(64)?|flengine(_x64)?|fl studio.*|ilbridge.*|flstudio.*)\.(exe|dll)$", re.I)
    for zi in pe_list:
        name = zi.filename.replace("\\", "/")
        if time.time() - t0 > TIME_BUDGET_S:
            budget_hit = True
            bin_rows.append((name, zi.file_size, "pe", "", "", "", "SKIPPED (time budget)", "", ""))
            continue
        if zi.file_size > MAX_PE_BYTES:
            bin_rows.append((name, zi.file_size, "pe", "", "", "", "SKIPPED (too large)", "", ""))
            continue
        try:
            data = zf.read(zi)
            info = analyze_pe(data)
            hints = toolchain_hints(info, data)
            pe_done += 1
            arch_counter[info.get("machine", "?")] += 1
            for i in info.get("imports", []):
                imports_counter[i] += 1
            for h in hints:
                toolchain_counter[h] += 1
            ne = set(info.get("notable_exports", []))
            if "VSTPluginMain" in ne or ("main" in ne and info.get("is_dll")):
                plugin_kinds["VST2 (VSTPluginMain/main export)"] += 1
            if "GetPluginFactory" in ne:
                plugin_kinds["VST3 (GetPluginFactory export)"] += 1
            if "clap_entry" in ne:
                plugin_kinds["CLAP (clap_entry export)"] += 1
            if "CreatePlugInstance" in ne:
                plugin_kinds["FL native plugin (CreatePlugInstance export)"] += 1
            company = info.get("version", {}).get("CompanyName")
            if company:
                vendor_counter[company] += 1
            ver = info.get("version", {})
            is_main = bool(main_name_re.search(name)) or len(main_bins) < 12
            auth = {}
            if is_main and len(main_bins) < 25:
                tpath = os.path.join(tmpdir, "bin.tmp")
                with open(tpath, "wb") as fh:
                    fh.write(data)
                auth = authenticode_check(tpath)
                os.unlink(tpath)
                main_bins.append({"path": name, "size": zi.file_size, **{k: info.get(k) for k in (
                    "machine", "is_dll", "subsystem", "timestamp", "linker", "sections", "authenticode_present",
                    "dotnet", "rich_header", "imports", "notable_exports", "version", "rcdata_names_sample",
                    "resource_types")}, "toolchain_hints": hints, "authenticode": auth})
            bin_rows.append((
                name, zi.file_size, "pe",
                info.get("machine", ""), ("dll" if info.get("is_dll") else "exe") + "/" + info.get("subsystem", ""),
                (ver.get("CompanyName", "") + " | " + ver.get("ProductName", "") + " | " + ver.get("FileVersion", "")).strip(" |"),
                "; ".join(hints), ",".join(info.get("imports", [])), ",".join(info.get("notable_exports", [])),
            ))
            del data
        except Exception as e:
            errors.append(f"pe {name}: {type(e).__name__}: {e}"[:300])
            bin_rows.append((name, zi.file_size, "pe", "", "", "", f"ERROR {type(e).__name__}", "", ""))

    for zi, kind in other_bins:
        name = zi.filename.replace("\\", "/")
        try:
            tpath = os.path.join(tmpdir, "bin.tmp")
            with zf.open(zi) as src, open(tpath, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            desc = file_cmd(tpath)
            needed = elf_needed(tpath) if kind == "elf" else []
            os.unlink(tpath)
            arch_counter[kind] += 1
            bin_rows.append((name, zi.file_size, kind, "", desc, "", "", ",".join(needed), ""))
        except Exception as e:
            errors.append(f"bin {name}: {type(e).__name__}: {e}"[:300])
    shutil.rmtree(tmpdir, ignore_errors=True)

    # ---- excerpts of user-authored porting notes/scripts -------------------
    excerpts = []
    for score, name, zi in sorted(excerpt_candidates, key=lambda x: (-x[0], x[1]))[:EXCERPT_MAX_FILES]:
        try:
            raw = zf.read(zi)[:EXCERPT_MAX_BYTES].decode("utf-8", "replace")
            lines = raw.splitlines()
            body = redact("\n".join(lines[:EXCERPT_MAX_LINES]))
            excerpts.append({"path": name, "score": score, "lines_total": len(lines), "excerpt": body})
        except Exception as e:
            errors.append(f"excerpt {name}: {e}"[:300])

    # ---- write manifest / binaries ------------------------------------------
    man_txt = "path\tsize\tcompressed\tmtime\tkind\n" + "".join(
        f"{r[0]}\t{r[1]}\t{r[2]}\t{r[3]}\t{r[4]}\n" for r in manifest_rows)
    if len(man_txt.encode()) > 15 * 1024 * 1024:
        with gzip.open(os.path.join(outdir, "manifest.tsv.gz"), "wt", encoding="utf-8") as fh:
            fh.write(man_txt)
        manifest_file = "manifest.tsv.gz"
    else:
        with open(os.path.join(outdir, "manifest.tsv"), "w", encoding="utf-8") as fh:
            fh.write(man_txt)
        manifest_file = "manifest.tsv"
    with open(os.path.join(outdir, "binaries.tsv"), "w", encoding="utf-8") as fh:
        fh.write("path\tsize\tformat\tarch\ttype\tcompany|product|version\ttoolchain_hints\timports_or_needed\tnotable_exports\n")
        for r in bin_rows:
            fh.write("\t".join(str(x).replace("\t", " ").replace("\n", " ") for x in r) + "\n")

    # ---- summary -----------------------------------------------------------
    top_dirs = sorted(((k, v[0], v[1]) for k, v in dir_stats.items()), key=lambda x: x[0])
    summary = {
        "archive": os.path.basename(zpath),
        "archive_size": os.path.getsize(zpath),
        "entries": len(infos), "files": n_files, "dirs": n_dirs, "encrypted_entries": encrypted,
        "total_uncompressed": total_unc, "total_compressed": total_comp,
        "kinds": {k: {"files": v[0], "bytes": v[1]} for k, v in sorted(kind_stats.items(), key=lambda x: -x[1][1])},
        "extensions_top": [{"ext": k, "files": v[0], "bytes": v[1]} for k, v in
                           sorted(ext_stats.items(), key=lambda x: -x[1][1])[:60]],
        "dirs_depth1": [{"dir": d, "files": f, "bytes": b} for d, f, b in top_dirs if d.count("/") == 1],
        "dirs_depth2": [{"dir": d, "files": f, "bytes": b} for d, f, b in top_dirs if d.count("/") == 2],
        "dirs_depth3": [{"dir": d, "files": f, "bytes": b} for d, f, b in top_dirs if d.count("/") == 3][:400],
        "largest_files": [{"path": r[0], "size": r[1], "kind": r[4]} for r in
                          sorted(manifest_rows, key=lambda r: -r[1])[:50]],
        "pe_files": len(pe_list), "pe_analyzed": pe_done, "pe_time_budget_hit": budget_hit,
        "other_binaries": len(other_bins),
        "arch_counts": dict(arch_counter),
        "toolchain_hint_counts": dict(toolchain_counter.most_common()),
        "imports_top": imports_counter.most_common(120),
        "plugin_kinds": dict(plugin_kinds),
        "vendors_top": vendor_counter.most_common(40),
        "main_binaries": main_bins,
        "signals": {k: {"count": len(v), "sample": sorted(v)[:60]} for k, v in sorted(signals.items())},
        "excerpts": excerpts,
        "errors_count": len(errors), "errors_sample": errors[:80],
        "manifest_file": manifest_file,
        "elapsed_s": round(time.time() - t0, 1),
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }
    with open(os.path.join(outdir, "summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=1, ensure_ascii=False)

    # ---- REPORT.md -----------------------------------------------------------
    L = []
    w = L.append
    w(f"# Archive analysis: `{summary['archive']}`\n")
    w(f"_Generated {summary['generated_utc']} by `tools/transfer/analyze_zip.py` (text-only; no binaries or license data are stored here)._\n")
    w("## Totals\n")
    w(f"- Archive size: **{human(summary['archive_size'])}** ({summary['archive_size']:,} bytes)")
    w(f"- Entries: {summary['entries']:,} ({n_files:,} files, {n_dirs:,} dirs), encrypted entries: {encrypted}")
    w(f"- Uncompressed total: **{human(total_unc)}**; compressed: {human(total_comp)}")
    w(f"- PE (Windows) binaries: **{len(pe_list):,}** (analyzed {pe_done:,}{', time budget hit' if budget_hit else ''}); other native binaries (ELF/Mach-O): **{len(other_bins):,}**\n")
    w("## Top-level layout\n")
    w("| Directory | Files | Size |\n|---|---:|---:|")
    for d in summary["dirs_depth1"]:
        w(f"| `{d['dir']}` | {d['files']:,} | {human(d['bytes'])} |")
    w("\n### Second level\n")
    w("| Directory | Files | Size |\n|---|---:|---:|")
    for d in sorted(summary["dirs_depth2"], key=lambda x: -x["bytes"])[:80]:
        w(f"| `{d['dir']}` | {d['files']:,} | {human(d['bytes'])} |")
    w("\n## File kinds (by magic bytes)\n")
    w("| Kind | Files | Size |\n|---|---:|---:|")
    for k, v in summary["kinds"].items():
        w(f"| {k} | {v['files']:,} | {human(v['bytes'])} |")
    w("\n## Extensions (top by size)\n")
    w("| Ext | Files | Size |\n|---|---:|---:|")
    for e in summary["extensions_top"][:40]:
        w(f"| `{e['ext']}` | {e['files']:,} | {human(e['bytes'])} |")
    w("\n## Binary architectures\n")
    for k, v in sorted(arch_counter.items(), key=lambda x: -x[1]):
        w(f"- {k}: {v:,}")
    w("\n## Toolchain / framework fingerprints (count of PE files)\n")
    for k, v in toolchain_counter.most_common(60):
        w(f"- {k}: {v:,}")
    w("\n## Plugin entry points found\n")
    for k, v in plugin_kinds.most_common():
        w(f"- {k}: {v:,}")
    if not plugin_kinds:
        w("- none detected")
    w("\n## Vendors (PE version-info CompanyName)\n")
    for k, v in vendor_counter.most_common(40):
        w(f"- {k}: {v:,}")
    w("\n## Windows DLL dependencies (top, by number of importing binaries)\n")
    w(", ".join(f"`{d}`×{c}" for d, c in imports_counter.most_common(120)))
    w("\n## Main / largest binaries\n")
    for b in main_bins:
        v = b.get("version") or {}
        w(f"### `{b['path']}` — {human(b['size'])}")
        w(f"- {b.get('machine')} {'DLL' if b.get('is_dll') else 'EXE'} ({b.get('subsystem')}), built {b.get('timestamp')}, linker {b.get('linker')}")
        if v:
            w("- Version info: " + "; ".join(f"{k}={val}" for k, val in v.items()))
        w(f"- Sections: {', '.join(b.get('sections') or [])}")
        w(f"- Toolchain hints: {'; '.join(b.get('toolchain_hints') or []) or 'n/a'}")
        w(f"- Imports ({len(b.get('imports') or [])}): {', '.join(b.get('imports') or [])}")
        if b.get("notable_exports"):
            w(f"- Notable exports: {', '.join(b['notable_exports'])}")
        if b.get("rcdata_names_sample"):
            w(f"- RCDATA names (sample): {', '.join(b['rcdata_names_sample'][:20])}")
        if b.get("authenticode"):
            w(f"- Authenticode: {b['authenticode'].get('status')}" + (
                f" — signer: {b['authenticode'].get('signer_subject')}" if b['authenticode'].get('signer_subject') else ""))
        w("")
    w("## Porting signals\n")
    if not summary["signals"]:
        w("- none")
    for k, v in summary["signals"].items():
        w(f"### {k} — {v['count']:,}")
        for s in v["sample"][:25]:
            w(f"- `{s}`")
        if v["count"] > 25:
            w(f"- … (+{v['count'] - 25:,} more; see `{manifest_file}`)")
        w("")
    if excerpts:
        w("## Excerpts of porting-related scripts / notes (secret-redacted)\n")
        for ex in excerpts:
            w(f"### `{ex['path']}` ({ex['lines_total']} lines)\n")
            w("```text\n" + ex["excerpt"][:12000].replace("```", "ʼʼʼ") + "\n```\n")
    w("## Largest files\n")
    w("| Path | Size | Kind |\n|---|---:|---|")
    for r in summary["largest_files"][:40]:
        w(f"| `{r['path']}` | {human(r['size'])} | {r['kind']} |")
    if errors:
        w(f"\n## Errors ({len(errors)})\n")
        for e in errors[:40]:
            w(f"- {e}")
    w(f"\n_Elapsed: {summary['elapsed_s']} s. Full listing: `{manifest_file}`; per-binary details: `binaries.tsv`; machine-readable: `summary.json`._\n")
    with open(os.path.join(outdir, "REPORT.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))
    print(f"analysis done: {n_files} files, {len(pe_list)} PE, {len(other_bins)} other binaries, "
          f"{len(errors)} errors, {summary['elapsed_s']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
