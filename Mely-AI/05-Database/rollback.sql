-- Mely AI v0.1 Rollback Script
-- Drops all objects created by schema.sql

BEGIN;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS billing_ledger;
DROP TABLE IF EXISTS library_install;
DROP TABLE IF EXISTS asset_review;
DROP TABLE IF EXISTS asset;
DROP TABLE IF EXISTS tune_job_log;
DROP TABLE IF EXISTS tune_job;
DROP TABLE IF EXISTS session_export;
DROP TABLE IF EXISTS chat_message;
DROP TABLE IF EXISTS chat_session;
DROP TABLE IF EXISTS model;
DROP TABLE IF EXISTS project_member;
DROP TABLE IF EXISTS project;
DROP TABLE IF EXISTS refresh_token;
DROP TABLE IF EXISTS app_user;

DROP TYPE IF EXISTS log_level_t;
DROP TYPE IF EXISTS ownership_claim_t;
DROP TYPE IF EXISTS billing_kind_t;
DROP TYPE IF EXISTS asset_status_t;
DROP TYPE IF EXISTS tune_status_t;
DROP TYPE IF EXISTS session_status_t;
DROP TYPE IF EXISTS model_type_t;
DROP TYPE IF EXISTS visibility_t;

COMMIT;
