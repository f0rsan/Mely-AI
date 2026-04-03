# Mely AI — 技术架构

## 系统架构总览

```
┌─────────────────────────────────────────────────┐
│                Tauri 桌面应用                      │
│  ┌───────────────────────────────────────────┐  │
│  │         React/TypeScript 前端              │  │
│  │  角色卡片 · 训练面板 · 生成台 · 版本树 · 图库  │  │
│  └───────────────────┬───────────────────────┘  │
│                      │ HTTP/WebSocket            │
│  ┌───────────────────▼───────────────────────┐  │
│  │         Python FastAPI (sidecar)           │  │
│  │  Character Service · Training Manager      │  │
│  │  Generation Scheduler · Voice Service      │  │
│  │  Asset Vault (AES-256)                     │  │
│  └──────┬──────────┬──────────┬──────────────┘  │
│         │          │          │                   │
│  ┌──────▼──┐ ┌─────▼────┐ ┌──▼─────────┐        │
│  │AI-Toolkit│ │ComfyUI   │ │F5-TTS /    │        │
│  │LoRA训练  │ │API 推理   │ │CosyVoice3  │        │
│  └─────────┘ └──────────┘ └────────────┘        │
│                      │                           │
│  ┌───────────────────▼───────────────────────┐  │
│  │            SQLite + 本地文件系统             │  │
│  │  角色元数据 · LoRA文件(加密) · 音频 · 图片    │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## 关键技术决策 (ADR)

### ADR-001: 选择 Tauri 而非 Electron

**决策**: Tauri 2.x + React/TypeScript

**理由**:
- Tauri 使用系统 WebView（不打包 Chromium），安装包 ~8MB vs Electron ~80MB
- 内存占用低 50%，省下的内存留给 GPU VRAM
- 前端复用 TypeScript/React 技能，迁移成本最低
- Tauri 2.x 支持 sidecar 进程，可以原生管理 Python 后端生命周期

### ADR-002: 选择 SQLite 而非 Postgres

**决策**: SQLite 单文件数据库

**理由**:
- 本地优先桌面应用，零配置、单文件、无需独立进程
- 随应用启动/关闭，用户无需安装数据库
- Postgres 是 SaaS 服务端数据库，与「完全本地、无服务器」的产品承诺直接矛盾

### ADR-003: 对接 ComfyUI API 而非自建推理

**决策**: ComfyUI 无头模式启动，通过 websocket/REST API 调用

**理由**:
- ComfyUI 已是生态标准，拥有最广泛的模型支持和自定义节点库
- Mely 通过 API 模式调用推理能力，不暴露 ComfyUI 界面
- 既利用成熟推理引擎，又提供 Mely 自己的角色工作台体验
- **Fallback**: 如 ComfyUI 稳定性不达标，切换到 diffusers 直接推理

### ADR-004: AI-Toolkit 与 Unsloth 分工

**决策**: AI-Toolkit 负责图像 LoRA，Unsloth 负责语言/音频微调

**理由**:
- AI-Toolkit（Kohya 兼容）→ 图像扩散模型 LoRA 训练（FLUX/SDXL）
- Unsloth → 语言/音频 Transformer 模型微调（TTS、LLM）
- 两者服务完全不同的模型类型，互补而非竞争
- Unsloth 只用 Apache 2.0 训练库，不引入 AGPL-3.0 的 Studio UI

### ADR-005: 按需下载框架

**决策**: 首次启动按需下载模型文件，App 本体 < 100MB

**理由**:
- 最小视觉包 ~5GB，完整包 ~9GB，不适合打包到安装程序
- 分级下载：基础模型 → 训练引擎 → TTS 模型
- 下载进度持久化，支持断点续传
- 用户可选择只安装需要的模块

## 进程模型

```
[Tauri App] ─── 启动 ──→ [Python FastAPI sidecar]
                               │
                               ├── 启动 ──→ [ComfyUI 无头进程]（按需）
                               ├── 调用 ──→ [AI-Toolkit 训练]（按需）
                               └── 调用 ──→ [F5-TTS 推理]（按需）
```

- Tauri 负责管理 Python sidecar 进程的生命周期
- Python 后端负责管理 ComfyUI 和其他 AI 引擎的生命周期
- 训练与生成使用互斥锁，不允许同时占用 GPU
- ComfyUI 崩溃时自动重启，给用户明确文字提示

## 前端路由结构（预期）

```
/                        → 角色库（卡片网格）
/character/:id           → 角色详情（DNA + 造型树 + 历史）
/character/:id/generate  → 生成工作台
/character/:id/train     → 训练面板
/character/:id/voice     → 声音绑定
/character/:id/export    → 设定书导出
/settings                → 全局设置（模型路径、GPU 配置）
/onboarding              → 新手引导 + 模型下载
```
