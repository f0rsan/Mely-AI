# M1E Training Contract Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable M1 training backend contract layer that can create training jobs, run VRAM precheck, apply deterministic downgrade, enqueue into M0 task queue, and expose reusable status APIs for M1F.

**Architecture:** Keep real training execution out of scope. Add a dedicated `training_jobs` persistence layer plus a `training` service that owns config generation, VRAM/license guards, business-status mapping, and queue handoff. Expose REST endpoints under `/api/training/*` and sync minimal training snapshot into `visual_assets` for character detail reuse.

**Tech Stack:** FastAPI, Pydantic v2, SQLite migrations, existing `TaskQueue` service, pytest + TestClient

---

### Task 1: Lock RED Baseline for M1E Contract Tests

**Files:**
- Modify: `backend/tests/test_training_api.py`
- Test: `backend/tests/test_training_api.py`

- [ ] **Step 1: Ensure failing test coverage matches M1E contract**

```python
def test_training_start_creates_contract_and_applies_flux_vram_downgrade(...):
    ...
    assert created["requestedModel"] == "flux-schnell"
    assert created["effectiveModel"] == "sdxl"
```

- [ ] **Step 2: Run test to verify it fails before implementation**

Run: `pytest -q backend/tests/test_training_api.py`  
Expected: FAIL with missing route/service behavior (typically 404 or schema mismatch)

- [ ] **Step 3: Capture failing reasons to guide implementation scope**

```text
Missing endpoints:
- POST /api/training/start
- GET /api/training/tasks/{training_task_id}
```


### Task 2: Add Persistent Training Job Schema

**Files:**
- Modify: `backend/migrations/0003_training_jobs.sql`
- Test: `backend/tests/test_training_api.py`

- [ ] **Step 1: Finalize `training_jobs` table for M1 contract fields**

```sql
CREATE TABLE IF NOT EXISTS training_jobs (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  queue_task_id TEXT NOT NULL UNIQUE,
  requested_mode TEXT NOT NULL,
  effective_mode TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  effective_model TEXT NOT NULL,
  precheck_result TEXT NOT NULL,
  downgrade_reasons TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL,
  business_status TEXT NOT NULL,
  queue_status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL,
  user_visible_error TEXT,
  sample_previews TEXT NOT NULL DEFAULT '[]',
  validation_images TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: Keep index coverage for character history and status queries**

```sql
CREATE INDEX IF NOT EXISTS idx_training_jobs_character_created
ON training_jobs(character_id, created_at DESC);
```

- [ ] **Step 3: Run tests to keep RED state (service still missing)**

Run: `pytest -q backend/tests/test_training_api.py`  
Expected: still FAIL, but without migration errors


### Task 3: Implement Training Domain Service (Config + Precheck + Downgrade + Queue Bridge)

**Files:**
- Create: `backend/app/services/training.py`
- Modify: `backend/app/services/characters.py`
- Test: `backend/tests/test_training_api.py`

- [ ] **Step 1: Write service-level contract functions and enums**

```python
TrainingBusinessStatus = Literal[
    "draft", "queued", "preparing", "training", "sampling",
    "validating", "completed", "failed", "canceled",
]
```

- [ ] **Step 2: Implement VRAM precheck + deterministic downgrade**

```python
def resolve_effective_model_and_mode(requested_mode: str, requested_model: str, vram_gb: float):
    if requested_mode == "fine" and vram_gb < 12:
        effective_mode = "standard"
        downgrade_reasons.append({"code": "mode_vram_guard", ...})
    if requested_model in {"flux-schnell", "flux-dev"} and vram_gb < 24:
        effective_model = "sdxl"
        downgrade_reasons.append({"code": "flux_vram_guard", ...})
```

- [ ] **Step 3: Enforce `flux-dev` license confirmation guard**

```python
if requested_model == "flux-dev" and not license_confirmed:
    raise TrainingValidationError("flux-dev 存在非商用许可风险，继续前请先确认许可。")
```

- [ ] **Step 4: Generate training config payload for downstream executor**

```python
config = {
  "mode": effective_mode,
  "baseModel": effective_model,
  "steps": effective_steps,
  "rank": effective_rank,
  "strategyDefaultModel": "flux-schnell",
  "runtimeDefaultModel": "sdxl",
}
if effective_model == "flux-schnell":
  config["schnellTrainingAdapter"] = "ostris/FLUX.1-schnell-training-adapter"
```

- [ ] **Step 5: Create `training_jobs` row + sync `visual_assets` snapshot**

```python
UPDATE visual_assets
SET training_config = ?, training_status = ?, training_progress = ?
WHERE character_id = ?
```

- [ ] **Step 6: Submit placeholder runner into existing `TaskQueue`**

```python
async def placeholder_runner(progress):
    await progress(5, "训练任务已入队，等待执行器接管")
    raise RuntimeError("训练任务已通过预检并入队，但当前环境未接入真实训练执行器。")
```

- [ ] **Step 7: Implement task-state refresh from queue snapshot**

```python
if queue_task.status == "pending":
    business_status = "queued"
elif queue_task.status == "running":
    business_status = "preparing"
elif queue_task.status == "failed":
    business_status = "failed"
```

- [ ] **Step 8: Run focused tests**

Run: `pytest -q backend/tests/test_training_api.py`  
Expected: major behavior now passes, remaining mismatches become explicit


### Task 4: Add Training API Endpoints and Request/Response Schemas

**Files:**
- Create: `backend/app/api/training.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_training_api.py`

- [ ] **Step 1: Add start endpoint**

```python
@router.post("/training/start", status_code=202)
async def start_training(payload: TrainingStartRequest, request: Request) -> TrainingTaskResponse:
    ...
```

- [ ] **Step 2: Add detail endpoint for downstream poller**

```python
@router.get("/training/tasks/{training_task_id}")
async def get_training_task(training_task_id: str, request: Request) -> TrainingTaskResponse:
    ...
```

- [ ] **Step 3: Wire router into app**

```python
from app.api.training import router as training_router
app.include_router(training_router, prefix="/api")
```

- [ ] **Step 4: Keep all user-visible errors in Chinese natural language**

```python
raise HTTPException(status_code=404, detail="角色不存在")
```

- [ ] **Step 5: Run endpoint tests**

Run: `pytest -q backend/tests/test_training_api.py`  
Expected: PASS


### Task 5: Full Regression Verification for M0 + M1E

**Files:**
- Test: `backend/tests/test_training_api.py`
- Test: `backend/tests`

- [ ] **Step 1: Run targeted M1E tests**

Run: `pytest -q backend/tests/test_training_api.py`  
Expected: all PASS

- [ ] **Step 2: Run backend full suite to prevent regressions**

Run: `pytest -q backend/tests`  
Expected: all PASS, no regressions on characters/tasks/downloads

- [ ] **Step 3: Record verification evidence for handoff**

```text
Training contract verified:
- start endpoint creates queued job
- deterministic downgrade recorded
- queue bridge alive
- placeholder executor fails with explicit Chinese message
```

