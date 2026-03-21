# M2 Acceptance Checklist (Mely AI)

> Milestone: P0 功能闭环（M2）
> Updated: 2026-03-21

## C. Session 导出与消息闭环
- [x] `GET /sessions/{sessionId}/messages`（分页）可用
- [x] `POST /sessions/{sessionId}/messages`（鉴权、基础校验、持久化）可用
- [x] `GET /sessions/{sessionId}/exports` 可用
- [x] `POST /sessions/{sessionId}/exports` 可用
- [x] 后端可生成真实导出文件（jsonl/csv/txt）
- [x] 前端 Chat 页面接入真实消息 API（会话切换自动刷新消息）
- [x] 前端发送消息具备发送中态与失败态
- [x] 前端提供导出入口（格式选择 + 创建导出）
- [x] 前端可展示导出产物列表（artifact 链接）

## D. Tune 任务最小闭环
- [x] TuneTask 数据模型与创建接口
- [x] Tune 状态查询接口（`GET /tune/tasks/{taskId}`）
- [x] Tune 日志聚合接口（`GET /tune/tasks/{taskId}/logs`）
- [x] 前端 Tune 页面展示任务状态 + 日志
- [x] 任务状态可从 queued/running 自动推进至 succeeded（demo 模式）

## E. API / QA / 门禁
- [x] OpenAPI 更新（Session Message + Tune Logs）
- [x] P0 冒烟脚本覆盖 Message + Tune 主流程
- [x] 基础异常路径（未鉴权、不存在资源、空消息）校验

## 当前通过率
- 已完成：17
- 待完成：0
- **M2 完成度：100%**