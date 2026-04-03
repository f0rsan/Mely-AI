#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

echo "[1/7] login"
LOGIN_JSON=$(curl -fsS -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"demo@mely.ai","password":"123456"}')
TOKEN=$(echo "$LOGIN_JSON" | jq -r '.token')
AUTH_HEADER="authorization: Bearer $TOKEN"

echo "[2/7] create export jsonl/csv/txt for sess_001"
for fmt in jsonl csv txt; do
  curl -fsS -X POST "$BASE/sessions/sess_001/exports" \
    -H 'content-type: application/json' \
    -H "$AUTH_HEADER" \
    -d "{\"format\":\"$fmt\"}" | jq . >/dev/null
done

echo "[3/7] list exports and verify required fields"
EXPORTS_JSON=$(curl -fsS "$BASE/sessions/sess_001/exports" -H "$AUTH_HEADER")
echo "$EXPORTS_JSON" | jq -e '.items | length > 0' >/dev/null
for field in id sessionId format fileUri sampleCount createdAt; do
  echo "$EXPORTS_JSON" | jq -e --arg f "$field" '.items[0] | has($f)' >/dev/null
done

echo "[4/7] verify latest jsonl/csv/txt artifact readability"
JSONL_PATH=$(echo "$EXPORTS_JSON" | jq -r '.items[] | select(.format=="jsonl") | .fileUri' | head -n 1)
CSV_PATH=$(echo "$EXPORTS_JSON" | jq -r '.items[] | select(.format=="csv") | .fileUri' | head -n 1)
TXT_PATH=$(echo "$EXPORTS_JSON" | jq -r '.items[] | select(.format=="txt") | .fileUri' | head -n 1)

test -f "$JSONL_PATH"
test -f "$CSV_PATH"
test -f "$TXT_PATH"

jq -e '.id and .projectId and .title and .status and .createdAt and .exportedAt' "$JSONL_PATH" >/dev/null
head -n 1 "$CSV_PATH" | grep -q '^id,projectId,title,status,createdAt,exportedAt$'
grep -q '^Session Export$' "$TXT_PATH"

echo "[5/7] unauthorized access should be 401"
CODE_401=$(curl -s -o /tmp/mely-qa-401.json -w '%{http_code}' "$BASE/sessions/sess_001/exports")
if [[ "$CODE_401" != "401" ]]; then
  echo "expected 401, got $CODE_401"
  exit 1
fi

echo "[6/7] invalid token should be 401"
CODE_BAD=$(curl -s -o /tmp/mely-qa-badtoken.json -w '%{http_code}' -H 'authorization: Bearer bad_token' "$BASE/sessions/sess_001/exports")
if [[ "$CODE_BAD" != "401" ]]; then
  echo "expected 401, got $CODE_BAD"
  exit 1
fi

echo "[7/7] missing resource should be 404"
CODE_404=$(curl -s -o /tmp/mely-qa-404.json -w '%{http_code}' -H "$AUTH_HEADER" "$BASE/sessions/sess_not_exist/exports")
if [[ "$CODE_404" != "404" ]]; then
  echo "expected 404, got $CODE_404"
  exit 1
fi

echo "QA_EXPORT_AUTH_BOUNDARY_OK"