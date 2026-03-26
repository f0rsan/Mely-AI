# Mely AI — 角色工作台 · Codex Workspace

## 目录结构

```
├── docs/                        ← 核心产品与技术文档（Markdown）
│   ├── PROJECT_CONTEXT.md       ← 全局上下文、硬件约束、风险项
│   ├── ARCHITECTURE.md          ← 系统架构与进程模型
│   ├── DATA_MODEL.md            ← SQLite schema 与文件系统布局
│   ├── USER_JOURNEY.md          ← Vtuber 用户旅程与痛点
│   ├── FEATURE_SPEC.md          ← v1/v1.5/v2 功能范围
│   └── DECISIONS.md             ← 已确认决策与待决策项
│
├── specs/                       ← 模块任务拆解与交互规格
│   ├── M0_FOUNDATION.md         ← 基础层任务
│   ├── M1_VISUAL_TRAINING.md    ← 视觉训练任务
│   ├── M2_GENERATION.md         ← 生成工作台任务
│   ├── M3_VOICE.md              ← 声音绑定任务
│   ├── M4_COSTUME_EXPORT.md     ← 造型与导出任务
│   ├── M5_PACKAGING.md          ← 打包发布任务
│   └── visual/
│       ├── character_workbench_spec_final_v2.html   ← 功能规格（数据模型/流程/架构）
│       └── vtuber_user_journey_deep_dive.html       ← Vtuber 用户旅程深度分析
│
├── prototypes/                  ← UI 交互原型（React JSX）
│   ├── mely-unified.jsx         ← ⭐ 合并原型（4 模块可导航，推荐先看这个）
│   ├── character-library.jsx    ← 角色库主页（卡片网格 + 创建入口）
│   ├── character-detail.jsx     ← 角色详情页（DNA/造型树/历史/声音/安全）
│   ├── generation-workbench.jsx ← 生成工作台（场景输入 + Prompt 组装 + 批量队列）
│   └── lora-training-panel.jsx  ← LoRA 训练面板（数据集 + 训练进度 + 验证）
│
└── src/                         ← M0 开始后在此创建 Tauri + React 项目
```

## 原型说明

- 所有 `.jsx` 文件可在 Claude Artifacts 中直接预览（粘贴到对话即可渲染）
- `mely-unified.jsx` 是合并版本，包含完整导航和所有 4 个模块
- 原型使用 mock 数据，数据结构对齐 spec 中的 Character / Costume / Generation / VoiceAssets 模型
- 正式开发时用 TypeScript 重写，从原型中提取设计意图，不直接 copy
- 交互式 HTML 规格的正式位置是 `specs/visual/`
- 根目录下的同名 `.html` 文件视为历史副本，不作为当前开发输入

## 技术栈（已锁定）

- 桌面框架：Tauri + React/TypeScript
- 后端服务：Python FastAPI（sidecar 进程）
- 数据层：SQLite + AES-256 加密
- 视觉训练：AI-Toolkit（FLUX LoRA）
- 图像生成：ComfyUI API 无头模式
- 声音克隆：F5-TTS / CosyVoice3
- 目标硬件：RTX 3070 8GB VRAM

## 开发计划

| 模块 | 时间 | 核心交付 |
|------|------|---------|
| M0 基础层 | W1–3 | Tauri+FastAPI 骨架，SQLite schema，任务队列 |
| M1 视觉训练 | W4–7 | 数据集管理，LoRA 训练，文字创角 |
| M2 生成工作台 | W8–10 | ComfyUI 接入，Prompt 组装，批量生成 |
| M3 声音绑定 | W11–12 | F5-TTS 集成，声纹绑定 |
| M4 造型&导出 | W13–15 | 造型版本树，设定书 PDF |
| M5 打包发布 | W16–18 | 安装引导，Windows 打包 |
