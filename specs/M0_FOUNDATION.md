# M0 基础层 — W1–3

> 目标: 搭建 Tauri + FastAPI 骨架, SQLite schema, 任务队列, 按需下载框架

## 前置条件
- Node.js 18+, Rust toolchain, Python 3.11+
- Windows 开发环境（或 WSL2）

## 任务拆解

### W1: 项目骨架

#### T0.1 — Tauri + React 项目初始化 (1d)
- `create-tauri-app` 初始化项目
- React + TypeScript + Vite 配置
- Tailwind CSS 集成
- 基础路由结构（react-router-dom）
- 验收: `npm run tauri dev` 能启动空窗口

#### T0.2 — Python FastAPI sidecar 配置 (1d)
- FastAPI 项目结构（`backend/`）
- Tauri sidecar 配置（`tauri.conf.json`）
- 前后端 HTTP 通信验证（health check endpoint）
- CORS 配置
- 验收: Tauri 启动时自动拉起 Python 进程，前端能 GET `/api/health`

#### T0.3 — SQLite schema 初始化 (1d)
- 基于 `docs/DATA_MODEL.md` 创建所有表
- Migration 机制（简单的版本号 + SQL 脚本）
- 测试: 建表 → 插入 → 查询
- 验收: `pytest` 通过所有 schema 测试

### W2: 核心服务层

#### T0.4 — Character CRUD API (2d)
- `POST /api/characters` — 创建角色
- `GET /api/characters` — 列表（含缩略信息）
- `GET /api/characters/{id}` — 详情（含 DNA, visual, voice）
- `PUT /api/characters/{id}` — 更新角色基础信息
- `DELETE /api/characters/{id}` — 删除角色（含关联文件清理）
- Pydantic models for request/response
- 验收: 所有端点有测试，返回正确 JSON

#### T0.5 — 文件系统管理服务 (1d)
- `~/.mely/` 目录结构自动初始化
- 角色文件夹创建/删除
- 文件路径解析工具函数
- 验收: 创建角色时自动创建对应文件夹结构

### W3: 基础设施

#### T0.6 — 任务队列框架 (2d)
- 基于 asyncio 的简单任务队列（不引入 Celery）
- 任务状态: pending → running → completed / failed
- WebSocket 实时进度推送
- 前端进度条组件（通用）
- 验收: 前端能订阅任务进度，模拟任务能正确完成/失败

#### T0.7 — 按需下载框架 (2d)
- 模型注册表（JSON 配置: 名称、URL、大小、校验哈希）
- 断点续传下载器（httpx + 文件锁）
- 下载进度 WebSocket 推送
- 下载状态持久化（重启后能续传）
- 验收: 能下载一个小文件 → 中断 → 重启续传 → 完成校验

#### T0.8 — 前端角色库首页 (1d)
- 角色卡片网格布局
- 空状态引导（「创建你的第一个角色」）
- 创建角色入口按钮
- 验收: 能显示已创建的角色列表，点击进入详情页（空壳）

## 交付物
- [ ] 可运行的 Tauri + FastAPI 桌面应用
- [ ] SQLite 数据库含所有核心表
- [ ] Character CRUD 完整 API + 测试
- [ ] 任务队列 + WebSocket 进度推送
- [ ] 按需下载框架（含断点续传）
- [ ] 角色库首页 UI
