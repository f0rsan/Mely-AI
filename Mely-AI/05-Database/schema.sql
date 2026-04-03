-- Mely AI v0.1 Initial Schema
-- Target DB: PostgreSQL 14+
-- Encoding: UTF8

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================
-- enums
-- =========================
CREATE TYPE visibility_t AS ENUM ('private', 'team', 'public');
CREATE TYPE model_type_t AS ENUM ('base', 'tuned', 'adapter');
CREATE TYPE session_status_t AS ENUM ('active', 'archived');
CREATE TYPE tune_status_t AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE asset_status_t AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'published', 'archived');
CREATE TYPE billing_kind_t AS ENUM ('inference', 'training', 'storage', 'subscription', 'refund');
CREATE TYPE ownership_claim_t AS ENUM ('original', 'licensed', 'mixed');
CREATE TYPE log_level_t AS ENUM ('debug', 'info', 'warn', 'error');

-- =========================
-- users & auth
-- =========================
CREATE TABLE app_user (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  avatar_url        TEXT,
  locale            TEXT NOT NULL DEFAULT 'zh-CN',
  timezone          TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE refresh_token (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- project & model
-- =========================
CREATE TABLE project (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  name              TEXT NOT NULL,
  description       TEXT,
  visibility        visibility_t NOT NULL DEFAULT 'private',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, name)
);

CREATE TABLE project_member (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);

CREATE TABLE model (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  model_type        model_type_t NOT NULL,
  base_model        TEXT,
  version           TEXT NOT NULL DEFAULT 'v1',
  description       TEXT,
  artifact_uri      TEXT,
  created_by        UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name, version)
);

-- =========================
-- session & messages
-- =========================
CREATE TABLE chat_session (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  title             TEXT,
  status            session_status_t NOT NULL DEFAULT 'active',
  last_message_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_message (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
  sender_type       TEXT NOT NULL CHECK (sender_type IN ('user', 'assistant', 'system')),
  sender_user_id    UUID REFERENCES app_user(id) ON DELETE SET NULL,
  content           TEXT NOT NULL,
  token_in          INTEGER NOT NULL DEFAULT 0 CHECK (token_in >= 0),
  token_out         INTEGER NOT NULL DEFAULT 0 CHECK (token_out >= 0),
  latency_ms        INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE session_export (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
  exported_by       UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  format            TEXT NOT NULL CHECK (format IN ('jsonl', 'csv', 'txt')),
  file_uri          TEXT NOT NULL,
  sample_count      INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- tuning jobs
-- =========================
CREATE TABLE tune_job (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source_model_id   UUID REFERENCES model(id) ON DELETE SET NULL,
  output_model_id   UUID REFERENCES model(id) ON DELETE SET NULL,
  created_by        UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  status            tune_status_t NOT NULL DEFAULT 'queued',
  dataset_uri       TEXT NOT NULL,
  hyper_params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  train_started_at  TIMESTAMPTZ,
  train_ended_at    TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tune_job_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID NOT NULL REFERENCES tune_job(id) ON DELETE CASCADE,
  level             log_level_t NOT NULL DEFAULT 'info',
  message           TEXT NOT NULL,
  metric            JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- asset / trade
-- =========================
CREATE TABLE asset (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  model_id          UUID REFERENCES model(id) ON DELETE SET NULL,
  owner_user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  title             TEXT NOT NULL,
  description       TEXT,
  ownership_claim   ownership_claim_t NOT NULL,
  license_name      TEXT NOT NULL,
  compatibility     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            asset_status_t NOT NULL DEFAULT 'draft',
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE asset_review (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  reviewer_user_id  UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  decision          TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'need_changes')),
  comments          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE library_install (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  installed_by      UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  project_id        UUID REFERENCES project(id) ON DELETE SET NULL,
  installed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at       TIMESTAMPTZ
);

-- =========================
-- governance / billing / audit
-- =========================
CREATE TABLE billing_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES app_user(id) ON DELETE SET NULL,
  project_id        UUID REFERENCES project(id) ON DELETE SET NULL,
  kind              billing_kind_t NOT NULL,
  amount_cents      BIGINT NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'CNY',
  usage_quantity    NUMERIC(18,6) NOT NULL DEFAULT 0,
  usage_unit        TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id     UUID REFERENCES app_user(id) ON DELETE SET NULL,
  action            TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  entity_id         UUID,
  trace_id          TEXT,
  request_ip        INET,
  before_data       JSONB,
  after_data        JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- indexes
-- =========================
CREATE INDEX idx_refresh_token_user_expires ON refresh_token (user_id, expires_at DESC);

CREATE INDEX idx_project_owner ON project (owner_user_id);
CREATE INDEX idx_project_member_user ON project_member (user_id);

CREATE INDEX idx_model_project_created ON model (project_id, created_at DESC);

CREATE INDEX idx_chat_session_project_updated ON chat_session (project_id, updated_at DESC);
CREATE INDEX idx_chat_session_user_updated ON chat_session (user_id, updated_at DESC);
CREATE INDEX idx_chat_message_session_created ON chat_message (session_id, created_at);
CREATE INDEX idx_chat_message_metadata_gin ON chat_message USING GIN (metadata);
CREATE INDEX idx_session_export_session_created ON session_export (session_id, created_at DESC);

CREATE INDEX idx_tune_job_project_status_created ON tune_job (project_id, status, created_at DESC);
CREATE INDEX idx_tune_job_status_updated ON tune_job (status, updated_at DESC);
CREATE INDEX idx_tune_job_log_job_created ON tune_job_log (job_id, created_at);

CREATE INDEX idx_asset_project_status_updated ON asset (project_id, status, updated_at DESC);
CREATE INDEX idx_asset_owner_status ON asset (owner_user_id, status);
CREATE INDEX idx_asset_compatibility_gin ON asset USING GIN (compatibility);
CREATE INDEX idx_asset_review_asset_created ON asset_review (asset_id, created_at DESC);
CREATE INDEX idx_library_install_user_created ON library_install (installed_by, installed_at DESC);
CREATE INDEX idx_library_install_project_created ON library_install (project_id, installed_at DESC);

CREATE INDEX idx_billing_ledger_project_occurred ON billing_ledger (project_id, occurred_at DESC);
CREATE INDEX idx_billing_ledger_user_occurred ON billing_ledger (user_id, occurred_at DESC);
CREATE INDEX idx_billing_ledger_kind_occurred ON billing_ledger (kind, occurred_at DESC);

CREATE INDEX idx_audit_log_actor_created ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX idx_audit_log_entity_created ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_log_action_created ON audit_log (action, created_at DESC);

COMMIT;
