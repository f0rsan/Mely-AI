#!/usr/bin/env bash
# =============================================================================
# build_windows.sh — Full Windows release build pipeline for Mely AI
#
# Run this on a Windows machine (Git Bash / WSL) or in CI.
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

# Clean previous build artifacts.
rm -rf build dist

# Build using the spec file.
# The output lands in dist/mely-backend/
pyinstaller mely_backend.spec

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
echo "=== [2/4] Install frontend dependencies ==="
cd "$REPO_ROOT"
npm ci

echo ""
echo "=== [3/4] Build Tauri Windows installer ==="
# tauri build will:
#   1. Run `npm run build` (Vite + TypeScript)
#   2. Compile the Rust shell
#   3. Bundle everything into an NSIS installer at:
#      src-tauri/target/release/bundle/nsis/Mely AI_0.1.0_x64-setup.exe
npm run build 2>/dev/null || true  # pre-build the frontend first
cargo tauri build

echo ""
echo "=== [4/4] Build complete ==="
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
