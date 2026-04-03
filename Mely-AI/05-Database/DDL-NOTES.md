# Mely AI v0.1 DDL Notes

> Source of truth: `05-Database/schema.sql`

## Purpose
This file documents how current P0 API resources map to database entities, and which areas are intentionally deferred.

## P0 mapping
- Auth user: `app_user`
- Project: `project`, `project_member`
- Model: `model`
- Session: `chat_session`
- Session message: `chat_message`
- Session export (Sprint 1 tail): `session_export`
- Tune task (Sprint 1 tail): `tune_job`, `tune_job_log`

## Conventions
- IDs: UUID (DB) / string (API layer)
- Timestamps: `TIMESTAMPTZ`, UTC
- JSON extensibility: use `JSONB` for flexible metadata (`chat_message.metadata`, `tune_job.hyper_params`, etc.)

## Index strategy (current)
- Hot read paths already indexed:
  - session by project/user/time
  - message by session/time
  - tune by project/status/time
- GIN index added for metadata-rich columns to support filtering/search.

## Deferred to P1+
- Asset marketplace optimization indexes and cost-control partitioning.
- Billing ledger monthly partitioning.
- Full-text search indexes for message content.

## Migration policy
- v0.1 window: additive changes preferred.
- Destructive change requires:
  1) rollback SQL update,
  2) API contract review,
  3) QA regression checklist update.
