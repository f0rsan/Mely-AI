# M1 LLM 训练执行器 — 线程拆解与提示词

> 用途：把 `T0 ~ T6` 拆成可在新线程中直接执行的工作包。每个线程都尽量只负责一块清晰边界，减少互相覆盖。

## 一、执行顺序总览

### 必须串行

1. **T0 依赖隔离**
2. **T1 基础模型映射与训练前校验**
3. **T2 Unsloth Worker 子进程脚本**
4. **T3 用真实 Runner 替换 stub**

### 可并行

- **T6 前端训练页增强** 可以在 **T1** 完成接口口径后并行推进
- **T4 自动注册** 与 **T5 启动恢复** 可以在 **T3** 完成后并行推进

## 二、推荐波次

### 波次 0（先做）

- **T0**

### 波次 1（可并行）

- **T1**
- **T6**

### 波次 2（串行）

- **T2**

### 波次 3（串行）

- **T3**

### 波次 4（可并行）

- **T4**
- **T5**

## 三、线程使用规则

每个线程开头都建议带上这段通用要求：

```text
请先读取：
1. docs/PROJECT_CONTEXT.md
2. specs/M1_LLM_TRAINING.md
3. docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md
4. docs/superpowers/plans/2026-04-13-m1-llm-training-thread-prompts.md

本线程只处理我指定的任务范围，不要顺手扩改其他任务。
完成前请自己跑测试，并用中文告诉我：
- 你改了什么
- 实际验证了什么
- 还有什么没做
```

---

## T0 线程提示词

### 线程定位

- 任务名：**T0 依赖隔离与运行时契约**
- 是否可并行：**否**
- 前置：无
- 交付给：T1 / T2 / T3

### 本线程边界

- 只处理后端依赖隔离
- 不接真实训练
- 不改前端
- 不碰 T1 的模型映射逻辑

### 目标

- 把 GPU 训练依赖从基础后端依赖里隔离出来
- 保证没装 Unsloth 也能正常启动 FastAPI
- 把“缺少训练依赖时怎么报错”这件事定义清楚

### 重点文件

- `backend/pyproject.toml`
- `backend/app/main.py`
- `backend/tests/test_setup.py`
- 如有需要，可补：
  - `backend/tests/test_llm_training.py`

### 完成标准

- 基础后端安装不引入 Unsloth/Torch/TRL
- 缺少训练依赖时，应用能启动
- 训练相关能力在真正启动训练时再给中文错误
- 测试能证明这一点

### 可直接复制的提示词

```text
请处理 T0：依赖隔离与运行时契约。

先读取：
1. docs/PROJECT_CONTEXT.md
2. specs/M1_LLM_TRAINING.md
3. docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md
4. docs/superpowers/plans/2026-04-13-m1-llm-training-thread-prompts.md
5. backend/pyproject.toml
6. backend/app/main.py
7. backend/tests/test_setup.py

任务目标：
- 给后端增加独立的 GPU/训练可选依赖组，不要把 Unsloth/Torch 混进基础依赖
- 保证未安装 GPU 训练依赖时，FastAPI 仍可正常启动
- 明确训练运行时契约：缺少依赖时，不在 import 阶段崩溃，而是在真正启动训练时返回中文错误

实现要求：
- 优先复用现有 backend 结构，不要引入新的配置体系
- 不要顺手改训练执行逻辑，只做依赖边界和启动安全
- 用户可见错误必须是中文自然语言

验证要求：
- 至少运行 `pytest -q backend/tests/test_setup.py`
- 如果新增了训练依赖缺失场景测试，也一并运行对应测试

输出要求：
- 用中文告诉我你改了什么
- 贴出你实际跑过的测试命令和结果
- 明确说明这一步给后续 T1/T2/T3 提供了什么前提
```

---

## T1 线程提示词

### 线程定位

- 任务名：**T1 基础模型映射 + 训练前校验**
- 是否可并行：**可与 T6 并行**
- 前置：**T0 完成**
- 交付给：T2 / T3 / T6

### 本线程边界

- 只处理训练前校验与模型映射
- 不写 Unsloth worker
- 不改前端界面
- 不处理自动注册

### 目标

- 建立 Ollama 模型名到真实训练模型配置的映射
- 训练启动前确认：模型受支持、已下载、当前模式允许
- 给训练服务提供稳定的配置入口

### 重点文件

- 新建 `backend/app/services/llm_base_models.py`
- 修改 `backend/app/services/llm_training.py`
- 新建 `backend/tests/test_llm_base_models.py`
- 修改 `backend/tests/test_llm_training.py`

### 完成标准

- `start_training()` 不再接受任意 base model
- 未下载模型、未知模型、超出硬件口径时，返回清晰中文错误
- 模型映射成为单一事实来源

### 可直接复制的提示词

```text
请处理 T1：基础模型映射 + 训练前校验。

前置假设：
- T0 已完成，依赖隔离已经到位

先读取：
1. docs/PROJECT_CONTEXT.md
2. specs/M1_LLM_TRAINING.md
3. docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md
4. backend/app/services/llm_training.py
5. backend/app/services/llm_catalog.py
6. backend/app/api/llm_training.py
7. backend/tests/test_llm_training.py

任务目标：
- 新建 `backend/app/services/llm_base_models.py`
- 建立 Ollama tag -> 训练配置 的映射
- 在训练开始前做预检：
  - 模型是否受支持
  - 模型是否已在 Ollama 中可用
  - 当前模式是否符合当前硬件口径
- 返回统一的中文错误

实现边界：
- 不接真实训练执行器
- 不处理子进程
- 不改前端
- 不顺手做自动注册

建议覆盖：
- 训练兼容模型配置结构
- 默认 LoRA rank / max seq len / 量化预期
- 16GB 当前验证机与 8GB 产品基线的安全口径不要混掉

验证要求：
- 运行 `pytest -q backend/tests/test_llm_base_models.py backend/tests/test_llm_training.py`
- 至少覆盖：未知模型、未下载模型、允许模型、模式限制

输出要求：
- 用中文总结新增了哪些训练前规则
- 明确告诉我 T2/T3/T6 后续应该依赖哪个模块/函数/结构
```

---

## T2 线程提示词

### 线程定位

- 任务名：**T2 Unsloth 子进程 Worker**
- 是否可并行：**否**
- 前置：**T1 完成**
- 交付给：T3

### 本线程边界

- 只负责独立 worker 脚本
- 不改 API
- 不替换主训练 runner
- 不做模型注册

### 目标

- 创建独立的训练进程脚本
- 定义好父进程与子进程之间的 JSON 协议
- 支持进度、状态、完成、错误、取消、checkpoint、GGUF 导出

### 重点文件

- 新建 `backend/app/services/unsloth_worker.py`
- 新建或修改 `backend/tests/test_llm_training_runner.py`

### 完成标准

- worker 可以单独运行
- 不把 Unsloth import 带进主 FastAPI 进程
- stdout 只输出协议 JSON 行
- 支持 dry-run 或协议级测试

### 可直接复制的提示词

```text
请处理 T2：Unsloth 子进程 Worker。

前置假设：
- T1 已完成，训练基础模型映射已经有了稳定输入

先读取：
1. docs/PROJECT_CONTEXT.md
2. specs/M1_LLM_TRAINING.md
3. docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md
4. backend/app/services/llm_training.py
5. backend/scripts/validate_llm_pipeline.py
6. backend/pyproject.toml

任务目标：
- 新建 `backend/app/services/unsloth_worker.py`
- 实现独立训练子进程入口
- 定义并输出行式 JSON 协议：
  - progress
  - status
  - complete
  - error
- 支持 checkpoint 保存
- 支持取消
- 成功时导出 GGUF

关键要求：
- 不要把 Unsloth 的 import 放回主 API 进程
- Windows 上取消不能只依赖 POSIX signal；请用更稳的可观测取消方案
- stderr 需要落盘或可追踪，但不要把 traceback 暴露给用户
- 优先先把协议和进程边界做扎实，再考虑训练细节

验证要求：
- 至少补齐 worker 协议层测试
- 如果支持 dry-run，请实际跑一次 dry-run 验证配置解析

输出要求：
- 用中文告诉我 worker 现在接受什么输入、输出什么事件
- 明确说明 T3 应该如何调用它
```

---

## T3 线程提示词

### 线程定位

- 任务名：**T3 用真实 runner 替换 stub**
- 是否可并行：**否**
- 前置：**T2 完成**
- 交付给：T4 / T5

### 本线程边界

- 只改主训练服务的真实编排
- 不改前端
- 不单独实现模型注册逻辑细节
- 不做启动恢复

### 目标

- 用子进程 worker 真正替换掉当前的 stub
- 把训练任务状态、进度、取消、失败翻译、产物路径写回现有系统

### 重点文件

- `backend/app/services/llm_training.py`
- `backend/app/main.py`
- `backend/tests/test_llm_training.py`
- `backend/tests/test_llm_training_runner.py`

### 完成标准

- 当前 placeholder 路径被彻底替换
- 任务状态能真实推进
- worker 输出能实时回写任务状态
- 取消和失败都能落到中文结果

### 可直接复制的提示词

```text
请处理 T3：把真实 runner 接进 LLM 训练服务，替换掉当前 stub。

前置假设：
- T1 已提供模型映射和训练前校验
- T2 已提供可调用的 `unsloth_worker.py`

先读取：
1. docs/PROJECT_CONTEXT.md
2. specs/M1_LLM_TRAINING.md
3. docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md
4. backend/app/services/llm_training.py
5. backend/app/main.py
6. backend/app/services/task_queue.py
7. backend/app/services/gpu_mutex.py
8. backend/tests/test_llm_training.py
9. backend/tests/test_llm_training_runner.py

任务目标：
- 用真实子进程编排替换 `_build_runner()` 中的 stub
- 把 `data_root` 和后续需要的服务依赖注入到训练服务
- 构建 worker 配置并启动子进程
- 逐行消费 worker stdout JSON
- 更新 DB 中的状态、进度、步数、loss、eta、产物路径
- 支持取消
- 把常见失败翻译成稳定中文错误

实现边界：
- 本线程先把训练主编排做通
- 自动注册逻辑可以留给 T4
- 启动恢复留给 T5

验证要求：
- 运行 `pytest -q backend/tests/test_llm_training.py backend/tests/test_llm_training_runner.py`
- 覆盖成功、失败、取消、协议异常至少几条主路径

输出要求：
- 用中文告诉我 stub 被替换成什么真实流程
- 明确列出 T4/T5 可以基于哪些已完成状态继续做
```

---

## T4 线程提示词

### 线程定位

- 任务名：**T4 训练完成后的 Ollama 自动注册**
- 是否可并行：**可与 T5 并行**
- 前置：**T3 完成**
- 交付给：产品可用闭环

### 本线程边界

- 只处理训练完成后的模型注册交接
- 不改 worker
- 不做前端训练页增强
- 不做启动恢复

### 目标

- 训练完成后自动调用现有模型注册服务
- 区分“导出成功但注册失败”和“训练本身失败”

### 重点文件

- `backend/app/services/llm_training.py`
- 如有必要：`backend/app/services/llm_model_service.py`
- `backend/tests/test_llm_models.py`
- `backend/tests/test_llm_training_runner.py`

### 完成标准

- 训练成功时可以直接生成私有模型记录
- 注册失败时仍保留可重试状态
- UI 后续可以据此展示“已完成但待注册”

### 可直接复制的提示词

```text
请处理 T4：训练完成后的 Ollama 自动注册。

前置假设：
- T3 已经把真实训练 runner 接好

先读取：
1. docs/PROJECT_CONTEXT.md
2. specs/M1_LLM_TRAINING.md
3. docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md
4. backend/app/services/llm_training.py
5. backend/app/services/llm_model_service.py
6. backend/tests/test_llm_models.py
7. backend/tests/test_llm_training_runner.py

任务目标：
- 在训练 worker 返回 complete 后，自动调用 `LLMModelService.register_model()`
- 把 GGUF 路径、最终 loss 等写回训练任务
- 注册成功：训练任务 completed，模型 ready
- 注册失败但 GGUF 已存在：训练任务 completed，模型 pending，可重试
- GGUF 导出失败：训练任务 failed

实现要求：
- 不重复造新的模型管理逻辑
- 复用现有模型服务
- 中文状态语义要清楚，避免用户以为“训练成功但模型凭空消失”

验证要求：
- 运行 `pytest -q backend/tests/test_llm_models.py backend/tests/test_llm_training_runner.py`

输出要求：
- 用中文告诉我训练完成后现在会发生哪几步
- 明确区分“训练成功但注册待重试”和“训练失败”
```

---

## T5 线程提示词

### 线程定位

- 任务名：**T5 启动时恢复中断任务**
- 是否可并行：**可与 T4 并行**
- 前置：**T3 完成**
- 交付给：系统稳定性

### 本线程边界

- 只处理应用重启后的任务恢复
- 不改 worker
- 不改前端
- 不做模型注册

### 目标

- 应用重启后，把悬挂中的训练任务收口成明确失败，而不是永远卡住

### 重点文件

- `backend/app/services/llm_training.py`
- `backend/app/main.py`
- `backend/tests/test_llm_training_runner.py`

### 完成标准

- preparing / training / exporting / registering 这些中间态任务，在启动时会被扫出来
- 会标记为失败，并给出中文原因
- 已终态任务不受影响

### 可直接复制的提示词

```text
请处理 T5：启动时恢复中断任务。

前置假设：
- T3 已把真实训练 runner 接入

先读取：
1. docs/PROJECT_CONTEXT.md
2. specs/M1_LLM_TRAINING.md
3. docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md
4. backend/app/services/llm_training.py
5. backend/app/main.py
6. backend/tests/test_llm_training_runner.py

任务目标：
- 在训练服务里增加 `recover_interrupted_jobs()`
- 应用启动时调用它
- 把卡在 `preparing / training / exporting / registering` 的任务统一标记为失败
- 给出中文失败原因，说明上次训练被中断

实现边界：
- 不做模型注册
- 不改训练执行逻辑本身
- 只做恢复与收尾

验证要求：
- 增加对应测试
- 运行恢复相关测试，证明重启后不会遗留“永远进行中”的任务

输出要求：
- 用中文告诉我哪些状态会被恢复
- 说明启动时恢复的具体行为
```

---

## T6 线程提示词

### 线程定位

- 任务名：**T6 前端基础模型选择 + 更丰富的训练进度展示**
- 是否可并行：**可与 T1 并行**
- 前置：建议 T1 先给出模型口径；若未完成，先按已知兼容模型最小接法做
- 交付给：T3 / T4 后的用户可用路径

### 本线程边界

- 只改前端训练页
- 不改后端训练执行器
- 不做 worker
- 不做恢复逻辑

### 目标

- 让用户在训练前明确选择基础模型
- 把已有的 `baseModel` 请求字段真正接上
- 让训练中的 loss / step / ETA / 注册待处理状态更清楚

### 重点文件

- `src/components/LLMTrainingPanel.tsx`
- `src/components/LLMTrainingPanel.test.tsx`
- 如有需要：`src/api/llmTraining.ts`
- 可参考：
  - `src/components/ModelLibraryPanel.tsx`
  - `src/api/llmPreferences.ts`

### 完成标准

- 训练页可以选基础模型
- 默认值遵循角色默认模型，前提是该模型支持训练
- 训练记录展示更完整
- 页面测试覆盖新增行为

### 可直接复制的提示词

```text
请处理 T6：前端训练页增强（基础模型选择 + 更丰富进度展示）。

前置说明：
- 这个任务可以和 T1 并行
- 如果 T1 还没落地完整模型映射，先按当前已知训练兼容模型做最小接法，但命名和口径要预留与 T1 对齐

先读取：
1. docs/PROJECT_CONTEXT.md
2. specs/M1_LLM_TRAINING.md
3. docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md
4. src/components/LLMTrainingPanel.tsx
5. src/components/LLMTrainingPanel.test.tsx
6. src/components/ModelLibraryPanel.tsx
7. src/api/llmTraining.ts
8. src/api/llmPreferences.ts

任务目标：
- 在训练页面增加基础模型下拉选择
- 真正把 `StartTrainingPayload.baseModel` 接上
- 默认优先使用角色默认基础模型；如果该模型不支持训练，则回退到训练默认模型
- 在训练中的卡片里更清楚展示：
  - 当前 step
  - 总步数
  - loss
  - ETA
  - 如果后端后续返回“注册待重试”相关提示，也要有位置显示

实现边界：
- 不改后端执行器
- 不增加新的页面
- 不顺手重构整个 LLMWorkspace

验证要求：
- 运行 `npm run test:run -- src/components/LLMTrainingPanel.test.tsx`
- 如改到其他相关测试，也一起跑

输出要求：
- 用中文告诉我训练页现在多了哪些用户可见能力
- 说明 baseModel 字段现在是不是已经真正发出去了
```

---

## 四、给你的一句话调度建议

如果你要最稳地开新线程，我建议按这个顺序：

1. **先开 T0**
2. **T0 完成后，同时开 T1 和 T6**
3. **等 T1 完成后，再开 T2**
4. **T2 完成后开 T3**
5. **T3 完成后，同时开 T4 和 T5**

这样安排的好处是：

- 前后端不会互相等太久
- 真正有高耦合的地方只保留在 `T1 -> T2 -> T3`
- 后面的注册和恢复可以分开做，不容易冲突
