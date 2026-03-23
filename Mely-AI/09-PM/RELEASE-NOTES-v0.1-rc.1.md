# Release Notes — Mely AI v0.1-rc.1

Date: 2026-03-23
Status: External Ready
Audience: 外部评审 / 合作方 / 内部发布同步

## 一句话版本
Mely AI v0.1-rc.1 已完成 M1~M3 全量验收，并通过 CI 三连稳定性验证，当前可进入对外演示与发布窗口。

## Highlights
- M1~M3 里程碑全部收口（100%）。
- 核心链路（Auth / Project / Session / Export / Tune / RBAC）全量可用。
- 发布门禁自动化完成：一键 gate + GitHub Actions 工作流。

## Quality Evidence
- Smoke 回归：PASS（`SMOKE_OK`）
- RBAC 回归：PASS（`QA_RBAC_M3_OK`）
- CI 连续 3 次 PASS：
  - https://github.com/f0rsan/Mely-AI/actions/runs/23419798046
  - https://github.com/f0rsan/Mely-AI/actions/runs/23419800614
  - https://github.com/f0rsan/Mely-AI/actions/runs/23419801413

## Risk & Rollback
- 当前无 P0 阻塞问题。
- 回滚触发：P0 回归失败 / 演示主链路不可执行 / 健康检查持续异常。
- 回滚动作：回退到最近稳定提交后复跑 `smoke-phase-b.sh` + `qa-rbac-m3.sh`。

## Final Verdict
- **Go**：可对外同步并进入正式演示阶段（M4）。
