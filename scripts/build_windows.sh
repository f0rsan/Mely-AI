#!/usr/bin/env bash
# =============================================================================
# build_windows.sh — Full Windows release build pipeline for Mely AI
#
# Run this on a native Windows shell (Git Bash / PowerShell / CMD) or a
# Windows CI runner. Do NOT run it inside WSL/Linux: Tauri will build Linux
# bundles there and never produce the Windows installer.
# Prerequisites:
#   - Python 3.12+ with virtualenv
#   - Python 3.11 runtime for LLM training seed package
#   - Node.js 20+
#   - Rust stable + cargo
#   - pyinstaller  (pip install pyinstaller)
#   - UPX (optional, for smaller binaries — https://github.com/upx/upx)
#
# Optional:
#   - set MELY_LLM_RUNTIME_PYTHON to pin the independent runtime interpreter
#     used by scripts/build_windows_llm_runtime.py (recommended).
#   - set MELY_WINDOWS_BUNDLE_TARGETS to override the installer bundle target.
#     Defaults to "msi" because the full offline training runtime is too large
#     for reliable NSIS packaging. Use "nsis" only for smaller builds.
#   - set MELY_SKIP_GIT_SYNC_CHECK=1 only when intentionally building a local
#     branch or offline checkout.
#
# Usage:
#   bash scripts/build_windows.sh
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
DIST_DIR="$BACKEND_DIR/dist/mely-backend"
STAGED_RESOURCES_DIR="$REPO_ROOT/src-tauri/resources/mely-backend"
STAGED_LLM_RUNTIME_DIR="$REPO_ROOT/src-tauri/resources/llm-runtime"
STAGED_RELEASE_SUMMARY_PATH="$REPO_ROOT/src-tauri/resources/windows-training-release-artifacts.txt"
RUNTIME_BUILD_DIR="$REPO_ROOT/build/windows-llm-runtime/llm-runtime"
RELEASE_SUMMARY_PATH="$REPO_ROOT/build/windows-training-release-artifacts.txt"
BUILD_TAURI_CONFIG_PATH="$REPO_ROOT/build/windows-tauri.build.json"
CARGO_MANIFEST_PATH="$REPO_ROOT/src-tauri/Cargo.toml"
CARGO_MANIFEST_BACKUP_PATH="$REPO_ROOT/build/windows-cargo.toml.backup"
WINDOWS_BUNDLE_TARGETS="${MELY_WINDOWS_BUNDLE_TARGETS:-msi}"
HOST_UNAME="$(uname -s)"

is_wsl() {
  if [ -n "${WSL_DISTRO_NAME:-}" ]; then
    return 0
  fi

  if [ -r /proc/version ] && grep -qi "microsoft" /proc/version; then
    return 0
  fi

  return 1
}

is_native_windows_shell() {
  case "$HOST_UNAME" in
    MINGW*|MSYS*|CYGWIN*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

path_size_human() {
  local target="$1"
  if [ -d "$target" ] || [ -f "$target" ]; then
    du -sh "$target" | cut -f1
    return 0
  fi
  echo "N/A"
}

resolve_windows_build_version() {
  local explicit_version="${MELY_BUILD_VERSION:-}"
  if [ -n "$explicit_version" ]; then
    echo "$explicit_version"
    return 0
  fi

  local commit_count
  commit_count=$(git -C "$REPO_ROOT" rev-list --count HEAD 2>/dev/null || true)
  if [ -n "$commit_count" ]; then
    echo "0.1.${commit_count}"
    return 0
  fi

  echo "0.1.$(date +%s)"
}

validate_semver_version() {
  local version="$1"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERROR: Invalid build version '$version'. Expected MAJOR.MINOR.PATCH." >&2
    exit 1
  fi
}

validate_windows_bundle_targets() {
  local targets="$1"
  case "$targets" in
    msi|nsis|msi,nsis|nsis,msi)
      return 0
      ;;
    *)
      echo "ERROR: Unsupported MELY_WINDOWS_BUNDLE_TARGETS='$targets'." >&2
      echo "Use one of: msi, nsis, msi,nsis, nsis,msi." >&2
      exit 1
      ;;
  esac
}

windows_bundle_targets_include() {
  local target="$1"
  local targets=",$WINDOWS_BUNDLE_TARGETS,"
  [[ "$targets" == *",$target,"* ]]
}

windows_env_path_to_shell_path() {
  local raw_path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$raw_path"
    return 0
  fi
  echo "$raw_path"
}

assert_release_checkout_current() {
  if [ "${MELY_SKIP_GIT_SYNC_CHECK:-}" = "1" ]; then
    echo "WARNING: Skipping git sync check because MELY_SKIP_GIT_SYNC_CHECK=1"
    return 0
  fi

  if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  local current_branch
  current_branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [ "$current_branch" != "main" ]; then
    echo "WARNING: Building from branch '$current_branch'; main sync check is skipped."
    return 0
  fi

  if ! git -C "$REPO_ROOT" remote get-url origin >/dev/null 2>&1; then
    return 0
  fi

  if ! git -C "$REPO_ROOT" fetch --quiet origin main >/dev/null 2>&1; then
    echo "WARNING: Could not refresh origin/main. Continuing with local checkout." >&2
    return 0
  fi

  if ! git -C "$REPO_ROOT" rev-parse --verify origin/main >/dev/null 2>&1; then
    return 0
  fi

  if ! git -C "$REPO_ROOT" merge-base --is-ancestor origin/main HEAD; then
    echo "ERROR: Local main is behind origin/main." >&2
    echo "This Windows build would run stale packaging code. Please run:" >&2
    echo "  git pull --ff-only origin main" >&2
    echo "Then rerun: bash scripts/build_windows.sh" >&2
    exit 1
  fi
}

rerun_wix_with_external_cabs() {
  local build_version="$1"
  local wix_arch="x64"
  local wix_work_dir="$REPO_ROOT/src-tauri/target/release/wix/$wix_arch"
  local wxs_path="$wix_work_dir/main.wxs"
  local wix_tools_root="${LOCALAPPDATA:-}"
  local wix_tools_dir
  local candle_exe
  local light_exe
  local msi_dir="$REPO_ROOT/src-tauri/target/release/bundle/msi"
  local msi_path="$msi_dir/Mely AI_${build_version}_${wix_arch}_en-US.msi"
  local light_args
  local wix_locale_files=()
  local wix_locale_file
  local wix_locale_list="$wix_work_dir/mely-wix-locales.txt"

  if [ ! -f "$wxs_path" ]; then
    echo "ERROR: Tauri MSI build failed before generating WiX source: $wxs_path" >&2
    return 1
  fi

  if [ -z "$wix_tools_root" ]; then
    echo "ERROR: LOCALAPPDATA is not set; cannot locate Tauri WiX tools." >&2
    return 1
  fi

  wix_tools_dir="$(windows_env_path_to_shell_path "$wix_tools_root")/tauri/WixTools314"
  candle_exe="$wix_tools_dir/candle.exe"
  light_exe="$wix_tools_dir/light.exe"
  if [ ! -x "$candle_exe" ] || [ ! -x "$light_exe" ]; then
    echo "ERROR: WiX tools not found under $wix_tools_dir" >&2
    return 1
  fi

  echo "Tauri MSI bundling failed. Retrying WiX with external CAB files for the large training runtime."
  python scripts/patch_wix_for_external_cabs.py "$wxs_path"
  mkdir -p "$msi_dir"
  rm -f "$msi_dir"/*.msi "$msi_dir"/*.cab "$wix_work_dir"/*.wixobj "$wix_work_dir"/*.wixpdb "$wix_work_dir"/*.cab

  python scripts/resolve_wix_localization.py \
    --wxs "$wxs_path" \
    --search-dir "$wix_work_dir" \
    --search-dir "$REPO_ROOT/src-tauri/target/release/wix" \
    --fallback-path "$wix_work_dir/mely-tauri-fallback.en-US.wxl" \
    --product-name "Mely AI" \
    > "$wix_locale_list"
  while IFS= read -r wix_locale_file; do
    if [ -n "$wix_locale_file" ]; then
      wix_locale_files+=("$wix_locale_file")
    fi
  done < "$wix_locale_list"
  rm -f "$wix_locale_list"
  if [ "${#wix_locale_files[@]}" -gt 0 ]; then
    echo "Using WiX localization file(s):"
    for wix_locale_file in "${wix_locale_files[@]}"; do
      echo "  - $wix_locale_file"
    done
  fi

  "$candle_exe" \
    -arch "$wix_arch" \
    -ext WixUtilExtension \
    -ext WixUIExtension \
    -out "$wix_work_dir/main.wixobj" \
    "$wxs_path"

  light_args=()
  for wix_locale_file in "${wix_locale_files[@]}"; do
    light_args+=(-loc "$wix_locale_file")
  done
  light_args+=(
    -ext WixUtilExtension
    -ext WixUIExtension
    -cultures:en-us
    -spdb
    -b "$wix_work_dir"
    -out "$msi_path"
    "$wix_work_dir/main.wixobj"
  )

  "$light_exe" "${light_args[@]}"

  find "$wix_work_dir" -maxdepth 1 -name "*.cab" -exec cp "{}" "$msi_dir/" \;
  if [ ! -f "$msi_path" ]; then
    echo "ERROR: External-CAB MSI was not produced at $msi_path" >&2
    return 1
  fi
  if ! find "$msi_dir" -maxdepth 1 -name "*.cab" | grep -q .; then
    echo "ERROR: External-CAB MSI was produced without CAB payload files." >&2
    return 1
  fi
  echo "External-CAB MSI produced: $msi_path"
}

write_tauri_build_config() {
  local source_config="$1"
  local target_config="$2"
  local build_version="$3"

  python - "$source_config" "$target_config" "$build_version" <<'PY'
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
version = sys.argv[3]

payload = json.loads(source.read_text(encoding="utf-8"))
payload["version"] = version
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
}

write_cargo_build_version() {
  local cargo_toml_path="$1"
  local build_version="$2"

  python - "$cargo_toml_path" "$build_version" <<'PY'
import pathlib
import sys

cargo_toml = pathlib.Path(sys.argv[1])
version = sys.argv[2]
lines = cargo_toml.read_text(encoding="utf-8").splitlines(keepends=True)

in_package = False
replaced = False
updated: list[str] = []
for line in lines:
    stripped = line.strip()
    if stripped.startswith("[") and stripped.endswith("]"):
        in_package = stripped == "[package]"
    elif in_package and stripped.startswith("version"):
        indent = line[: len(line) - len(line.lstrip())]
        newline = "\n" if line.endswith("\n") else ""
        updated.append(f'{indent}version = "{version}"{newline}')
        replaced = True
        continue
    updated.append(line)

if not replaced:
    raise SystemExit("failed to locate [package] version field in Cargo.toml")

cargo_toml.write_text("".join(updated), encoding="utf-8")
PY
}

restore_cargo_manifest_if_needed() {
  if [ -f "$CARGO_MANIFEST_BACKUP_PATH" ]; then
    mv "$CARGO_MANIFEST_BACKUP_PATH" "$CARGO_MANIFEST_PATH"
  fi
}

assert_backend_endpoint_ok() {
  local url="$1"
  local label="$2"
  local status

  status=$(python - "$url" <<'PY'
import sys
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

url = sys.argv[1]
try:
    with urlopen(url, timeout=10) as response:
        print(response.status)
except HTTPError as exc:
    print(exc.code)
except URLError:
    print("0")
PY
)

  if [ "$status" != "200" ]; then
    echo "ERROR: Sidecar endpoint check failed for $label: HTTP $status" >&2
    echo "URL: $url" >&2
    exit 1
  fi
  echo "Sidecar endpoint OK: $label"
}

assert_sidecar_without_training_runtime_deps() {
  local sidecar_dir="$1"
  local pattern='(^|[/\\._-])(torch|torchvision|torchao|unsloth|unsloth_zoo|datasets|transformers|trl|bitsandbytes|xformers|diffusers|peft|triton|triton_windows)($|[/\\._-])'
  local hits

  hits=$(find "$sidecar_dir" -mindepth 1 -print | grep -Ei "$pattern" || true)
  if [ -n "$hits" ]; then
    echo "ERROR: backend sidecar should NOT include LLM training runtime dependencies." >&2
    echo "Found forbidden paths under $sidecar_dir:" >&2
    echo "$hits" | sed 's/^/  - /' >&2
    echo "Please keep torch/unsloth stack in the standalone llm-runtime resource bundle only." >&2
    exit 1
  fi
}

if is_wsl || [ "$HOST_UNAME" = "Linux" ] || [ "$HOST_UNAME" = "Darwin" ]; then
  echo "ERROR: scripts/build_windows.sh must be run from a native Windows shell." >&2
  echo "Current environment: $HOST_UNAME" >&2
  if is_wsl; then
    echo "Detected WSL. Tauri will build Linux bundles here (deb/rpm/AppImage), not Windows installers." >&2
  fi
  echo "Please open PowerShell, CMD, or Git Bash on Windows and run:" >&2
  echo "  bash scripts/build_windows.sh" >&2
  exit 1
fi

if ! is_native_windows_shell; then
  echo "ERROR: Unsupported shell environment for Windows packaging: $HOST_UNAME" >&2
  echo "Use Git Bash, PowerShell, or CMD on Windows." >&2
  exit 1
fi

assert_release_checkout_current

echo "=== [1/6] Build Python backend sidecar with PyInstaller ==="
cd "$BACKEND_DIR"

# Install dependencies into a clean venv if not already present.
if [ ! -d ".venv" ]; then
  python -m venv .venv
fi

# Activate venv
if [ -f ".venv/Scripts/activate" ]; then
  # Windows (Git Bash)
  source .venv/Scripts/activate
else
  source .venv/bin/activate
fi

pip install --upgrade pip
pip install -e ".[dev]"
pip install pyinstaller

export PYINSTALLER_CONFIG_DIR="${PYINSTALLER_CONFIG_DIR:-$REPO_ROOT/tmp/pyinstaller-config}"
mkdir -p "$PYINSTALLER_CONFIG_DIR"

# Clean previous build artifacts.
rm -rf build dist

# Build using the spec file.
# The output lands in dist/mely-backend/
pyinstaller --noconfirm mely_backend.spec

echo ""
echo "=== [1/6] Backend sidecar built: $DIST_DIR ==="
ls -lh "$DIST_DIR/mely-backend.exe" 2>/dev/null || ls -lh "$DIST_DIR/mely-backend" || true

# ---------------------------------------------------------------------------
# Sanity check: make sure the exe actually starts and exits cleanly.
# We send it a SIGTERM after 3 seconds — if it starts, it should have bound
# port 8000 by then.
# ---------------------------------------------------------------------------
echo ""
echo "=== [1b/6] Smoke-test the sidecar binary ==="
if [ -f "$DIST_DIR/mely-backend.exe" ]; then
  BACKEND_BIN="$DIST_DIR/mely-backend.exe"
else
  BACKEND_BIN="$DIST_DIR/mely-backend"
fi

MELY_BACKEND_PORT=18999 "$BACKEND_BIN" &
BACKEND_PID=$!
cleanup_backend_smoke_test() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup_backend_smoke_test EXIT
sleep 4

if kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "Sidecar is running (PID $BACKEND_PID) — smoke test PASSED"
  assert_backend_endpoint_ok "http://127.0.0.1:18999/api/health" "health"
  assert_backend_endpoint_ok "http://127.0.0.1:18999/api/llm-runtime/readiness?mode=standard&baseModel=qwen2.5%3A3b&autoFix=false" "LLM runtime readiness"
  cleanup_backend_smoke_test
  trap - EXIT
else
  echo "ERROR: Sidecar exited before smoke test completed. Check PyInstaller output." >&2
  trap - EXIT
  exit 1
fi

echo ""
echo "=== [1c/6] Verify sidecar excludes training runtime dependencies ==="
assert_sidecar_without_training_runtime_deps "$DIST_DIR"
echo "Sidecar dependency separation check PASSED"

echo ""
echo "=== [2/6] Stage backend into Tauri resources ==="
cd "$REPO_ROOT"
python scripts/prepare_tauri_backend.py --require-source-fresh --verify-api-compatibility

if [ -f "$STAGED_RESOURCES_DIR/mely-backend.exe" ]; then
  STAGED_BACKEND_BIN="$STAGED_RESOURCES_DIR/mely-backend.exe"
else
  STAGED_BACKEND_BIN="$STAGED_RESOURCES_DIR/mely-backend"
fi

if [ ! -f "$STAGED_BACKEND_BIN" ]; then
  echo "ERROR: Staged backend executable not found at $STAGED_BACKEND_BIN" >&2
  exit 1
fi

echo "Staged backend bundle:"
ls -lh "$STAGED_BACKEND_BIN"

echo ""
echo "=== [3/6] Build Windows LLM GPU runtime seed package ==="
RUNTIME_PYTHON_ARGS=()
if [ -n "${MELY_LLM_RUNTIME_PYTHON:-}" ]; then
  RUNTIME_PYTHON_ARGS+=(--runtime-python "$MELY_LLM_RUNTIME_PYTHON")
fi

python scripts/build_windows_llm_runtime.py \
  --output-dir "$REPO_ROOT/build/windows-llm-runtime" \
  --stage-dir "$STAGED_LLM_RUNTIME_DIR" \
  "${RUNTIME_PYTHON_ARGS[@]}"

if [ ! -f "$STAGED_LLM_RUNTIME_DIR/manifest.json" ]; then
  echo "ERROR: Staged LLM runtime manifest not found at $STAGED_LLM_RUNTIME_DIR/manifest.json" >&2
  exit 1
fi

echo "Staged LLM runtime bundle:"
ls -lh "$STAGED_LLM_RUNTIME_DIR/manifest.json"
ls -lh "$STAGED_LLM_RUNTIME_DIR/SHA256SUMS.txt"
echo "Runtime build directory: $RUNTIME_BUILD_DIR ($(path_size_human "$RUNTIME_BUILD_DIR"))"
echo "Staged runtime directory: $STAGED_LLM_RUNTIME_DIR ($(path_size_human "$STAGED_LLM_RUNTIME_DIR"))"
python scripts/verify_tauri_runtime_resources.py

echo ""
echo "=== [4/6] Install frontend dependencies ==="
cd "$REPO_ROOT"
npm ci

echo ""
echo "=== [5/6] Build Tauri Windows installer ==="
# Remove previous release bundle outputs so the final installer path always
# points to the current build rather than a stale artifact left in target/.
rm -rf "$REPO_ROOT/src-tauri/target/release/bundle/nsis" \
       "$REPO_ROOT/src-tauri/target/release/bundle/msi"

# tauri build will:
#   1. Run `python scripts/prepare_tauri_backend.py --require-source-fresh --verify-api-compatibility && npm run build`
#   2. Compile the Rust shell
#   3. Bundle everything into the selected Windows installer target.
#
# The full training build includes a multi-GB offline wheelhouse. NSIS can fail
# with an internal mmapping/datablock compiler error on that payload, so MSI is
# the default release target. NSIS remains opt-in for smaller/non-training builds
# via MELY_WINDOWS_BUNDLE_TARGETS=nsis.
BUILD_VERSION="$(resolve_windows_build_version)"
validate_semver_version "$BUILD_VERSION"
validate_windows_bundle_targets "$WINDOWS_BUNDLE_TARGETS"
write_tauri_build_config "$REPO_ROOT/src-tauri/tauri.conf.json" "$BUILD_TAURI_CONFIG_PATH" "$BUILD_VERSION"
mkdir -p "$(dirname "$CARGO_MANIFEST_BACKUP_PATH")"
cp "$CARGO_MANIFEST_PATH" "$CARGO_MANIFEST_BACKUP_PATH"
trap restore_cargo_manifest_if_needed EXIT
write_cargo_build_version "$CARGO_MANIFEST_PATH" "$BUILD_VERSION"
mkdir -p "$(dirname "$STAGED_RELEASE_SUMMARY_PATH")"
{
  echo "timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "build_version=$BUILD_VERSION"
  echo "note=Bundled pre-build summary. Full release summary is generated under build/ after packaging."
} > "$STAGED_RELEASE_SUMMARY_PATH"
echo "Using Windows installer version: $BUILD_VERSION"
echo "Using Windows bundle target(s): $WINDOWS_BUNDLE_TARGETS"
set +e
npx tauri build --bundles "$WINDOWS_BUNDLE_TARGETS" --config "$BUILD_TAURI_CONFIG_PATH"
TAURI_BUILD_STATUS=$?
set -e
if [ "$TAURI_BUILD_STATUS" -ne 0 ]; then
  if windows_bundle_targets_include "msi"; then
    rerun_wix_with_external_cabs "$BUILD_VERSION"
  else
    exit "$TAURI_BUILD_STATUS"
  fi
fi
restore_cargo_manifest_if_needed
trap - EXIT

echo ""
echo "=== [5b/6] Smoke-test the built desktop executable ==="
DESKTOP_EXE="$REPO_ROOT/src-tauri/target/release/mely-ai.exe"
if [ ! -f "$DESKTOP_EXE" ]; then
  echo "ERROR: Built desktop executable not found at $DESKTOP_EXE" >&2
  exit 1
fi
python scripts/verify_windows_desktop_backend.py --executable "$DESKTOP_EXE"

echo ""
echo "=== [6/6] Collect artifact summary ==="
INSTALLER=$(find "$REPO_ROOT/src-tauri/target/release/bundle/nsis" -name "*.exe" 2>/dev/null | head -1)
MSI=$(find "$REPO_ROOT/src-tauri/target/release/bundle/msi" -name "*.msi" 2>/dev/null | head -1)
CAB_COUNT=$(find "$REPO_ROOT/src-tauri/target/release/bundle/msi" -name "*.cab" 2>/dev/null | wc -l | tr -d ' ')
CAB_SIZE=$(find "$REPO_ROOT/src-tauri/target/release/bundle/msi" -name "*.cab" -print0 2>/dev/null | du -ch --files0-from=- 2>/dev/null | tail -1 | cut -f1 || true)

if [ -z "${INSTALLER:-}" ] && [ -z "${MSI:-}" ]; then
  echo "ERROR: No Windows installer artifact was produced." >&2
  echo "Checked bundle targets: $WINDOWS_BUNDLE_TARGETS" >&2
  exit 1
fi

if [ -n "$INSTALLER" ]; then
  SIZE=$(du -h "$INSTALLER" | cut -f1)
  echo "NSIS installer: $INSTALLER ($SIZE)"
fi
if [ -n "$MSI" ]; then
  SIZE=$(du -h "$MSI" | cut -f1)
  echo "MSI installer:  $MSI ($SIZE)"
  if [ "${CAB_COUNT:-0}" != "0" ]; then
    echo "MSI CAB files:  $CAB_COUNT (${CAB_SIZE:-N/A})"
    echo "IMPORTANT: keep the .cab files next to the .msi when distributing this build."
  fi
fi

mkdir -p "$(dirname "$RELEASE_SUMMARY_PATH")"
{
  echo "timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "backend_sidecar=$STAGED_BACKEND_BIN"
  echo "backend_sidecar_size=$(path_size_human "$STAGED_RESOURCES_DIR")"
  echo "runtime_build_dir=$RUNTIME_BUILD_DIR"
  echo "runtime_build_size=$(path_size_human "$RUNTIME_BUILD_DIR")"
  echo "runtime_stage_dir=$STAGED_LLM_RUNTIME_DIR"
  echo "runtime_stage_size=$(path_size_human "$STAGED_LLM_RUNTIME_DIR")"
  echo "build_version=$BUILD_VERSION"
  echo "nsis_installer=${INSTALLER:-N/A}"
  if [ -n "${INSTALLER:-}" ]; then
    echo "nsis_installer_size=$(path_size_human "$INSTALLER")"
  else
    echo "nsis_installer_size=N/A"
  fi
  echo "msi_installer=${MSI:-N/A}"
  if [ -n "${MSI:-}" ]; then
    echo "msi_installer_size=$(path_size_human "$MSI")"
    echo "msi_cab_count=${CAB_COUNT:-0}"
    echo "msi_cab_total_size=${CAB_SIZE:-N/A}"
  else
    echo "msi_installer_size=N/A"
    echo "msi_cab_count=0"
    echo "msi_cab_total_size=N/A"
  fi
} > "$RELEASE_SUMMARY_PATH"

echo "Artifact summary: $RELEASE_SUMMARY_PATH"
echo "Bundled summary: $STAGED_RELEASE_SUMMARY_PATH"
echo ""
echo "=== Build complete ==="
