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
RUNTIME_BUILD_DIR="$REPO_ROOT/build/windows-llm-runtime/llm-runtime"
RELEASE_SUMMARY_PATH="$REPO_ROOT/build/windows-training-release-artifacts.txt"
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
# tauri build will:
#   1. Run `python scripts/prepare_tauri_backend.py --require-source-fresh --verify-api-compatibility && npm run build`
#   2. Compile the Rust shell
#   3. Bundle everything into an NSIS installer at:
#      src-tauri/target/release/bundle/nsis/Mely AI_0.1.0_x64-setup.exe
npx tauri build --bundles nsis,msi

echo ""
echo "=== [6/6] Collect artifact summary ==="
INSTALLER=$(find "$REPO_ROOT/src-tauri/target/release/bundle/nsis" -name "*.exe" 2>/dev/null | head -1)
MSI=$(find "$REPO_ROOT/src-tauri/target/release/bundle/msi" -name "*.msi" 2>/dev/null | head -1)

if [ -n "$INSTALLER" ]; then
  SIZE=$(du -h "$INSTALLER" | cut -f1)
  echo "NSIS installer: $INSTALLER ($SIZE)"
fi
if [ -n "$MSI" ]; then
  SIZE=$(du -h "$MSI" | cut -f1)
  echo "MSI installer:  $MSI ($SIZE)"
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
  echo "nsis_installer=${INSTALLER:-N/A}"
  if [ -n "${INSTALLER:-}" ]; then
    echo "nsis_installer_size=$(path_size_human "$INSTALLER")"
  else
    echo "nsis_installer_size=N/A"
  fi
  echo "msi_installer=${MSI:-N/A}"
  if [ -n "${MSI:-}" ]; then
    echo "msi_installer_size=$(path_size_human "$MSI")"
  else
    echo "msi_installer_size=N/A"
  fi
} > "$RELEASE_SUMMARY_PATH"

echo "Artifact summary: $RELEASE_SUMMARY_PATH"
echo ""
echo "=== Build complete ==="
