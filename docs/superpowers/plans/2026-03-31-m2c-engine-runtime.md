# M2-C 图像引擎运行层 — 实现计划

**文档路径**: `docs/superpowers/plans/2026-03-31-m2c-engine-runtime.md`
**分支**: `codex/m2c-engine-runtime`
**基线**: `codex/m2a-generation`（已含 M2-B 26 个后端测试 + 14 个前端测试）
**预期工时**: 2–3 天

---

## 1. 范围边界

M2-C 只负责图像引擎（ComfyUI）的进程生命周期管理：

- 按需启动 / 优雅停止
- HTTP 健康检查（轮询 `http://127.0.0.1:8188/`）
- 崩溃检测 + 自动重启，最多 3 次
- 第 3 次重启失败后进入 `failed` 终态，向前端报告中文错误
- GPU 互斥：若 `task_queue` 中存在 `running` 状态的训练任务，阻止启动
- 状态机：`stopped → starting → running → crashed → restarting → failed`

**不在范围内**：ComfyUI 工作流调用（M2-D/E）、Prompt 组装、图片归档、diffusers fallback（M2-I）。

---

## 2. 新增文件清单

```
backend/app/schemas/engine.py
backend/app/services/engine_runtime.py
backend/app/api/engine.py
backend/tests/test_engine_runtime.py
backend/tests/test_engine_api.py
src/api/engine.ts
src/api/engine.test.ts
src/components/EngineStatusBadge.tsx
src/components/EngineStatusBadge.test.tsx
```

## 3. 修改文件清单

```
backend/app/main.py  — 注册 engine router，初始化 ComfyUIRuntime 并挂到 app.state
```

---

## 4. 实现步骤（TDD 顺序）

### 阶段一：Pydantic Schemas

- [ ] **Step 1** — 创建 `backend/app/schemas/engine.py`

  定义以下模型：

  ```python
  EngineState = Literal[
      "stopped", "starting", "running", "crashed", "restarting", "failed"
  ]

  class EngineStatus(BaseModel):
      state: EngineState
      restart_count: int = Field(alias="restartCount")
      error_message: str | None = Field(default=None, alias="errorMessage")
      pid: int | None = None

  class EngineStartResponse(BaseModel):
      status: EngineStatus
      message: str

  class EngineStopResponse(BaseModel):
      status: EngineStatus
      message: str
  ```

### 阶段二：进程抽象接口

- [ ] **Step 2** — 在 `backend/app/services/engine_runtime.py` 定义可注入的进程启动器协议 `ProcessLauncher` + `DefaultProcessLauncher`，命令默认为 `["python", "ComfyUI/main.py", "--listen", "127.0.0.1", "--port", "8188", "--headless"]`。

### 阶段三：服务层状态机

- [ ] **Step 3** — 实现 `ComfyUIRuntime` 类，核心属性：

  ```python
  class ComfyUIRuntime:
      MAX_RESTARTS: int = 3
      HEALTH_CHECK_URL: str = "http://127.0.0.1:8188/"
      HEALTH_CHECK_TIMEOUT_S: float = 2.0
      HEALTH_POLL_INTERVAL_S: float = 1.0
      STARTUP_TIMEOUT_S: float = 30.0
      BACKOFF_BASE_S: float = 2.0

      def __init__(
          self,
          task_queue: TaskQueue,
          launcher: ProcessLauncher | None = None,
          comfyui_cmd: list[str] | None = None,
          http_client: httpx.AsyncClient | None = None,
      ) -> None: ...
  ```

- [ ] **Step 4** — 实现 `start()` 方法（`async`）：GPU 互斥检查 → 状态转 `starting` → launch → 启动 `_monitor_loop`

- [ ] **Step 5** — 实现 `stop()` 方法（`async`）：取消监控协程 → terminate 进程（超时则 kill）→ 状态转 `stopped`

- [ ] **Step 6** — 实现 `_monitor_loop()` 协程：等待健康检查通过（超时 → crash）→ 运行时持续 ping（失败 3 次或进程退出 → crash）

- [ ] **Step 7** — 实现 `_handle_crash()` 方法：`restart_count++` → 超限则 `failed` + 中文错误 → 否则 `restarting` + 指数退避 + 重启

- [ ] **Step 8** — 实现 `get_status()` 方法（同步）

  GPU 互斥判断：`task.name.startswith("training-") and task.status == "running"`（常量 `TRAINING_TASK_PREFIX = "training-"`）

### 阶段四：后端测试（先写测试）

- [ ] **Step 9** — 创建 `backend/tests/test_engine_runtime.py`

  使用 `FakeProcessLauncher` + `FakeProcess` + `FakeHttpClient` 注入，时间常量全部传 `0.001`：

  - `test_initial_state_is_stopped`
  - `test_start_transitions_to_starting_then_running`
  - `test_start_is_idempotent_when_running`
  - `test_stop_from_running_transitions_to_stopped`
  - `test_crash_triggers_restart`
  - `test_three_crashes_reach_failed_state`
  - `test_gpu_mutex_blocks_start_when_training_is_running`
  - `test_gpu_mutex_allows_start_when_training_is_not_running`
  - `test_failed_state_blocks_restart_attempt`

- [ ] **Step 10** — 创建 `backend/tests/test_engine_api.py`

  mock `app.state.engine_runtime`：

  - `test_get_engine_status_returns_stopped_by_default`
  - `test_post_engine_start_returns_202_and_starting_state`
  - `test_post_engine_start_blocked_by_gpu_mutex_returns_409`
  - `test_post_engine_stop_returns_200`
  - `test_get_engine_status_reflects_failed_state_with_chinese_message`
  - `test_engine_endpoints_return_503_when_runtime_not_initialized`

### 阶段五：API 路由层

- [ ] **Step 11** — 创建 `backend/app/api/engine.py`

  ```python
  @router.post("/engine/start", response_model=EngineStartResponse, status_code=202)
  @router.post("/engine/stop", response_model=EngineStopResponse, status_code=200)
  @router.get("/engine/status", response_model=EngineStatus)
  ```

  `EngineGpuMutexError` → 409 + 中文 detail；其他异常 → 500 + 中文 detail

### 阶段六：注册到 main.py

- [ ] **Step 12** — `backend/app/main.py`：lifespan 中初始化 `ComfyUIRuntime(task_queue=task_queue)` → 挂到 `app.state.engine_runtime`；lifespan 退出时 `await engine_runtime.stop()`；注册 `engine_router`

### 阶段七：前端 API 客户端

- [ ] **Step 13** — 创建 `src/api/engine.ts`（纯 `fetch`，含类型守卫，透传中文 detail）

  ```typescript
  export type EngineState = "stopped"|"starting"|"running"|"crashed"|"restarting"|"failed";
  export type EngineStatus = { state: EngineState; restartCount: number; errorMessage: string|null; pid: number|null; };
  export async function fetchEngineStatus(signal?: AbortSignal): Promise<EngineStatus>
  export async function startEngine(signal?: AbortSignal): Promise<EngineStartResponse>
  export async function stopEngine(signal?: AbortSignal): Promise<EngineStopResponse>
  ```

- [ ] **Step 14** — 创建 `src/api/engine.test.ts`（`vi.stubGlobal("fetch", ...)` 模式，6 个用例）

### 阶段八：前端状态展示组件

- [ ] **Step 15** — 创建 `src/components/EngineStatusBadge.tsx`

  | state      | 显示文本             | 样式 |
  |------------|-------------------|------|
  | stopped    | 图像引擎未启动          | 灰色 |
  | starting   | 图像引擎启动中…         | 蓝色 |
  | running    | 图像引擎运行中          | 绿色 |
  | crashed    | 图像引擎崩溃，重启中      | 橙色 |
  | restarting | 图像引擎重启中…         | 橙色 |
  | failed     | 图像引擎启动失败         | 红色 |

  - `stopped`/`failed`：显示"启动图像引擎"按钮
  - `running`：显示"停止图像引擎"按钮
  - 过渡状态：按钮禁用
  - `failed` 时展示 `errorMessage`（红色小字）
  - 轮询间隔 `pollIntervalMs`（默认 5000ms）

- [ ] **Step 16** — 创建 `src/components/EngineStatusBadge.test.tsx`（6 个用例，`vi.stubGlobal` + RTL）

---

## 5. 依赖顺序图

```
Step 1 (schemas)
    └─ Step 2-8 (service layer)
        └─ Step 9 (service tests)
        └─ Step 11 (API router)
            └─ Step 10 (API tests)
            └─ Step 12 (main.py)

Step 13 (frontend API client)
    └─ Step 14 (frontend API tests)
    └─ Step 15 (EngineStatusBadge)
        └─ Step 16 (component tests)
```

---

## 6. 关键设计决策

| 决策 | 理由 |
|------|------|
| 进程通过构造函数注入 | Mac 无 ComfyUI，测试必须绕过真实子进程 |
| 启动返回 202（fire-and-forget） | ComfyUI 启动可能需数十秒，避免 HTTP 超时 |
| GPU 互斥通过任务名称前缀匹配 | task_queue 无类型字段，`training-` 前缀是唯一约定 |
| 不修改 task_queue 服务 | M2-C 只读取队列，不影响现有 26 个后端测试 |
| 时间常量全部可注入 | 让异步状态机测试快速完成，不依赖真实 sleep |

---

## 7. 错误文案

- GPU 互斥：`"训练任务正在运行中，无法启动图像引擎，请等待训练完成后再试"`
- 3 次崩溃：`"图像引擎多次崩溃后仍无法恢复，请检查 GPU 驱动是否正常"`
- 服务未初始化：`"图像引擎服务尚未初始化，请稍后重试"`
- 意外错误：`"图像引擎操作失败，请稍后重试"`

---

## 8. 验收检查清单

- [ ] 26 个原有后端测试继续通过
- [ ] 14 个原有前端测试继续通过
- [ ] `test_engine_runtime.py` 9 个用例通过
- [ ] `test_engine_api.py` 6 个用例通过
- [ ] `engine.test.ts` 6 个用例通过
- [ ] `EngineStatusBadge.test.tsx` 6 个用例通过
- [ ] `GET /api/engine/status` 返回 `{"state": "stopped", ...}`
- [ ] `POST /api/engine/start` GPU 冲突时返回 409 + 中文 detail
- [ ] `POST /api/engine/start` 无冲突时返回 202，状态变为 `starting`
- [ ] lifespan 退出时 `stop()` 不抛异常

---

## 9. 执行风险

| 风险 | 缓解 |
|------|------|
| `_monitor_loop` 异步定时逻辑测试难以控制 | 所有时间常量通过构造函数暴露，测试传 0.001 |
| `asyncio.create_task` 在同步 TestClient 中行为不确定 | service 层用 `pytest-asyncio`；API 层 mock runtime 方法不触发真实协程 |
| GPU 互斥命名约定与 M1 实际不符 | 提取为常量 `TRAINING_TASK_PREFIX`，一处修改即可 |
