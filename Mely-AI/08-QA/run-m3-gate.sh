#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/04-Backend/service"
PORT="${PORT:-3301}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"

SERVER_PID=""
mkdir -p "$ROOT_DIR/logs"

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_health() {
  local retries="${1:-40}"
  local sleep_seconds="${2:-1}"

  for ((i=1; i<=retries; i++)); do
    if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "[ERROR] backend health check failed after $retries retries: $BASE_URL/health"
  return 1
}

echo "[M3-GATE] installing backend deps"
npm --prefix "$BACKEND_DIR" ci

echo "[M3-GATE] building backend"
npm --prefix "$BACKEND_DIR" run build

echo "[M3-GATE] starting backend on port $PORT"
(
  cd "$BACKEND_DIR"
  PORT="$PORT" node dist/server.js
) >"$ROOT_DIR/logs/m3-gate-backend.log" 2>&1 &
SERVER_PID=$!
sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "[ERROR] backend failed to start. check logs/m3-gate-backend.log"
  if [[ -f "$ROOT_DIR/logs/m3-gate-backend.log" ]]; then
    echo "[ERROR] backend log tail:"
    tail -n 80 "$ROOT_DIR/logs/m3-gate-backend.log" || true
  fi
  exit 1
fi

echo "[M3-GATE] waiting for health"
if ! wait_for_health; then
  if [[ -f "$ROOT_DIR/logs/m3-gate-backend.log" ]]; then
    echo "[ERROR] backend log tail:"
    tail -n 80 "$ROOT_DIR/logs/m3-gate-backend.log" || true
  fi
  exit 1
fi

echo "[M3-GATE] running smoke regression"
bash "$ROOT_DIR/09-PM/smoke-phase-b.sh" "$BASE_URL"

echo "[M3-GATE] running RBAC regression"
bash "$ROOT_DIR/08-QA/qa-rbac-m3.sh" "$BASE_URL"

echo "[M3-GATE] ALL_GREEN"