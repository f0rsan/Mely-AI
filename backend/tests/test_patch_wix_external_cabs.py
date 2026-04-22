from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
PATCH_SCRIPT = REPO_ROOT / "scripts" / "patch_wix_for_external_cabs.py"


def _load_patch_module():
    spec = importlib.util.spec_from_file_location("patch_wix_for_external_cabs", PATCH_SCRIPT)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_patch_wix_media_uses_external_split_cabs(tmp_path: Path):
    module = _load_patch_module()
    wxs = tmp_path / "main.wxs"
    wxs.write_text(
        '<Wix><Product><Media Id="1" Cabinet="app.cab" EmbedCab="yes" /></Product></Wix>',
        encoding="utf-8",
    )

    changed = module.patch_wix_media_template(wxs)

    assert changed is True
    patched = wxs.read_text(encoding="utf-8")
    assert 'EmbedCab="no"' in patched
    assert 'MaximumUncompressedMediaSize="512"' in patched
    assert 'MaximumCabinetSizeForLargeFileSplitting="512"' in patched
    assert "app.cab" not in patched


def test_patch_wix_media_is_idempotent(tmp_path: Path):
    module = _load_patch_module()
    wxs = tmp_path / "main.wxs"
    wxs.write_text(
        '<Wix><Product><MediaTemplate EmbedCab="no" MaximumUncompressedMediaSize="512" '
        'MaximumCabinetSizeForLargeFileSplitting="512" /></Product></Wix>',
        encoding="utf-8",
    )

    assert module.patch_wix_media_template(wxs) is False


def test_patch_wix_media_fails_when_template_shape_is_unknown(tmp_path: Path):
    module = _load_patch_module()
    wxs = tmp_path / "main.wxs"
    wxs.write_text("<Wix><Product /></Wix>", encoding="utf-8")

    with pytest.raises(RuntimeError, match="无法切换到外置 CAB"):
        module.patch_wix_media_template(wxs)
