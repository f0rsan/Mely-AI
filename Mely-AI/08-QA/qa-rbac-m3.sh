#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

echo "[1/4] login as viewer"
LOGIN_JSON=$(curl -fsS -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"viewer@mely.ai","password":"123456"}')
TOKEN=$(echo "$LOGIN_JSON" | jq -r '.token')
AUTH_HEADER="authorization: Bearer $TOKEN"

echo "[2/4] viewer can only see allowed projects"
PROJ_JSON=$(curl -fsS "$BASE/projects" -H "$AUTH_HEADER")
echo "$PROJ_JSON" | jq -e '.total == 1' >/dev/null
echo "$PROJ_JSON" | jq -e '.items[0].id == "proj_002"' >/dev/null

echo "[3/4] viewer blocked from proj_001 sessions"
CODE_403=$(curl -s -o /tmp/mely-qa-rbac-403.json -w '%{http_code}' "$BASE/sessions?projectId=proj_001" -H "$AUTH_HEADER")
if [[ "$CODE_403" != "403" ]]; then
  echo "expected 403, got $CODE_403"
  exit 1
fi

echo "[4/4] viewer blocked from creating tune task in proj_001"
CODE_403_TUNE=$(curl -s -o /tmp/mely-qa-rbac-tune-403.json -w '%{http_code}' -X POST "$BASE/tune/tasks" \
  -H 'content-type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"projectId":"proj_001","modelId":"gpt-4.1-mini","name":"forbidden"}')
if [[ "$CODE_403_TUNE" != "403" ]]; then
  echo "expected 403, got $CODE_403_TUNE"
  exit 1
fi

echo "QA_RBAC_M3_OK"