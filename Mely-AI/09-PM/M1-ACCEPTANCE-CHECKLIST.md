# M1 Acceptance Checklist (Mely AI)

> Milestone: 核心服务可联调（M1）
> Updated: 2026-03-14

## A. Auth / Project / Model
- [x] `POST /auth/login` 可用（返回 token + user）
- [x] `GET /projects` 可用
- [x] `GET /models` 可用
- [ ] 权限校验（非 demo token）

## B. Session 基础链路
- [x] `GET /sessions` 可用
- [x] `GET /sessions?projectId=...` 可用
- [x] `POST /sessions` 可创建
- [x] 数据持久化（SQLite）

## C. Frontend 联调
- [x] 前端已切真实后端 API（非 mockApi）
- [x] 登录 -> 项目 -> 会话列表可走通
- [x] 会话创建可见
- [x] 未实现能力（sendMessage）已禁用并提示

## D. 契约与验证
- [x] API contract 落盘
- [x] OpenAPI 已覆盖 health/auth/projects/models/sessions
- [x] 冒烟脚本可复跑（`09-PM/smoke-phase-b.sh`）
- [ ] OpenAPI 覆盖 Session Export endpoints

## 当前通过率
- 已完成：14
- 待完成：2
- **M1 完成度：87.5%**
