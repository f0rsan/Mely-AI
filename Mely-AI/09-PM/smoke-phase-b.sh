#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

echo "[1/5] health"
curl -fsS "$BASE/health" | jq .

echo "[2/5] login"
curl -fsS -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"demo@mely.ai","password":"123456"}' | jq .

echo "[3/5] projects"
curl -fsS "$BASE/projects" | jq .

echo "[4/5] create session"
curl -fsS -X POST "$BASE/sessions" \
  -H 'content-type: application/json' \
  -d '{"projectId":"proj_001","title":"Phase B smoke"}' | jq .

echo "[5/5] list sessions by project"
curl -fsS "$BASE/sessions?projectId=proj_001" | jq .

echo "SMOKE_OK"
