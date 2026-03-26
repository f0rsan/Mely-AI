# Mely AI — 项目全局上下文

> ⚠️ 每个 Codex 线程开始前必须读此文件。这是所有已锁定决策的唯一真相来源。

## 1. 产品定位

Mely AI 是一款**本地优先的桌面 AI 创作应用**（Windows-first，RTX 30/40 系列 GPU）。核心产品是「角色工作台 Character Workbench」——以「角色」为第一公民，绑定视觉 LoRA、声音指纹、外貌参数、生成历史、造型版本树，让用户的角色在任意场景下保持一致。

**核心价值主张：「你的角色，永远是同一个人。」**

解决的根本问题：现有图像生成工具只管生成，不管「是谁生成的」。角色在不同场景下无法保持一致。

## 2. 目标用户（优先级排序）

1. **Indie Vtuber 创作者**（核心用户）— 需要角色跨直播封面、素材、周边保持一致。高频使用、高付费意愿。
2. **IP / 漫画创作者** — 连载角色需要在数十章中保持视觉一致性。私密性要求高。
3. **独立游戏开发者** — 角色概念设计迭代快，需要版本分支管理和多视角素材批量生成。
4. **个人隐私创作者** — 不想数据上云，需要完全本地的私人角色创作环境。

## 3. 技术栈（已锁定 · 不可替换）

| 层 | 技术选型 | 选型理由 |
|----|---------|---------|
| 桌面框架 | Tauri 2.x + React/TypeScript | 安装包 ~8MB（vs Electron ~80MB），省内存留给 GPU |
| 后端服务 | Python FastAPI | sidecar 进程，随 Tauri 应用启动/关闭 |
| 数据层 | SQLite | 零配置、单文件、无需独立进程，本地优先的唯一正确选择 |
| LoRA 加密 | AES-256 | 绑定设备指纹，防止模型文件泄露 |
| 视觉训练 | AI-Toolkit（Kohya 兼容） | 支持 FLUX/SDXL LoRA 训练 |
| 图像生成 | ComfyUI API（无头模式） | 生态标准，最广泛的模型支持和自定义节点库 |
| 一致性补充 | IP-Adapter | 无训练快速参考 |
| 自动打标 | WD14 Tagger | 辅助角色 DNA 自动提取 |
| 声音克隆 | F5-TTS / CosyVoice3 / IndexTTS-2 | 零样本克隆，3–30 秒参考音频即可 |
| 默认模型 | FLUX-schnell 或 FLUX-dev | M1 第一周 PoC 后锁定 |

### v1.5 追加（v1 验证后才引入）
| 层 | 技术选型 | 说明 |
|----|---------|------|
| 声音精训 | Unsloth TTS 微调 | 仅用 Apache 2.0 训练库，不集成 Studio UI (AGPL-3.0) |
| 对话风格 | Unsloth LLM 微调 | 基于角色设定书微调本地 LLM |

### 关键分工边界
- **AI-Toolkit** → 图像扩散模型 LoRA 训练（FLUX/SDXL）
- **Unsloth** → 语言/音频类 Transformer 模型微调（TTS、LLM）
- 两者互补而非竞争

## 4. 硬件约束

| 参数 | 值 |
|------|-----|
| 目标硬件 | RTX 3070 8GB VRAM |
| 最低支持 | RTX 3060 8GB VRAM |
| 默认训练模式 | 严格控制在 8GB VRAM 以内 |
| 精细训练模式 | 需要 12GB VRAM，必须提示用户 |
| App 本体 | < 100MB |
| 首次下载（最小视觉包） | ~5GB |
| 首次下载（完整包） | ~9GB |

## 5. 开发计划

| 模块 | 周数 | 核心交付 |
|------|------|---------|
| M0 基础层 | W1–3 | Tauri+FastAPI 骨架，SQLite schema，任务队列，按需下载框架 |
| M1 视觉训练 | W4–7（含 1 周 buffer） | 数据集管理，AI-Toolkit LoRA 训练，进度可视化，文字创角入口 |
| M2 生成工作台 | W8–10（含 1 周 buffer） | ComfyUI 接入，Prompt 自动组装，批量生成，图库归档 |
| M3 声音绑定 | W11–12 | F5-TTS 集成，声纹绑定，TTS 生成归档 |
| M4 造型&导出 | W13–15 | 造型版本树，设定书 PDF 导出，创作时间戳 |
| M5 打包发布 | W16–18 | 安装引导，新手 Onboarding，用户测试，Windows 打包 |

## 6. 编码规范

- **前端**: TypeScript strict mode, React functional components + hooks, Tailwind CSS
- **后端**: Python 3.11+, type hints everywhere, Pydantic models for all API schemas
- **代码注释**: 英文
- **Commit message**: `[M{N}] {简短英文描述}`, e.g. `[M0] Add SQLite schema migration`
- **UI 文本**: 中文（后续做 i18n）
- **测试**: TDD，每个功能先写测试
- **错误处理**: 所有用户可见的错误信息用中文自然语言，禁止暴露 Python traceback

## 7. 已识别的高风险项

| 风险 | 缓解策略 | 涉及模块 |
|------|---------|---------|
| ComfyUI 无头调用稳定性 | M2 前必须验证，准备 diffusers fallback | M2 |
| RTX 3070 VRAM 上限 | 精细训练提示需 12GB，默认严格控制 8GB | M1 |
| 安装体积 | 按需下载框架必须在 M0 建好 | M0 |
| 训练失败路径 | 所有技术错误翻译成用户语言 | M1 |
| 训练与生成资源冲突 | 互斥锁，ComfyUI 崩溃自动重启 | M2 |

## 8. 待决策项（每次相关讨论前先确认）

- [ ] 是否在 v1 支持多用户配置文件切换（家庭共用设备场景）
- [ ] 训练数据来自 AI 生成图时的警告策略
- [ ] 「一致性」对用户可见的量化语言（如何表达而非显示技术得分）
