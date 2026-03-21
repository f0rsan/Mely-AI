# M3 Kickoff Plan v2（基于 M2 已完成代码）

更新时间：2026-03-21（Asia/Shanghai）
负责人：Delivery / Backend / QA

## 1. M3 目标与范围（按优先级）

### P0（本轮必须完成）
1. **CI 验收自动化**：把 M2/M3 关键回归纳入 GitHub Actions（构建 + 冒烟 + RBAC）。
2. **一键 Smoke Gate**：提供单命令本地脚本，自动拉起后端并执行 smoke + RBAC。
3. **文档同步**：将执行方式、验收口径和风险补充到 PM/QA 文档。

### P1（下一步）
1. 前端 E2E（Playwright）最小关键路径。
2. 导出/训练任务增加状态机断言与失败重试覆盖。

### Out of Scope（当前不做）
- 新业务域（交易/计费/资产市场）
- 大规模架构重构（微服务拆分）

---

## 2. 接口 / 数据变更说明

## 2.1 API
- **本轮不新增业务 API**。
- 回归门禁覆盖以下现有接口：
  - `POST /auth/login`
  - `GET /projects`
  - `GET/POST /sessions`
  - `GET/POST /sessions/{id}/messages`
  - `GET/POST /sessions/{id}/exports`
  - `GET/POST /tune/tasks`
  - `GET /tune/tasks/{id}/logs`

## 2.2 数据层
- **无 schema 变更**（沿用当前 sqlite + 现有 seed/mock 数据）。
- 回归重点是权限边界和端到端链路稳定性，而非数据模型扩展。

---

## 3. 任务拆解（WBS）

- [x] T1：实现 `08-QA/run-m3-gate.sh`
  - 自动安装后端依赖
  - 构建后端
  - 拉起服务并等待 `/health`
  - 串行执行 `09-PM/smoke-phase-b.sh` + `08-QA/qa-rbac-m3.sh`
  - 自动清理后台进程

- [x] T2：新增 `.github/workflows/m3-ci.yml`
  - 前端安装 + 构建
  - 执行 M3 gate 脚本

- [x] T3：文档更新（本文件 + QA 操作说明）

- [ ] T4（下一小时候选）：补充失败日志归档与 CI Artifact 上传

---

## 4. 验收标准（Definition of Done）

### 功能验收
- 本地执行 `bash 08-QA/run-m3-gate.sh` 返回 `ALL_GREEN`。
- CI 中 `M3 CI Gate` 工作流在 PR 上可稳定通过。

### 质量验收
- 任一 P0 回归失败时，流程必须 fail-fast 并返回非 0。
- RBAC 越权校验（viewer 访问 `proj_001`）必须稳定返回 403。

### 交付验收
- PM 文档已有清晰执行入口、范围边界和下一步计划。

---

## 5. 风险与阻塞

1. **CI 环境差异风险**：若 runner 无法稳定启动服务，可能导致偶发超时。
2. **数据脏状态风险**：长期复用 sqlite 文件可能引发会话数量膨胀，影响断言稳健性。
3. **当前阻塞**：暂无硬阻塞；后续重点观察 CI 首轮稳定性。

---

## 6. 执行命令（统一入口）

```bash
# 本地一键门禁
bash 08-QA/run-m3-gate.sh

# 单独执行
bash 09-PM/smoke-phase-b.sh
bash 08-QA/qa-rbac-m3.sh
```

---

## 7. M3 进度（当前）
- P0 已完成：3/3
- P1 已完成：0/2
- **M3 当前完成度：60%**（P0 完成，P1 未启动）
