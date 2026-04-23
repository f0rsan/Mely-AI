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
    assert "find_current_build_file" in script
    assert 'INSTALLER=$(find_current_build_file "$NSIS_BUNDLE_DIR" "Mely AI_${BUILD_VERSION}_x64-setup.exe")' in script
    assert 'MSI=$(find_current_build_file "$MSI_BUNDLE_DIR" "Mely AI_${BUILD_VERSION}_x64_en-US.msi")' in script
    assert 'CAB_COUNT=$(count_matching_files "$MSI_BUNDLE_DIR" "*.cab")' in script
    assert 'CAB_SIZE=$(matching_files_total_size_human "$MSI_BUNDLE_DIR" "*.cab")' in script
    assert 'INSTALLER=$(find "$REPO_ROOT/src-tauri/target/release/bundle/nsis"' not in script


def test_windows_training_installer_does_not_delete_busy_bundle_directories():
    script = _script_text()

    assert "prepare_windows_bundle_output_dirs" in script
    assert "Do not remove the bundle directories themselves" in script
    assert 'rm -rf "$REPO_ROOT/src-tauri/target/release/bundle/nsis"' not in script
    assert 'rm -rf "$REPO_ROOT/src-tauri/target/release/bundle/msi"' not in script
    assert "Device or resource busy" not in script


def test_windows_training_installer_blocks_stale_main_checkout():
    script = _script_text()

    assert "assert_release_checkout_current" in script
    assert "git -C \"$REPO_ROOT\" fetch --quiet origin main" in script
    assert "Local main is behind origin/main" in script
    assert "MELY_SKIP_GIT_SYNC_CHECK" in script


def test_windows_training_installer_retries_large_msi_with_external_cabs():
    script = _script_text()

    assert "should_retry_wix_external_cabs" in script
    assert "failed to run .*light\\\\.exe" in script
    assert "switching to external CAB fallback" in script
    assert "rerun_wix_with_external_cabs" in script
    assert "patch_wix_for_external_cabs.py" in script
    assert "resolve_wix_localization.py" in script
    assert "--fallback-path \"$wix_work_dir/mely-tauri-fallback.en-US.wxl\"" in script
    assert '> "$wix_locale_list"' in script
    assert 'light_args+=(-loc "$wix_locale_file")' in script
    assert "External-CAB MSI produced" in script
    assert "keep the .cab files next to the .msi" in script


def test_windows_training_installer_records_tauri_build_log_and_can_run_verbose():
    script = _script_text()

    assert 'TAURI_BUILD_LOG_PATH="$REPO_ROOT/build/windows-tauri-build.log"' in script
    assert 'VERBOSE_TAURI_BUILD_LOG="${MELY_WINDOWS_VERBOSE_TAURI_BUILD:-0}"' in script
    assert 'npx tauri build --bundles "$WINDOWS_BUNDLE_TARGETS" --config "$BUILD_TAURI_CONFIG_PATH" >"$TAURI_BUILD_LOG_PATH" 2>&1' in script
    assert 'npx tauri build --bundles "$WINDOWS_BUNDLE_TARGETS" --config "$BUILD_TAURI_CONFIG_PATH" 2>&1 | tee "$TAURI_BUILD_LOG_PATH"' in script
