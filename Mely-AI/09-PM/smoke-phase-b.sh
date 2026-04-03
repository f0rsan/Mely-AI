#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

echo "[1/13] health"
curl -fsS "$BASE/health" | jq .

echo "[2/13] login"
LOGIN_JSON=$(curl -fsS -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"demo@mely.ai","password":"123456"}')
echo "$LOGIN_JSON" | jq .
TOKEN=$(echo "$LOGIN_JSON" | jq -r '.token')
AUTH_HEADER="authorization: Bearer $TOKEN"

echo "[3/13] projects"
curl -fsS "$BASE/projects" -H "$AUTH_HEADER" | jq .

echo "[4/13] create session"
SESSION_JSON=$(curl -fsS -X POST "$BASE/sessions" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"projectId":"proj_001","title":"Phase B smoke"}')
echo "$SESSION_JSON" | jq .
SESSION_ID=$(echo "$SESSION_JSON" | jq -r '.id')

echo "[5/13] list sessions by project"
curl -fsS "$BASE/sessions?projectId=proj_001" -H "$AUTH_HEADER" | jq .

echo "[6/13] create + list session messages"
curl -fsS -X POST "$BASE/sessions/$SESSION_ID/messages" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"role":"user","content":"hello from smoke"}' | jq .
curl -fsS "$BASE/sessions/$SESSION_ID/messages?page=1&pageSize=10" -H "$AUTH_HEADER" | jq .

echo "[7/13] create session export"
curl -fsS -X POST "$BASE/sessions/$SESSION_ID/exports" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"format":"jsonl"}' | jq .

echo "[8/13] list session exports"
curl -fsS "$BASE/sessions/$SESSION_ID/exports" -H "$AUTH_HEADER" | jq .

echo "[9/13] create tune task"
TASK_JSON=$(curl -fsS -X POST "$BASE/tune/tasks" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"projectId":"proj_001","modelId":"gpt-4.1-mini","name":"M2 smoke tune"}')
echo "$TASK_JSON" | jq .
TASK_ID=$(echo "$TASK_JSON" | jq -r '.id')

echo "[10/13] get tune task + list tune tasks"
curl -fsS "$BASE/tune/tasks/$TASK_ID" -H "$AUTH_HEADER" | jq .
curl -fsS "$BASE/tune/tasks?projectId=proj_001" -H "$AUTH_HEADER" | jq .

echo "[11/13] get tune logs"
curl -fsS "$BASE/tune/tasks/$TASK_ID/logs" -H "$AUTH_HEADER" | jq .

echo "[12/13] basic exception checks"
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

echo "[13/13] message bad request check"
BAD_MSG_CODE=$(curl -s -o /tmp/mely-smoke-msg-bad.json -w '%{http_code}' \
  -X POST "$BASE/sessions/$SESSION_ID/messages" \
  -H 'content-type: application/json' -H "$AUTH_HEADER" \
  -d '{"role":"user","content":"   "}')
if [[ "$BAD_MSG_CODE" != "400" ]]; then
  echo "expected 400 for empty message content, got $BAD_MSG_CODE"
  exit 1
fi

echo "SMOKE_OK"