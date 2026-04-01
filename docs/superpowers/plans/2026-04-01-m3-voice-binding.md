# M3 声音绑定 — 完整实施计划

> 规划日期：2026-04-01  
> 模型：Claude Opus 4.6  
> 前置完成：M0 基础层 / M1 视觉训练 / M2 生成工作台

---

## 1. SQLite Schema 变更

`voice_assets` 表已在 `0001_initial_schema.sql` 中创建，新增迁移扩展字段。

### `backend/migrations/0005_voice_assets_extend.sql`

```sql
-- M3: extend voice_assets with extraction status and metadata
ALTER TABLE voice_assets ADD COLUMN reference_audio_duration REAL;
ALTER TABLE voice_assets ADD COLUMN reference_audio_format TEXT;
ALTER TABLE voice_assets ADD COLUMN bound_at TEXT;
ALTER TABLE voice_assets ADD COLUMN status TEXT NOT NULL DEFAULT 'unbound';
-- status: unbound / extracting / bound / failed

CREATE INDEX IF NOT EXISTS idx_voice_assets_status ON voice_assets(status);
```

**音频归档：** `generations` 表已有 `type TEXT NOT NULL`，直接使用 `type='audio'`，
`params_snapshot` JSON 存储：`{"text": "...", "language": "zh", "speed": 1.0, "ttsEngine": "f5-tts", "sampleRate": 24000}`。
`costume_id` 使用角色默认造型 ID（现有约束最小改动）。

---

## 2. Worktree 叶节点划分

```
M3-A (engine) ──→ M3-B (api) ──→ M3-D (bind UI) ──→ M3-E (tts UI) ──→ M3-F (integration)
M3-C (download)  ──→ M3-B (api)
```

| 叶节点 | 分支名 | 内容 | 依赖 |
|--------|--------|------|------|
| M3-A | `codex/m3a-voice-engine` | TTSRuntime 状态机 | 无 |
| M3-B | `codex/m3b-voice-api` | /api/voice/* 全部端点 + VoiceService | M3-A |
| M3-C | `codex/m3c-voice-download` | model_registry F5-TTS 条目 | 无 |
| M3-D | `codex/m3d-voice-bind-ui` | VoiceBindPanel + src/api/voice.ts | M3-B |
| M3-E | `codex/m3e-tts-generate-ui` | TTSGeneratePanel + AudioHistoryGallery | M3-B、M3-D |
| M3-F | `codex/m3f-voice-integration` | 集成测试 | M3-A~E |

M3-A 和 M3-C 可并行开发。

---

## 3. M3-A：TTSRuntime 详细设计

### 复用 ComfyUIRuntime 模式

| 维度 | ComfyUIRuntime | TTSRuntime |
|------|---------------|------------|
| 默认端口 | 127.0.0.1:8188 | 127.0.0.1:8189 |
| 健康检查 | GET / | GET /health |
| 启动命令 | python ComfyUI/main.py | python -m f5_tts.serve --port 8189 |
| GPU 互斥前缀 | training-* | training-* + generation-* + tts-* |
| 启动超时 | 30s | 60s（F5-TTS 加载慢）|

### 统一 GPU 互斥（新文件）

```python
# backend/app/services/gpu_mutex.py
GPU_EXCLUSIVE_PREFIXES = ("training-", "generation-", "tts-")

def check_gpu_exclusive(task_queue: TaskQueue) -> None:
    """Raise EngineGpuMutexError if any GPU-exclusive task is running."""
    for task in task_queue.list():
        if task.status == "running" and any(
            task.name.startswith(p) for p in GPU_EXCLUSIVE_PREFIXES
        ):
            raise EngineGpuMutexError("GPU 正被其他任务占用，请等待当前任务完成后再试")
```

`ComfyUIRuntime` 和 `TTSRuntime` 都改为调用 `check_gpu_exclusive()`。

### TTSRuntime 类签名

```python
class TTSRuntime:
    MAX_RESTARTS = 3
    HEALTH_CHECK_URL = "http://127.0.0.1:8189/health"
    HEALTH_CHECK_TIMEOUT_S = 2.0
    HEALTH_POLL_INTERVAL_S = 1.0
    STARTUP_TIMEOUT_S = 60.0
    BACKOFF_BASE_S = 2.0
    PING_FAILURE_THRESHOLD = 3

    def __init__(self, task_queue, launcher=None, tts_cmd=None, http_client=None): ...
    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    def get_status(self) -> TTSEngineStatus: ...
```

---

## 4. M3-B：Voice API 端点

### 端点清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/voice/upload-reference | 上传参考音频（multipart） → 返回 duration、status=extracting |
| POST | /api/voice/extract-voiceprint | 提交声纹提取任务 → 返回 taskId |
| POST | /api/voice/synthesize | TTS 合成 → 返回 taskId（异步） |
| GET | /api/voice/{character_id}/status | 查询绑定状态 |
| GET | /api/voice/engine/status | TTS 引擎状态 |
| POST | /api/voice/engine/start | 启动 TTS 引擎 |
| POST | /api/voice/engine/stop | 停止 TTS 引擎 |
| GET | /api/generations/{id}/audio | 获取音频文件流 |

### 关键 Pydantic Schema

```python
# backend/app/schemas/voice.py

class VoiceUploadResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    character_id: str = Field(alias="characterId")
    reference_audio_path: str = Field(alias="referenceAudioPath")
    duration_seconds: float = Field(alias="durationSeconds")
    audio_format: str = Field(alias="audioFormat")
    status: str  # "extracting"
    message: str

class VoiceStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    character_id: str = Field(alias="characterId")
    has_reference: bool = Field(alias="hasReference")
    status: str  # unbound / extracting / bound / failed
    reference_audio_path: str | None = Field(default=None, alias="referenceAudioPath")
    duration_seconds: float | None = Field(default=None, alias="durationSeconds")
    tts_engine: str | None = Field(default=None, alias="ttsEngine")
    bound_at: str | None = Field(default=None, alias="boundAt")

class TTSSynthesizeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    character_id: str = Field(alias="characterId")
    text: str = Field(min_length=1, max_length=500)
    language: str = Field(default="zh")  # zh / en / zh-en
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    output_format: str = Field(default="wav", alias="outputFormat")
```

### 关键业务逻辑

- `upload-reference`：验证角色存在 → 验证格式（wav/mp3/flac/m4a/ogg）→ 验证时长（3–30 秒）→ ffmpeg 转换为 WAV 16kHz mono → 写入 `~/.mely/characters/{id}/voice/reference.wav` → 提交声纹提取任务
- `synthesize`：检查 status='bound' → `check_gpu_exclusive()` → 确认 TTSRuntime running → 提交 `tts-{char_id}` 任务 → 完成后自动写 generations 表 (type='audio')
- 音频文件服务 `/api/generations/{id}/audio`：与 `/api/generations/{id}/image` 完全对称，路径校验相同，media_type="audio/wav"

---

## 5. M3-C：模型下载注册

```json
{
  "id": "f5-tts-base",
  "name": "F5-TTS 基础模型（语音克隆）",
  "url": "https://huggingface.co/SWivid/F5-TTS/resolve/main/F5TTS_Base/model_1200000.safetensors",
  "size": 1340000000,
  "sha256": "",
  "relativePath": "tts/f5-tts-base/model_1200000.safetensors"
}
```

声音 tab 首次进入时检测模型文件，不存在则显示"下载引导 UI"而非报错。

---

## 6. M3-D：声音绑定 UI

### 状态机

```typescript
type VoiceBindState =
  | { kind: "loading" }
  | { kind: "unbound" }
  | { kind: "uploading"; progress: number }
  | { kind: "extracting"; taskId: string }
  | { kind: "preview"; audioUrl: string }
  | { kind: "testing"; text: string }
  | { kind: "bound"; boundAt: string }
  | { kind: "error"; message: string };
```

### 组件层次

```
VoiceBindPanel
├── TTSEngineStatusBadge   （复用 EngineStatusBadge 模式）
├── VoiceStatusCard        （绑定状态展示）
├── AudioUploader          （拖拽/文件选择）
├── AudioWaveform          （canvas 波形预览）
├── VoicePreviewPlayer     （试听播放器）
└── BindConfirmButton      （确认绑定）
```

### App.tsx 集成

```typescript
type DetailTab = "dataset" | "textToCharacter" | "dna" | "training" | "generation" | "voice";

// tab 按钮 + 条件渲染 VoiceBindPanel，与 generation tab 完全对称
```

---

## 7. M3-E：TTS 生成 UI

### 状态机

```typescript
type TTSGenerateState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "generating"; taskId: string; progress: number }
  | { kind: "done"; audioUrl: string; generationId: string }
  | { kind: "failed"; message: string };
```

### 声音 tab 最终页面结构

```
声音 tab
├── TTSEngineStatusBadge
└── 子 tab: 绑定 | 生成 | 历史
    ├── 绑定: VoiceBindPanel
    ├── 生成: TTSGeneratePanel（文字输入→生成→播放→导出）
    └── 历史: AudioHistoryGallery（复用 GenerationHistoryGallery 模式，type='audio'）
```

---

## 8. 测试策略

| 文件 | 覆盖范围 | Mock 边界 |
|------|---------|----------|
| `test_tts_runtime.py` | 状态机全流程 | FakeProcessLauncher + FakeHttpClient |
| `test_voice_service.py` | upload/extract/synthesize | mock F5-TTS HTTP + 真实 SQLite/FS |
| `test_voice_api.py` | HTTP 层全端点 | TestClient + mock VoiceService |
| `test_gpu_mutex.py` | 统一互斥逻辑 | TaskQueue with fake tasks |
| `test_voice_integration.py` | 完整流程 | FakeProcessLauncher |
| `voice.test.ts` | API 客户端函数 | mock fetch |
| `VoiceBindPanel.test.tsx` | UI 状态流转 | mock api/voice.ts |
| `TTSGeneratePanel.test.tsx` | 生成流 + WebSocket | mock api + MockWebSocket |
| `AudioHistoryGallery.test.tsx` | 列表/播放/导出 | mock fetch |

**原则：** F5-TTS 模型推理永远 mock，不在测试中加载 1.3GB 模型。

---

## 9. 关键风险和缓解

| 风险 | 缓解方案 |
|------|---------|
| F5-TTS 模型 1.3GB 首次下载慢 | 复用 DownloadService 断点续传 + 专门下载引导 UI |
| 无 GPU / VRAM 不足 | TTSRuntime `failed` 状态显示明确提示；不提供 CPU fallback（速度不可用） |
| 音频格式不兼容 | 后端 ffmpeg 统一转换为 WAV 16kHz mono |
| GPU 互斥死锁（ComfyUI + TTS 同时） | 统一 `check_gpu_exclusive()` 函数，所有引擎启动和任务提交前都检查 |
| F5-TTS Python 依赖冲突 | F5-TTS 作为独立子进程运行，通过 HTTP API 通信，不共享 Python 环境 |

---

## 10. main.py 集成

```python
# 新增 imports
from app.services.tts_runtime import TTSRuntime
from app.services.voice_service import create_voice_service
from app.api.voice import router as voice_router

# lifespan 中
tts_runtime = TTSRuntime(task_queue=task_queue)
app.state.tts_runtime = tts_runtime
if bootstrap_state.status == "ok":
    app.state.voice_service = create_voice_service(
        db_path=bootstrap_state.db_path,
        data_root=bootstrap_state.data_root,
        queue=task_queue,
        tts_runtime=tts_runtime,
    )

# finally 中
await tts_runtime.stop()

# 路由注册
app.include_router(voice_router, prefix="/api")
```

---

## 11. 实施顺序

| 天 | 叶节点 | 输出 |
|----|--------|------|
| D1 | M3-A + M3-C（并行） | TTSRuntime + 统一 GPU 互斥 + 模型注册 |
| D2–D3 | M3-B | Voice API 全部端点 + VoiceService |
| D4–D5 | M3-D + M3-E（并行） | 声音绑定 UI + TTS 生成 UI |
| D6 | M3-F | 集成测试 + 边界修复 |

**总计约 6 工作日，对应 W11–W12。**
