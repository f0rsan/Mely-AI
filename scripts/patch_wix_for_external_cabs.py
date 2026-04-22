#!/usr/bin/env python3
"""Patch a generated WiX .wxs file to use external split CAB files.

Tauri's default WiX template embeds app.cab into the MSI. That breaks for the
Windows training build because the offline LLM runtime pushes the package past
Windows Installer's practical 2 GB self-contained MSI limit.
"""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_EXTERNAL_MEDIA = (
    '<MediaTemplate EmbedCab="no" MaximumUncompressedMediaSize="512" '
    'MaximumCabinetSizeForLargeFileSplitting="512" />'
)


def patch_wix_media_template(wxs_path: Path) -> bool:
    text = wxs_path.read_text(encoding="utf-8")
    original = text

    replacements = {
        '<Media Id="1" Cabinet="app.cab" EmbedCab="yes" />': DEFAULT_EXTERNAL_MEDIA,
        '<MediaTemplate EmbedCab="yes" />': DEFAULT_EXTERNAL_MEDIA,
    }
    for old, new in replacements.items():
        text = text.replace(old, new)

    if text == original:
        if DEFAULT_EXTERNAL_MEDIA in text:
            return False
        raise RuntimeError(
            "未找到 Tauri 默认的 WiX Media 配置，无法切换到外置 CAB。"
        )

    wxs_path.write_text(text, encoding="utf-8")
    return True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Patch generated Tauri WiX source to use external split CAB files."
    )
    parser.add_argument("wxs_path", help="Path to generated main.wxs")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    wxs_path = Path(args.wxs_path).expanduser().resolve()
    if not wxs_path.exists():
        print(f"[patch-wix] main.wxs not found: {wxs_path}")
        return 1

    try:
        changed = patch_wix_media_template(wxs_path)
    except RuntimeError as exc:
        print(f"[patch-wix] {exc}")
        return 1

    if changed:
        print(f"[patch-wix] patched external CAB media: {wxs_path}")
    else:
        print(f"[patch-wix] external CAB media already configured: {wxs_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
