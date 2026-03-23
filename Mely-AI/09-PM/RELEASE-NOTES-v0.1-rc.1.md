# Release Notes — Mely AI v0.1-rc.1

Date: 2026-03-23
Status: RC Ready

## Highlights
- 完成 M1~M3 里程碑收口，核心链路（Auth / Project / Session / Export / Tune / RBAC）全量可用。
- 新增并打通 M3 一键门禁脚本与 GitHub Actions 工作流。
- CI 稳定性验证通过：M3 CI Gate 连续 3 次全绿。

## Quality Evidence
- Smoke 回归：PASS（`SMOKE_OK`）
- RBAC 回归：PASS（`QA_RBAC_M3_OK`）
- CI runs:
  - https://github.com/f0rsan/Mely-AI/actions/runs/23419798046
  - https://github.com/f0rsan/Mely-AI/actions/runs/23419800614
  - https://github.com/f0rsan/Mely-AI/actions/runs/23419801413

## Known Notes
- GitHub Actions 存在 Node20 actions 弃用提醒（非阻塞）；当前工作流已使用 Node24 运行项目构建与门禁。

## Rollback
- 触发条件：出现 P0 回归失败、演示主链路不可执行、健康检查持续异常。
- 回滚建议：回退至最近稳定提交并复跑 smoke + RBAC。

## Final Verdict
- **Go**：可进入发布演示阶段（M4）。
