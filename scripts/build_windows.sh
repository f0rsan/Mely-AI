#!/usr/bin/env bash
# =============================================================================
# build_windows.sh — Full Windows release build pipeline for Mely AI
#
# Run this on a native Windows shell (Git Bash / PowerShell / CMD) or a
# Windows CI runner. Do NOT run it inside WSL/Linux: Tauri will build Linux
# bundles there and never produce the Windows installer.
# Prerequisites:
#   - Python 3.12+ with virtualenv
#   - Node.js 20+
#   - Rust stable + cargo
#   - pyinstaller  (pip install pyinstaller)
#   - UPX (optional, for smaller binaries — https://github.com/upx/upx)
#
# Usage:
#   bash scripts/build_windows.sh
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
DIST_DIR="$BACKEND_DIR/dist/mely-backend"
STAGED_RESOURCES_DIR="$REPO_ROOT/src-tauri/resources/mely-backend"
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

echo "=== [1/4] Build Python backend sidecar with PyInstaller ==="
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
echo "=== [1/4] Backend sidecar built: $DIST_DIR ==="
ls -lh "$DIST_DIR/mely-backend.exe" 2>/dev/null || ls -lh "$DIST_DIR/mely-backend" || true

# ---------------------------------------------------------------------------
# Sanity check: make sure the exe actually starts and exits cleanly.
# We send it a SIGTERM after 3 seconds — if it starts, it should have bound
# port 8000 by then.
# ---------------------------------------------------------------------------
echo ""
echo "=== [1b/4] Smoke-test the sidecar binary ==="
if [ -f "$DIST_DIR/mely-backend.exe" ]; then
  BACKEND_BIN="$DIST_DIR/mely-backend.exe"
else
  BACKEND_BIN="$DIST_DIR/mely-backend"
fi

MELY_BACKEND_PORT=18999 "$BACKEND_BIN" &
BACKEND_PID=$!
sleep 4

if kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "Sidecar is running (PID $BACKEND_PID) — smoke test PASSED"
  kill "$BACKEND_PID" 2>/dev/null || true
else
  echo "ERROR: Sidecar exited before smoke test completed. Check PyInstaller output." >&2
  exit 1
fi

echo ""
echo "=== [2/4] Stage backend into Tauri resources ==="
cd "$REPO_ROOT"
python scripts/prepare_tauri_backend.py

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
echo "=== [3/4] Install frontend dependencies ==="
cd "$REPO_ROOT"
npm ci

echo ""
echo "=== [4/4] Build Tauri Windows installer ==="
# tauri build will:
#   1. Run `python scripts/prepare_tauri_backend.py && npm run build`
#   2. Compile the Rust shell
#   3. Bundle everything into an NSIS installer at:
#      src-tauri/target/release/bundle/nsis/Mely AI_0.1.0_x64-setup.exe
npx tauri build --bundles nsis,msi

echo ""
echo "=== Build complete ==="
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
