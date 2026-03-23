# M3 Acceptance Checklist (Mely AI)

> Milestone: M3 质量门禁自动化（CI + 一键回归）
> Updated: 2026-03-23 (Asia/Shanghai)

## A. P0 范围
- [x] 一键门禁脚本：`08-QA/run-m3-gate.sh`
- [x] CI 工作流：`.github/workflows/m3-ci.yml`
- [x] 关键链路覆盖：Auth / Project / Session / Export / Tune / RBAC

## B. 本地验收
- [x] `bash 08-QA/run-m3-gate.sh` 可执行
- [x] `SMOKE_OK` 输出存在
- [x] `QA_RBAC_M3_OK` 输出存在

## C. 发布门禁
- [x] 前端 build 可通过（CI）
- [x] 后端 build 可通过（gate 脚本）
- [ ] CI 首轮稳定性观察（连续 3 次）
  - 阻塞说明：当前仓库未绑定 GitHub 远端，暂无法触发并沉淀 run 链接

## D. 文档与可追溯性
- [x] M3 启动方案落盘：`09-PM/M3-KICKOFF-PLAN-v2.md`
- [x] 验收清单更新（本文件）
- [x] QA 报告补充首轮稳定性证据（本地 3 连日志链接，CI 链接待远端补齐）

## 当前通过率
- 已完成：11
- 待完成：1
- **M3 当前完成度：92%**
