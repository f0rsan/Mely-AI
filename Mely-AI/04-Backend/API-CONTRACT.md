# Mely AI v0.1 API / Data Contract Baseline

> Status: **Frozen for Sprint 1 (P0)**  
> Last updated: 2026-03-14

## 1) Scope (P0)
- Auth
- Project
- Model
- Session

## 2) Global conventions
- Base URL: `/`
- Content-Type: `application/json; charset=utf-8`
- Time format: ISO8601 UTC string (`createdAt`, `updatedAt`)
- List responses unified as:

```json
{ "items": [], "total": 0 }
```

## 3) Error contract
All non-2xx responses SHOULD follow:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "projectId is required",
    "details": {}
  }
}
```

Current backend skeleton still returns legacy `{ "error": "..." }` in one endpoint; this is tracked and will be normalized in Sprint 1.

Error code baseline:
- `BAD_REQUEST` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `CONFLICT` (409)
- `INTERNAL_ERROR` (500)

## 4) Resource contracts

### Auth
`GET /auth/me`

```json
{
  "id": "user_mock_001",
  "name": "Mely Demo User",
  "email": "demo@mely.ai",
  "role": "owner"
}
```

### Project
`GET /projects`

Project item:
- `id: string`
- `name: string`
- `description?: string`
- `updatedAt: string`

### Model
`GET /models`

Model item:
- `id: string`
- `provider: string`
- `name: string`
- `capabilities: string[]`

### Session
`GET /sessions`

Session item:
- `id: string`
- `projectId: string`
- `title: string`
- `status: "active" | "archived"`
- `createdAt: string`

`POST /sessions`
Request:

```json
{ "projectId": "proj_001", "title": "New Session" }
```

Response 201:

```json
{
  "id": "sess_002",
  "projectId": "proj_001",
  "title": "New Session",
  "status": "active",
  "createdAt": "2026-03-14T00:00:00.000Z"
}
```

## 5) DB alignment (P0)
- Project ↔ `project`
- Model ↔ `model`
- Session ↔ `chat_session`
- Session message (next) ↔ `chat_message`

## 6) Change policy (frozen window)
- Sprint 1 内 P0 字段默认冻结。
- 任何字段变更必须同步更新：
  - `API-CONTRACT.md`
  - `openapi.yaml`
  - 前端 API client
  - 后端 route type
