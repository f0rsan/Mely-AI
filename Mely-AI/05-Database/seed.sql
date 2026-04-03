-- Mely AI v0.1 Seed Data
-- Depends on: schema.sql

BEGIN;

-- users
INSERT INTO app_user (id, email, password_hash, display_name, locale, timezone)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@mely.ai', '$2b$12$replace_me_owner_hash', 'Mely Owner', 'zh-CN', 'Asia/Shanghai'),
  ('00000000-0000-0000-0000-000000000002', 'reviewer@mely.ai', '$2b$12$replace_me_reviewer_hash', 'Mely Reviewer', 'zh-CN', 'Asia/Shanghai'),
  ('00000000-0000-0000-0000-000000000003', 'creator@mely.ai', '$2b$12$replace_me_creator_hash', 'Mely Creator', 'zh-CN', 'Asia/Shanghai')
ON CONFLICT (email) DO NOTHING;

-- project
INSERT INTO project (id, owner_user_id, name, description, visibility)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Mely Demo Project', '用于 Sprint 1 端到端联调', 'private')
ON CONFLICT (owner_user_id, name) DO NOTHING;

INSERT INTO project_member (project_id, user_id, role)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'editor')
ON CONFLICT (project_id, user_id) DO NOTHING;

-- model
INSERT INTO model (id, project_id, name, model_type, base_model, version, description, artifact_uri, created_by)
VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'mely-assistant', 'base', 'gpt-4o-mini', 'v1', '演示基础模型', 's3://mely/models/mely-assistant/v1', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (project_id, name, version) DO NOTHING;

-- session + message
INSERT INTO chat_session (id, project_id, user_id, title, status, last_message_at)
VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '欢迎对话', 'active', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO chat_message (session_id, sender_type, sender_user_id, content, token_in, token_out, latency_ms, metadata)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'user', '00000000-0000-0000-0000-000000000003', '帮我写一个产品发布文案', 12, 0, NULL, '{"lang":"zh"}'::jsonb),
  ('30000000-0000-0000-0000-000000000001', 'assistant', NULL, '当然可以，下面是三个版本…', 12, 188, 680, '{"model":"mely-assistant:v1"}'::jsonb);

INSERT INTO session_export (session_id, exported_by, format, file_uri, sample_count)
VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'jsonl', 's3://mely/exports/session-3000.jsonl', 2);

-- tune job + logs
INSERT INTO tune_job (id, project_id, source_model_id, created_by, status, dataset_uri, hyper_params)
VALUES
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'running',
    's3://mely/datasets/demo-v1.jsonl',
    '{"lr":0.0001,"epoch":3,"batch_size":8}'::jsonb
  )
ON CONFLICT DO NOTHING;

INSERT INTO tune_job_log (job_id, level, message, metric)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'info', 'job queued', NULL),
  ('40000000-0000-0000-0000-000000000001', 'info', 'epoch 1 finished', '{"loss":1.42}'::jsonb);

-- asset + review + install
INSERT INTO asset (id, project_id, model_id, owner_user_id, title, description, ownership_claim, license_name, compatibility, status, published_at)
VALUES
  (
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Mely Writing Booster',
    '提升中文营销文案生成质量',
    'original',
    'Apache-2.0',
    '{"framework":"transformers","min_vram_gb":8}'::jsonb,
    'published',
    NOW()
  )
ON CONFLICT DO NOTHING;

INSERT INTO asset_review (asset_id, reviewer_user_id, decision, comments)
VALUES
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'approved', '通过权属与兼容性检查');

INSERT INTO library_install (asset_id, installed_by, project_id)
VALUES
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');

-- billing + audit
INSERT INTO billing_ledger (user_id, project_id, kind, amount_cents, currency, usage_quantity, usage_unit, metadata)
VALUES
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'inference', 129, 'CNY', 2000, 'tokens', '{"model":"mely-assistant:v1"}'::jsonb),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'training', 1999, 'CNY', 1, 'job', '{"job_id":"40000000-0000-0000-0000-000000000001"}'::jsonb);

INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, trace_id, request_ip, before_data, after_data)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'asset.publish',
    'asset',
    '50000000-0000-0000-0000-000000000001',
    'trace-demo-001',
    '127.0.0.1',
    '{"status":"approved"}'::jsonb,
    '{"status":"published"}'::jsonb
  );

COMMIT;
