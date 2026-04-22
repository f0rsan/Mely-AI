#!/usr/bin/env python3
"""Resolve WiX localization files for a generated Tauri MSI source file.

The fallback MSI path in scripts/build_windows.sh re-runs candle/light after
patching Tauri's generated WiX source. Tauri normally provides a .wxl locale
file to light.exe; if we do not pass it along, light.exe fails on variables such
as !(loc.TauriLanguage). This helper finds the generated locale file and creates
a small fallback for Tauri's standard strings when the file is unavailable.
"""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from html import escape
from pathlib import Path


LOC_REF_RE = re.compile(r"!\(loc\.([A-Za-z0-9_.-]+)\)")
STRING_ID_RE = re.compile(r"<\s*String\b[^>]*\bId=[\"']([^\"']+)[\"']", re.I)

NUMERIC_DEFAULTS = {
    "TauriLanguage": "1033",
    "TauriCodpage": "1252",
    "TauriCodepage": "1252",
}


def _humanize_identifier(identifier: str) -> str:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", identifier)
    text = text.replace("_", " ").replace("-", " ").replace(".", " ")
    return " ".join(text.split()) or identifier


def _default_value(identifier: str, product_name: str) -> str:
    if identifier in NUMERIC_DEFAULTS:
        return NUMERIC_DEFAULTS[identifier]
    defaults = {
        "InstallAppFeature": f"Install {product_name}",
        "LaunchApp": f"Launch {product_name}",
        "PathEnvVarFeature": "Add the application install directory to PATH",
        "DesktopShortcutFeature": "Create a desktop shortcut",
        "StartMenuShortcutFeature": "Create Start Menu shortcuts",
    }
    return defaults.get(identifier, _humanize_identifier(identifier))


def _loc_references(wxs_path: Path) -> set[str]:
    return set(LOC_REF_RE.findall(wxs_path.read_text(encoding="utf-8")))


def _string_ids(locale_path: Path) -> set[str]:
    text = locale_path.read_text(encoding="utf-8", errors="replace")
    ids = set(STRING_ID_RE.findall(text))
    if ids:
        return ids

    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return set()
    return {
        element.attrib["Id"]
        for element in root.iter()
        if element.tag.endswith("String") and "Id" in element.attrib
    }


def _find_locale_files(search_dirs: list[Path], fallback_path: Path) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    fallback_resolved = fallback_path.resolve()
    for search_dir in search_dirs:
        if not search_dir.exists():
            continue
        for path in sorted(search_dir.rglob("*.wxl")):
            resolved = path.resolve()
            if resolved == fallback_resolved or resolved in seen:
                continue
            seen.add(resolved)
            files.append(path)
    return files


def _locale_sort_key(path: Path) -> tuple[int, int, str]:
    name = path.name.lower()
    en_us_rank = 0 if "en-us" in name or "en_us" in name else 1
    main_rank = 0 if "main" in name or "tauri" in name else 1
    return (en_us_rank, main_rank, str(path).lower())


def _select_locale_files(locale_files: list[Path], required_ids: set[str]) -> tuple[list[Path], set[str]]:
    covered: set[str] = set()
    selected: list[Path] = []
    metadata: list[tuple[Path, set[str]]] = [
        (path, _string_ids(path) & required_ids) for path in locale_files
    ]

    for path, ids in sorted(metadata, key=lambda item: _locale_sort_key(item[0])):
        if not ids:
            continue
        if ids - covered:
            selected.append(path)
            covered.update(ids)
        if covered >= required_ids:
            break
    return selected, required_ids - covered


def _write_fallback_locale(fallback_path: Path, missing_ids: set[str], product_name: str) -> None:
    fallback_path.parent.mkdir(parents=True, exist_ok=True)
    strings = "\n".join(
        f'  <String Id="{escape(identifier, quote=True)}">'
        f"{escape(_default_value(identifier, product_name))}</String>"
        for identifier in sorted(missing_ids)
    )
    fallback_path.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<WixLocalization Culture="en-us" '
        'xmlns="http://schemas.microsoft.com/wix/2006/localization">\n'
        f"{strings}\n"
        "</WixLocalization>\n",
        encoding="utf-8",
    )


def resolve_locale_files(
    *,
    wxs_path: Path,
    search_dirs: list[Path],
    fallback_path: Path,
    product_name: str,
) -> list[Path]:
    required_ids = _loc_references(wxs_path)
    if not required_ids:
        if fallback_path.exists():
            fallback_path.unlink()
        return []

    locale_files = _find_locale_files(search_dirs, fallback_path)
    selected, missing = _select_locale_files(locale_files, required_ids)
    if missing:
        _write_fallback_locale(fallback_path, missing, product_name)
        selected.append(fallback_path)
        print(
            "[wix-loc] generated fallback localization for missing ids: "
            + ", ".join(sorted(missing)),
            file=sys.stderr,
        )
    elif fallback_path.exists():
        fallback_path.unlink()

    return selected


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Find or generate WiX .wxl files required by a Tauri main.wxs file."
    )
    parser.add_argument("--wxs", required=True, help="Path to generated main.wxs")
    parser.add_argument(
        "--search-dir",
        action="append",
        default=[],
        help="Directory to search recursively for .wxl files; can be repeated",
    )
    parser.add_argument(
        "--fallback-path",
        required=True,
        help="Path to write fallback localization when generated .wxl files are missing",
    )
    parser.add_argument("--product-name", default="Mely AI")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    wxs_path = Path(args.wxs).expanduser().resolve()
    if not wxs_path.exists():
        print(f"[wix-loc] main.wxs not found: {wxs_path}", file=sys.stderr)
        return 1

    locale_files = resolve_locale_files(
        wxs_path=wxs_path,
        search_dirs=[Path(path).expanduser().resolve() for path in args.search_dir],
        fallback_path=Path(args.fallback_path).expanduser().resolve(),
        product_name=args.product_name,
    )
    for locale_file in locale_files:
        print(locale_file)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
