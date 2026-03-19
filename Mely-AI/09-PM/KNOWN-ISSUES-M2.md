# M2 Known Issues & Mitigation (Mely AI)

Updated: 2026-03-19

## Open issues
1. Session export 内容完整性与权限边界（QA）尚未完成系统化验证。
   - 规避策略：发布前执行一次专项 QA（多 session、跨 project 访问、无 token/错误 token、不存在资源）。

## Resolved in this cycle
- Tune 日志聚合接口已提供：`GET /tune/tasks/{taskId}/logs`
- 前端已提供 Tune 创建 / 状态展示 / 日志展示基础页面
- P0 冒烟脚本已覆盖异常路径（401/404）
