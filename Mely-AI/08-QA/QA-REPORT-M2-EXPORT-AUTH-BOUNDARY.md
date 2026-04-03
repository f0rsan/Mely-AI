# QA Report — M2 Export Completeness & Auth Boundary

Date: 2026-03-19
Owner: QA (automated script + manual spot-check)

## Scope
- Session export content completeness (jsonl/csv/txt)
- Permission boundary for export APIs

## Environment
- Backend: `04-Backend/service` (dev mode)
- Test script: `08-QA/qa-export-auth-boundary.sh`
- Target API:
  - `POST /sessions/{sessionId}/exports`
  - `GET /sessions/{sessionId}/exports`

## Test Cases & Results
1. Login and obtain bearer token — ✅
2. Create exports in `jsonl/csv/txt` — ✅
3. Verify export list response required fields (`id/sessionId/format/fileUri/sampleCount/createdAt`) — ✅
4. Verify artifact readability and minimal content contract:
   - jsonl has `id/projectId/title/status/createdAt/exportedAt` — ✅
   - csv header is expected — ✅
   - txt has expected title line — ✅
5. No token access to exports should return 401 — ✅
6. Invalid token access to exports should return 401 — ✅
7. Non-existent session exports should return 404 — ✅

## Conclusion
- Export completeness & permission boundary checks are **passed** for M2 acceptance.
- Remaining risk is limited to broader multi-user authorization model (out of current demo scope).
