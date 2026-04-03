# M4 Demo Account & Data Checklist

Updated: 2026-03-23 13:49 (Asia/Shanghai)

## Accounts
- [x] owner 账号可登录（`demo@mely.ai`）
- [x] viewer 账号可登录（`viewer@mely.ai`）
- [ ] 演示账号口令已在演示前 30 分钟复验

## Projects / Sessions
- [x] `proj_001` 可用
- [x] `proj_002` 可用
- [x] 至少 1 个可读 session
- [ ] 演示前预建 1 个新 session（避免冷启动等待）

## Export / Tune
- [x] 可创建 export
- [x] 可查询 export 列表
- [x] 可创建 tune task
- [x] 可查询 tune 状态与日志

## RBAC
- [x] viewer 访问 `proj_001` sessions 返回 403
- [x] viewer 创建 `proj_001` tune 返回 403

## Environment
- [ ] `/health` 演示前连续 3 次 200
- [ ] 当天 CI 最新 run 为 success
