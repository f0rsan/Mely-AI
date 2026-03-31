# Mely AI — Claude Code 开发指南

> 本项目由 Claude Code 接管开发。这是一个本地优先的 AI 角色创作桌面应用。

## 项目核心

**产品定位**：本地优先的桌面 AI 创作应用（Windows-first，RTX 30/40 GPU）
**核心价值**：「你的角色，永远是同一个人。」——让角色在任意场景下保持视觉一致性
**目标用户**：Indie Vtuber 创作者、IP/漫画创作者、独立游戏开发者

## 技术栈（不可修改）

### 前端
- **框架**：Tauri 2.x + React 18 + TypeScript
- **样式**：Tailwind CSS
- **构建**：Vite
- **规范**：TypeScript strict mode, React functional components + hooks

### 后端
- **框架**：Python FastAPI（作为 Tauri sidecar 进程）
- **数据库**：SQLite（单文件，零配置）
- **加密**：AES-256（LoRA 模型文件加密）
- **测试**：Pytest

### AI 引擎
- **视觉训练**：AI-Toolkit（Kohya 兼容，FLUX/SDXL LoRA）
- **图像生成**：ComfyUI API（无头模式）
- **声音克隆**：F5-TTS / CosyVoice3
- **自动打标**：WD14 Tagger
- **一致性补充**：IP-Adapter

## 硬件约束

- **目标硬件**：RTX 3070 8GB VRAM
- **最低支持**：RTX 3060 8GB VRAM
- **默认训练**：严格控制在 8GB VRAM 以内
- **精细训练**：需要 12GB VRAM（必须提示用户）
- **应用体积**：< 100MB（本体）

## 开发规范

### 代码风格
- **注释语言**：英文
- **UI 文本**：中文（后续做 i18n）
- **Commit 格式**：`[M{N}] {简短英文描述}`
  - 示例：`[M0] Add SQLite schema migration`
  - 示例：`[M1] Implement LoRA training progress UI`

### 错误处理
- 所有用户可见的错误信息必须用**中文自然语言**
- **禁止**直接暴露 Python traceback 或技术栈信息
- 技术错误必须翻译成用户可理解的描述

### 测试要求
- **TDD**：每个功能先写测试
- 前端测试：`npm run test:run`
- 后端测试：`python -m pytest backend/tests -q`

## 项目结构

```
Mely AI/
├── docs/                        # 核心产品与技术文档（只读）
│   ├── PROJECT_CONTEXT.md       # 全局上下文、硬件约束、风险项
│   ├── ARCHITECTURE.md          # 系统架构与进程模型
│   ├── DATA_MODEL.md            # SQLite schema 与文件系统布局
│   ├── USER_JOURNEY.md          # Vtuber 用户旅程与痛点
│   ├── FEATURE_SPEC.md          # v1/v1.5/v2 功能范围
│   └── DECISIONS.md             # 已确认决策与待决策项
│
├── specs/                       # 模块任务拆解（只读）
│   ├── M0_FOUNDATION.md         # 基础层任务
│   ├── M1_VISUAL_TRAINING.md    # 视觉训练任务
│   ├── M2_GENERATION.md         # 生成工作台任务
│   ├── M3_VOICE.md              # 声音绑定任务
│   ├── M4_COSTUME_EXPORT.md     # 造型与导出任务
│   └── M5_PACKAGING.md          # 打包发布任务
│
├── prototypes/                  # UI 交互原型（React JSX）
│   └── mely-unified.jsx         # 合并原型（4 模块可导航）
│
├── src/                         # Tauri + React 前端代码
│   ├── components/              # React 组件
│   ├── pages/                   # 页面组件
│   ├── services/                # API 客户端
│   └── types/                   # TypeScript 类型定义
│
├── src-tauri/                   # Tauri Rust 后端
│   ├── src/                     # Rust 源码
│   └── Cargo.toml               # Rust 依赖
│
├── backend/                     # Python FastAPI 后端
│   ├── app/                     # FastAPI 应用
│   │   ├── api/                 # API 路由
│   │   ├── models/              # Pydantic 模型
│   │   ├── services/            # 业务逻辑
│   │   └── db.py                # SQLite 连接
│   ├── tests/                   # 后端测试
│   └── requirements.txt         # Python 依赖
│
└── CLAUDE.md                    # 本文件
```

## 开发进度

### 当前状态
- ✅ **M0-A 基础层**：Tauri 桌面壳、React 状态页、FastAPI 后端、SQLite 初始化
- ✅ 首页显示：后端连接状态、本地数据目录、数据库路径、数据库初始化状态

### 开发计划
| 模块 | 周数 | 核心交付 |
|------|------|---------|
| M0 基础层 | W1–3 | Tauri+FastAPI 骨架，SQLite schema，任务队列 |
| M1 视觉训练 | W4–7 | 数据集管理，LoRA 训练，进度可视化 |
| M2 生成工作台 | W8–10 | ComfyUI 接入，Prompt 组装，批量生成 |
| M3 声音绑定 | W11–12 | F5-TTS 集成，声纹绑定 |
| M4 造型&导出 | W13–15 | 造型版本树，设定书 PDF 导出 |
| M5 打包发布 | W16–18 | 安装引导，Windows 打包 |

## 本地开发

### 环境要求
- Node.js 20+
- Python 3.12+
- Rust stable（`cargo` / `rustc`）

### 启动开发环境
```bash
# 1. 安装依赖
npm install
python -m pip install -e "backend[dev]"

# 2. 启动桌面开发环境
npm run tauri:dev
```

这个命令会一起拉起：
- React 开发服务器：`http://127.0.0.1:1420`
- FastAPI 后端：`http://127.0.0.1:8000`
- Tauri 桌面窗口

### 本地数据目录
首次启动后自动创建：
```
~/.mely/
├── db/mely.db
├── characters/
├── models/
└── temp/
```

## 重要注意事项

### ⚠️ 不要修改的文件
- `docs/` 目录下的所有文档（核心规格，已锁定）
- `specs/` 目录下的所有文档（任务拆解，已确认）
- `prototypes/` 目录（仅供参考，正式开发用 TypeScript 重写）

### ⚠️ 高风险项
| 风险 | 缓解策略 | 涉及模块 |
|------|---------|---------|
| ComfyUI 无头调用稳定性 | M2 前必须验证，准备 diffusers fallback | M2 |
| RTX 3070 VRAM 上限 | 精细训练提示需 12GB，默认严格控制 8GB | M1 |
| 安装体积 | 按需下载框架必须在 M0 建好 | M0 |
| 训练失败路径 | 所有技术错误翻译成用户语言 | M1 |

### ✅ 推荐工作流
1. 开始新功能前，先阅读 `docs/` 和 `specs/` 了解上下文
2. 遵循 TDD，先写测试再写实现
3. 前端组件使用 TypeScript strict mode
4. 后端 API 使用 Pydantic models
5. Commit message 格式：`[M{N}] {描述}`
6. 所有用户可见错误用中文，技术错误用英文注释

## 常见问题

### Q: Cargo 不在 PATH 中？
```bash
# 将以下目录加入 PATH
/opt/homebrew/opt/rustup/bin
$HOME/.cargo/bin
```

### Q: 代理拦截 Rust 依赖下载？
```bash
# 启动前临时取消代理环境变量
env -u ALL_PROXY -u HTTPS_PROXY -u HTTP_PROXY npm run tauri:dev
```

### Q: 如何测试？
```bash
# 前端测试
npm run test:run

# 后端测试
python -m pytest backend/tests -q

# 构建检查
npm run build
```
