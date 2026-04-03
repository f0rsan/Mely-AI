# M2 Known Issues & Mitigation (Mely AI)

Updated: 2026-03-19

## Open issues
- 无阻塞问题。

## Notes (out of current M2 scope)
1. 当前为 demo token 模式，尚未引入多租户/细粒度 RBAC。
   - 规避策略：进入 M3 时引入真实用户体系与项目级权限模型。

## Resolved in M2
- Tune 日志聚合接口已提供：`GET /tune/tasks/{taskId}/logs`
- 前端已提供 Tune 创建 / 状态展示 / 日志展示基础页面
- P0 冒烟脚本已覆盖异常路径（401/404）
- Export 完整性与权限边界 QA 已通过（见 `08-QA/QA-REPORT-M2-EXPORT-AUTH-BOUNDARY.md`）