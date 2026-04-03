# MVP Text-First Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先把 Mely AI 的文字主链从“可演示流程”收口成“真实可用闭环”，让用户能完成文字数据上传、真实微调训练、模型注册、角色对话验证这一整条 MVP 核心路径。

**Architecture:** 保持现有 Tauri + React/TypeScript + FastAPI + SQLite 架构不变，优先复用已落地的页面、任务队列、模型列表和聊天界面。核心工作不是重做 UI，而是把 `llm_training` 的占位执行器替换为真实执行路径，并把训练产物稳定送进模型管理和角色对话链路。

**Tech Stack:** Tauri 2.x、React 18、TypeScript、FastAPI、SQLite、Ollama、Unsloth QLoRA、TaskQueue、WebSocket 任务流

---

## 接手判断

### 当前真实状态

- [ ] **文字数据集管理已具备可用底座**
  - 现状：上传、预览、质量检测、前后端测试都在。
  - 关键文件：
    - `backend/app/api/llm_datasets.py`
    - `backend/app/services/llm_dataset.py`
    - `src/components/LLMDatasetPanel.tsx`
    - `backend/tests/test_llm_datasets.py`

- [ ] **文字训练 UI 与任务状态已具备可用底座**
  - 现状：训练页、任务列表、实时更新、取消能力都在。
  - 关键文件：
    - `backend/app/api/llm_training.py`
    - `backend/app/services/llm_training.py`
    - `src/components/LLMTrainingPanel.tsx`
    - `backend/tests/test_llm_training.py`

- [ ] **模型列表与聊天页已具备可用底座**
  - 现状：模型页、聊天会话、流式回复、历史消息都在。
  - 关键文件：
    - `backend/app/api/llm_models.py`
    - `backend/app/services/llm_model_service.py`
    - `backend/app/api/chat.py`
    - `backend/app/services/chat_service.py`
    - `src/components/LLMModelPanel.tsx`
    - `src/components/ChatPanel.tsx`
    - `backend/tests/test_chat.py`

- [ ] **MVP 最大缺口：真实训练执行器未接入**
  - 现状：`backend/app/services/llm_training.py` 仍是占位执行器，主问题不是页面，而是训练结果并未真实产生。
  - 关键文件：
    - `backend/app/services/llm_training.py`
    - `backend/tests/test_llm_training.py`

### 本计划的完成定义

- [ ] 用户能上传一份文字数据集并发起训练
- [ ] 训练任务在目标机器上真实执行，不再停留在占位流程
- [ ] 训练产物能自动出现在模型列表中
- [ ] 用户能在角色对话页选择并使用刚训练出的模型
- [ ] 同一组测试数据连续跑 3 次，主路径稳定
- [ ] 所有用户可见失败提示保持中文自然语言

---

## 文件地图

### 核心后端

- [ ] **Modify:** `backend/app/services/llm_training.py`
  - 责任：训练任务的真实执行、状态推进、训练结果写回、失败信息翻译

- [ ] **Modify:** `backend/app/api/llm_training.py`
  - 责任：训练启动、状态查询、取消流程的接口对齐

- [ ] **Modify:** `backend/app/services/llm_model_service.py`
  - 责任：接收训练产物，完成模型注册与版本入库

- [ ] **Modify:** `backend/app/services/ollama_service.py`
  - 责任：与 Ollama 的创建、加载、可用性探测对齐

- [ ] **Modify:** `backend/app/services/chat_service.py`
  - 责任：确保角色对话默认优先使用最新可用角色模型

- [ ] **Modify:** `backend/app/services/gpu_mutex.py`
  - 责任：明确文字训练与其他 GPU 任务的互斥边界

### 前端

- [ ] **Modify:** `src/components/LLMTrainingPanel.tsx`
  - 责任：把“训练中、导出中、注册中、完成、失败”的真实状态显示清楚

- [ ] **Modify:** `src/components/LLMModelPanel.tsx`
  - 责任：训练完成后模型列表刷新、版本展示、当前推荐版本显示

- [ ] **Modify:** `src/components/ChatPanel.tsx`
  - 责任：默认模型选择、角色模型未就绪提示、训练后快速进入验证对话

- [ ] **Modify:** `src/components/LLMWorkspace.tsx`
  - 责任：训练完成后流向模型页和对话页的衔接体验

### 测试

- [ ] **Modify:** `backend/tests/test_llm_training.py`
- [ ] **Modify:** `backend/tests/test_llm_models.py`
- [ ] **Modify:** `backend/tests/test_chat.py`
- [ ] **Modify:** `src/components/LLMTrainingPanel.tsx` 对应测试
- [ ] **Modify:** `src/components/ChatPanel.tsx` 对应测试
- [ ] **Add if needed:** `backend/tests/test_llm_e2e_flow.py`

---

## 按天接手任务

### Day 0：接手校准与冻结范围

**目标：** 用半天把“现在真的做到哪了”说清楚，只盯住文字闭环，不再并行扩散范围。

- [ ] 读取并对齐以下文件
  - `docs/PROJECT_CONTEXT.md`
  - `specs/M1_LLM_TRAINING.md`
  - `docs/M1_BUS_BOARD.md`
  - `backend/app/services/llm_training.py`
  - `backend/app/services/llm_model_service.py`
  - `backend/app/services/chat_service.py`

- [ ] 输出一张红黄绿状态表
  - 绿：真实可用
  - 黄：界面和流程在，但核心是占位
  - 红：未开始或不可用

- [ ] 冻结 MVP 范围
  - 只做：数据集 -> 训练 -> 模型注册 -> 角色对话验证
  - 暂不做：视觉扩展、语音增强、安装打磨、额外花哨功能

- [ ] 跑当前基线验证
  - Run: `pytest -q`
  - Expected: 当前全绿
  - Run: `npm run test:run`
  - Expected: 当前全绿

- [ ] 明确 Day 0 退出标准
  - 有一份文字主链缺口清单
  - 有一份 3070 验证数据集样本
  - 团队内部对接手顺序没有歧义

### Day 1：训练执行器替换设计与训练前检查

**目标：** 不改 UI 方向，先把占位训练器替换为真实训练通道的设计收好。

- [ ] 把 `llm_training.py` 从“占位执行器”拆成三段
  - 训练前预检
  - 真实训练执行
  - 导出与注册

- [ ] 加固训练前检查
  - Ollama 是否可用
  - 基础模型是否就绪
  - 数据集条目数是否达标
  - GPU 是否空闲
  - 当前模式是否满足 3070 显存上限

- [ ] 固定 3070 默认策略
  - `light`、`standard`、`fine` 的默认门槛
  - 3070 默认推荐 `standard`
  - 任何不稳的模式先不对用户开放

- [ ] 为真实执行器补测试桩
  - 成功路径
  - 显存不足
  - 数据集格式问题
  - 训练中断
  - 导出失败
  - 注册失败

- [ ] Day 1 退出标准
  - 训练链路的“真实执行边界”写清楚
  - 不再让导出、注册、聊天去猜训练结果长什么样

### Day 2：真实训练接入

**目标：** 让训练任务真的开始跑，而不是只在队列里做演示。

- [ ] 在 `backend/app/services/llm_training.py` 中接入真实训练入口
  - 用现有任务队列推进状态
  - 保持已有状态字段不推倒重来
  - 训练日志和错误统一转换为中文用户提示

- [ ] 让任务状态真实流动
  - `queued`
  - `preparing`
  - `training`
  - `exporting`
  - `registering`
  - `completed` / `failed`

- [ ] 接入中断与恢复策略
  - 最低要求：可取消
  - 若断点续训当轮太贵，先明确不做并给清楚提示

- [ ] 补后端测试
  - 训练启动后状态能推进
  - 失败后不会卡死在中间态
  - 中文错误文案可断言

- [ ] 验证
  - Run: `pytest -q backend/tests/test_llm_training.py`
  - Expected: 通过

- [ ] Day 2 退出标准
  - 训练不再是假跑
  - 失败能以用户能理解的话结束，而不是悬空

### Day 3：训练产物导出与模型注册

**目标：** 让训练完成后的结果真的进入模型管理，而不是停在训练页。

- [ ] 明确训练产物落点
  - adapter 输出路径
  - gguf 输出路径
  - 版本号命名规则

- [ ] 在训练完成后自动触发
  - 合并或导出
  - 写模型元数据
  - 调用 Ollama 注册

- [ ] 模型管理页联动
  - 刷新后看得到新版本
  - 新版本状态正确
  - 旧版本不被错误覆盖

- [ ] 补测试
  - 训练完成后模型记录创建成功
  - 注册失败时训练任务给出明确失败结果
  - 模型列表能区分 `pending / ready / failed`

- [ ] 验证
  - Run: `pytest -q backend/tests/test_llm_models.py`
  - Expected: 通过

- [ ] Day 3 退出标准
  - 用户不需要手动搬运训练结果
  - 新模型能进入系统，而不是只留在磁盘上

### Day 4：角色对话闭环

**目标：** 让训练结果真正被角色对话消费，完成 MVP 核心证明。

- [ ] 调整聊天默认模型选择规则
  - 优先最新可用角色模型
  - 没有角色模型时才回退到基础模型

- [ ] 优化聊天页提示
  - 训练未完成
  - 模型注册中
  - 模型不可用
  - Ollama 未运行

- [ ] 训练完成后的流向体验
  - 训练页完成后可一键跳到模型页
  - 模型页可一键进入角色对话
  - 角色对话默认带上刚训练完成的版本

- [ ] 补测试
  - 聊天能使用指定角色模型
  - 流式输出保持可用
  - 未就绪模型不会误进聊天主路径

- [ ] 验证
  - Run: `pytest -q backend/tests/test_chat.py`
  - Expected: 通过
  - Run: `npm run test:run`
  - Expected: 前端仍全绿

- [ ] Day 4 退出标准
  - 用户可以从训练结束直接进入“和角色说话”的验证环节

### Day 5：3070 真机主流程验证

**目标：** 把“代码层面完成”变成“目标硬件上真正可用”。

- [ ] 准备标准验证用例
  - 一份小数据集
  - 一份标准数据集
  - 一份故意质量差的数据集

- [ ] 在 3070 上跑 3 条主路径
  - 人设文档训练
  - 对话样本训练
  - 混合数据训练

- [ ] 在 3070 上跑 4 条异常路径
  - Ollama 未运行
  - GPU 被占用
  - 数据集过小
  - 训练失败或注册失败

- [ ] 记录真实结果
  - 训练耗时
  - 失败点
  - 默认模式是否需要继续收紧
  - 用户需要看到的文案是否足够清楚

- [ ] Day 5 退出标准
  - 至少 1 条完整主路径在 3070 上真实跑通
  - 异常路径都能被中文自然语言接住

### Day 6：文字闭环收口

**目标：** 把 Day 1-5 的结果收成可演示、可继续开发的稳定基线。

- [ ] 清理不稳定入口
  - 隐藏或降级不稳模式
  - 修正文案与默认值
  - 去掉任何“看起来能用但其实不稳”的入口

- [ ] 补最终验证脚本
  - 后端核心测试
  - 前端核心测试
  - 一份手工演示流程说明

- [ ] 更新接手文档与总线板
  - 文字主链完成到什么程度
  - 哪些问题还留着
  - 下一阶段应该接什么

- [ ] Day 6 验收
  - 用户能完成：
    - 上传文字数据
    - 发起训练
    - 等待完成
    - 看到模型
    - 打开聊天
    - 感受到角色差异

---

## Day 7+：文字闭环之后的接续顺序

### Day 7-9：视觉训练收口

- [ ] 把 `backend/app/services/visual_training_service.py` 从占位执行器切到真实执行
- [ ] 确保图片数据集质量检查与训练结果绑定回角色
- [ ] 在 3070 上确认默认视觉训练模式

### Day 10-12：图像生成收口

- [ ] 把 `backend/app/api/generations.py` 的 mock 生成改成真实生成
- [ ] 打通图像引擎启动、参数注入、单张生成、批量队列、历史归档
- [ ] 跑通“训练完成角色 -> 生成工作台 -> 真正出图”

### Day 13-14：语音收口

- [ ] 把 `backend/app/services/voice_service.py` 的占位输出替换为真实语音结果
- [ ] 验证绑定、合成、历史回看

### Day 15+：打包与发布准备

- [ ] 安装引导
- [ ] 模型下载体验
- [ ] 首次启动流程
- [ ] Windows 打包

---

## 每天收工前必须检查

- [ ] 当天代码路径至少跑过一轮真实验证
- [ ] 新增用户可见错误全部是中文自然语言
- [ ] 没有引入新的“假入口”
- [ ] 当天结果写回状态板或接手文档
- [ ] 保持 `pytest -q` 与 `npm run test:run` 可通过

---

## 推荐切入点

如果现在立刻开始，**第一刀只切 `backend/app/services/llm_training.py`**。

原因：

- [ ] 它是文字闭环目前最大的真实缺口
- [ ] 前后端 UI 已经基本具备，不需要先重做页面
- [ ] 一旦训练结果能真实落地，模型管理和角色对话都能快速收口

---

## 交付判断

本计划不是以“做完多少页面”为完成，而是以“用户是不是已经能完成这条链”来判断：

- [ ] 角色文字数据集可上传
- [ ] 角色模型可真实训练
- [ ] 角色模型可被系统识别和管理
- [ ] 角色模型可进入对话
- [ ] 用户能明显感觉到“这个角色已经像它自己在说话”
