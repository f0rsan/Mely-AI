#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

echo "[1/5] health"
curl -fsS "$BASE/health" | jq .

echo "[2/7] login"
LOGIN_JSON=$(curl -fsS -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"demo@mely.ai","password":"123456"}')
echo "$LOGIN_JSON" | jq .
TOKEN=$(echo "$LOGIN_JSON" | jq -r '.token')
AUTH_HEADER="authorization: Bearer $TOKEN"

echo "[3/7] projects"
curl -fsS "$BASE/projects" -H "$AUTH_HEADER" | jq .

echo "[4/7] create session"
curl -fsS -X POST "$BASE/sessions" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"projectId":"proj_001","title":"Phase B smoke"}' | jq .

echo "[5/7] list sessions by project"
curl -fsS "$BASE/sessions?projectId=proj_001" -H "$AUTH_HEADER" | jq .

echo "[6/7] create session export"
curl -fsS -X POST "$BASE/sessions/sess_001/exports" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"format":"jsonl"}' | jq .

echo "[7/7] list session exports"
curl -fsS "$BASE/sessions/sess_001/exports" -H "$AUTH_HEADER" | jq .

echo "SMOKE_OK"
