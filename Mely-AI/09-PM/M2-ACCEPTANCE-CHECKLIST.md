# M2 Acceptance Checklist (Mely AI)

> Milestone: P0 功能闭环（M2）
> Updated: 2026-03-19

## C. Session 导出闭环
- [x] `GET /sessions/{sessionId}/exports` 可用
- [x] `POST /sessions/{sessionId}/exports` 可用
- [x] 后端可生成真实导出文件（jsonl/csv/txt）
- [x] 前端提供导出入口（格式选择 + 创建导出）
- [x] 前端可展示导出产物列表（artifact 链接）
- [ ] QA 校验导出内容完整性与权限边界

## D. Tune 任务闭环
- [x] TuneTask 数据模型与创建接口
- [x] Tune 状态查询接口
- [x] Tune 日志聚合接口
- [x] 前端 Tune 页面（创建/状态/日志）
- [x] 端到端联调（Happy Path + 基础异常）

## E. P0 回归门禁
- [x] P0 冒烟（Auth / Project / Session / Export / Tune）全绿
- [x] 已知问题清单与规避策略落盘

## 当前通过率
- 已完成：11
- 待完成：1
- **M2 完成度：92%**