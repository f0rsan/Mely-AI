# Mely AI Database v0.1

本目录提供可直接执行的 PostgreSQL SQL 脚本：

- `schema.sql`：初始数据库 schema（含约束与索引）
- `seed.sql`：最小可联调示例数据（Auth/Project/Model/Session/Tune/Asset/Billing/Audit）
- `rollback.sql`：回滚脚本（按依赖逆序删除）

## 设计依据（对应当前业务目标）

基于现有文档中的 Sprint 目标：

- Sprint 1（P0）：Auth + Project + Model / Session 消息流 / 导出样本 / Tune 任务
- Sprint 2（P1）：Asset 审核发布 / Library 安装归档 / Billing Summary
- 治理红线：关键操作可追踪、可审计（`audit_log`）

## 快速执行

```bash
# 1) 创建 schema
psql "$DATABASE_URL" -f Mely-AI/05-Database/schema.sql

# 2) 导入 seed
psql "$DATABASE_URL" -f Mely-AI/05-Database/seed.sql

# 3) （可选）回滚
psql "$DATABASE_URL" -f Mely-AI/05-Database/rollback.sql
```

## 关键表说明

- 身份与权限：`app_user`, `refresh_token`, `project`, `project_member`
- 模型资产：`model`, `asset`, `asset_review`, `library_install`
- 对话与训练：`chat_session`, `chat_message`, `session_export`, `tune_job`, `tune_job_log`
- 计费与审计：`billing_ledger`, `audit_log`

## 约束与索引策略

- 强一致唯一性：邮箱、项目内模型版本、项目成员唯一约束
- 状态机约束：ENUM + CHECK（例如 `tune_status_t`, `asset_status_t`）
- 常用访问路径索引：
  - 列表页：`(project_id, status, updated_at)` / `(user_id, occurred_at)`
  - 时间序：`created_at DESC` 或 `occurred_at DESC`
  - 半结构化检索：`JSONB GIN`（消息 metadata、资产兼容性）

## 注意事项

- `seed.sql` 中密码哈希为占位符，请在接入真实鉴权前替换。
- 金额使用 `amount_cents BIGINT`，避免浮点精度问题。
- 如需多租户强化，可在下一版增加 `tenant_id` 并扩展复合索引。
