#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[Mely AI] Installing dependencies..."
  npm install
fi

echo "[Mely AI] Starting frontend on http://localhost:5173"
npm run dev
