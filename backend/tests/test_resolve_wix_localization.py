from __future__ import annotations

import importlib.util
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RESOLVER_SCRIPT = REPO_ROOT / "scripts" / "resolve_wix_localization.py"


def _load_resolver_module():
    spec = importlib.util.spec_from_file_location("resolve_wix_localization", RESOLVER_SCRIPT)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_resolver_uses_existing_tauri_locale_file(tmp_path: Path):
    module = _load_resolver_module()
    wxs = tmp_path / "main.wxs"
    wxs.write_text(
        '<Product Language="!(loc.TauriLanguage)" Codepage="!(loc.TauriCodpage)">'
        '<Feature Title="!(loc.InstallAppFeature)" /></Product>',
        encoding="utf-8",
    )
    locale = tmp_path / "main.en-US.wxl"
    locale.write_text(
        '<?xml version="1.0" encoding="utf-8"?>'
        '<WixLocalization Culture="en-us" '
        'xmlns="http://schemas.microsoft.com/wix/2006/localization">'
        '<String Id="TauriLanguage">1033</String>'
        '<String Id="TauriCodpage">1252</String>'
        '<String Id="InstallAppFeature">Install Mely AI</String>'
        "</WixLocalization>",
        encoding="utf-8",
    )
    fallback = tmp_path / "fallback.wxl"

    resolved = module.resolve_locale_files(
        wxs_path=wxs,
        search_dirs=[tmp_path],
        fallback_path=fallback,
        product_name="Mely AI",
    )

    assert resolved == [locale]
    assert not fallback.exists()


def test_resolver_generates_fallback_for_missing_tauri_locale(tmp_path: Path):
    module = _load_resolver_module()
    wxs = tmp_path / "main.wxs"
    wxs.write_text(
        '<Product Language="!(loc.TauriLanguage)" Codepage="!(loc.TauriCodpage)">'
        '<Feature Title="!(loc.InstallAppFeature)" />'
        '<Shortcut Name="!(loc.LaunchApp)" />'
        '<Feature Title="!(loc.PathEnvVarFeature)" /></Product>',
        encoding="utf-8",
    )
    fallback = tmp_path / "mely-tauri-fallback.en-US.wxl"

    resolved = module.resolve_locale_files(
        wxs_path=wxs,
        search_dirs=[tmp_path],
        fallback_path=fallback,
        product_name="Mely AI",
    )

    assert resolved == [fallback]
    fallback_text = fallback.read_text(encoding="utf-8")
    assert '<String Id="TauriLanguage">1033</String>' in fallback_text
    assert '<String Id="TauriCodpage">1252</String>' in fallback_text
    assert '<String Id="InstallAppFeature">Install Mely AI</String>' in fallback_text
    assert '<String Id="LaunchApp">Launch Mely AI</String>' in fallback_text
    assert "Add the application install directory to PATH" in fallback_text


def test_resolver_adds_fallback_only_for_missing_ids(tmp_path: Path):
    module = _load_resolver_module()
    wxs = tmp_path / "main.wxs"
    wxs.write_text(
        '<Product Language="!(loc.TauriLanguage)" Codepage="!(loc.TauriCodpage)" />',
        encoding="utf-8",
    )
    locale = tmp_path / "main.en-US.wxl"
    locale.write_text(
        '<?xml version="1.0" encoding="utf-8"?>'
        '<WixLocalization Culture="en-us" '
        'xmlns="http://schemas.microsoft.com/wix/2006/localization">'
        '<String Id="TauriLanguage">1033</String>'
        "</WixLocalization>",
        encoding="utf-8",
    )
    fallback = tmp_path / "fallback.wxl"

    resolved = module.resolve_locale_files(
        wxs_path=wxs,
        search_dirs=[tmp_path],
        fallback_path=fallback,
        product_name="Mely AI",
    )

    assert resolved == [locale, fallback]
    assert '<String Id="TauriCodpage">1252</String>' in fallback.read_text(encoding="utf-8")
