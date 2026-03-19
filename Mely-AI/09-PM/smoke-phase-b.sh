#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

echo "[1/11] health"
curl -fsS "$BASE/health" | jq .

echo "[2/11] login"
LOGIN_JSON=$(curl -fsS -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"demo@mely.ai","password":"123456"}')
echo "$LOGIN_JSON" | jq .
TOKEN=$(echo "$LOGIN_JSON" | jq -r '.token')
AUTH_HEADER="authorization: Bearer $TOKEN"

echo "[3/11] projects"
curl -fsS "$BASE/projects" -H "$AUTH_HEADER" | jq .

echo "[4/11] create session"
curl -fsS -X POST "$BASE/sessions" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"projectId":"proj_001","title":"Phase B smoke"}' | jq .

echo "[5/11] list sessions by project"
curl -fsS "$BASE/sessions?projectId=proj_001" -H "$AUTH_HEADER" | jq .

echo "[6/11] create session export"
curl -fsS -X POST "$BASE/sessions/sess_001/exports" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"format":"jsonl"}' | jq .

echo "[7/11] list session exports"
curl -fsS "$BASE/sessions/sess_001/exports" -H "$AUTH_HEADER" | jq .

echo "[8/11] create tune task"
TASK_JSON=$(curl -fsS -X POST "$BASE/tune/tasks" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"projectId":"proj_001","modelId":"gpt-4.1-mini","name":"M2 smoke tune"}')
echo "$TASK_JSON" | jq .
TASK_ID=$(echo "$TASK_JSON" | jq -r '.id')

echo "[9/11] get tune task + list tune tasks"
curl -fsS "$BASE/tune/tasks/$TASK_ID" -H "$AUTH_HEADER" | jq .
curl -fsS "$BASE/tune/tasks?projectId=proj_001" -H "$AUTH_HEADER" | jq .

echo "[10/11] get tune logs"
curl -fsS "$BASE/tune/tasks/$TASK_ID/logs" -H "$AUTH_HEADER" | jq .

echo "[11/11] basic exception checks"
UNAUTH_CODE=$(curl -s -o /tmp/mely-smoke-unauth.json -w '%{http_code}' "$BASE/projects")
if [[ "$UNAUTH_CODE" != "401" ]]; then
  echo "expected 401 without token, got $UNAUTH_CODE"
  exit 1
fi
NOTFOUND_CODE=$(curl -s -o /tmp/mely-smoke-notfound.json -w '%{http_code}' -H "$AUTH_HEADER" "$BASE/tune/tasks/not_exist")
if [[ "$NOTFOUND_CODE" != "404" ]]; then
  echo "expected 404 for unknown tune task, got $NOTFOUND_CODE"
  exit 1
fi

echo "SMOKE_OK"