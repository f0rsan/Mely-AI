from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build_windows.sh"


def _script_text() -> str:
    return BUILD_SCRIPT.read_text(encoding="utf-8")


def test_windows_training_installer_defaults_to_msi_for_large_runtime():
    script = _script_text()

    assert 'WINDOWS_BUNDLE_TARGETS="${MELY_WINDOWS_BUNDLE_TARGETS:-msi}"' in script
    assert 'npx tauri build --bundles "$WINDOWS_BUNDLE_TARGETS"' in script
    assert "npx tauri build --bundles nsis,msi" not in script
    assert "NSIS can fail" in script


def test_windows_training_installer_validates_bundle_target_override():
    script = _script_text()

    assert "validate_windows_bundle_targets" in script
    assert "msi|nsis|msi,nsis|nsis,msi" in script
    assert "Unsupported MELY_WINDOWS_BUNDLE_TARGETS" in script


def test_windows_training_installer_requires_an_artifact_after_build():
    script = _script_text()

    assert "No Windows installer artifact was produced" in script
    assert "Checked bundle targets: $WINDOWS_BUNDLE_TARGETS" in script


def test_windows_training_installer_blocks_stale_main_checkout():
    script = _script_text()

    assert "assert_release_checkout_current" in script
    assert "git -C \"$REPO_ROOT\" fetch --quiet origin main" in script
    assert "Local main is behind origin/main" in script
    assert "MELY_SKIP_GIT_SYNC_CHECK" in script
