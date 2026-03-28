# M1E Minimal Retrain Step Delta Contract Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one backward-compatible optional field on `POST /api/training/start` so the frontend can request same-mode "increase steps and retrain" (especially for `fine`) without changing training mode.

**Architecture:** Keep the existing training contract and status model unchanged. Extend request schema with optional `retrainStepDelta`, apply it only in retrain flow, and reuse existing `requestedSteps` / `effectiveSteps` response fields and `config` structure. No DB migration is needed because step fields already exist.

**Tech Stack:** FastAPI + Pydantic, Python service layer, SQLite (existing schema), React + TypeScript API client/panel, pytest + vitest.

---

### Task 1: Add backend failing tests for new optional field behavior

**Files:**
- Modify: `backend/tests/test_training_api.py`
- Modify: `backend/tests/test_training_api_mock_contract.py`

- [ ] **Step 1: Write failing tests for backward compatibility and new delta path**

```python
# in backend/tests/test_training_api.py

def test_training_start_keeps_old_behavior_without_retrain_step_delta(...):
    ...
    assert created["requestedSteps"] == 1800
    assert created["effectiveSteps"] == 1800


def test_training_start_allows_same_mode_retrain_with_step_delta(...):
    ...
    first = client.post("/api/training/start", json={"characterId": character["id"], "mode": "fine", "baseModel": "sdxl"}).json()
    retrain = client.post(
        "/api/training/start",
        json={
            "characterId": character["id"],
            "mode": "fine",
            "baseModel": "sdxl",
            "retrainOfTaskId": first["id"],
            "retrainStepDelta": 600,
        },
    )
    assert retrain.status_code == 202
    payload = retrain.json()
    assert payload["requestedMode"] == "fine"
    assert payload["requestedSteps"] == 3400


def test_training_start_rejects_invalid_retrain_step_delta_with_cn_message(...):
    ...
    response = client.post(..., json={..., "retrainStepDelta": 0})
    assert response.status_code == 400
    assert response.json()["detail"] == "重训步数增量必须是大于 0 的整数。"


def test_training_start_rejects_step_delta_without_retrain_source(...):
    ...
    assert response.json()["detail"] == "仅在重训任务中允许设置重训步数增量，请提供重训来源任务。"


def test_training_start_rejects_step_delta_when_mode_changes(...):
    ...
    assert response.json()["detail"] == "增加步数重训时，训练模式必须与来源任务一致。"
```

- [ ] **Step 2: Run backend target tests to verify failure first**

Run: `pytest -q backend/tests/test_training_api.py backend/tests/test_training_api_mock_contract.py`
Expected: FAIL on missing `retrainStepDelta` handling.

- [ ] **Step 3: Keep mock contract compatibility assertions untouched**

```python
# existing mock tests remain valid with no request changes
# no new required field in mock payloads
```

- [ ] **Step 4: Re-run to confirm only new behavior is failing**

Run: `pytest -q backend/tests/test_training_api.py backend/tests/test_training_api_mock_contract.py`
Expected: Existing mock contract tests still pass; only new delta tests fail.

### Task 2: Implement minimal backend contract patch

**Files:**
- Modify: `backend/app/api/training.py`
- Modify: `backend/app/services/training.py`

- [ ] **Step 1: Extend request schema with optional alias field**

```python
# in TrainingStartRequest
retrain_step_delta: int | None = Field(default=None, alias="retrainStepDelta")
```

- [ ] **Step 2: Extend service payload dataclass and wiring**

```python
# in TrainingStartPayload
retrain_step_delta: int | None = None

# when creating TrainingStartPayload in API route
retrain_step_delta=payload.retrain_step_delta,
```

- [ ] **Step 3: Add deterministic validation rules and step calculation**

```python
# in start_training
if payload.retrain_step_delta is not None and payload.retrain_step_delta <= 0:
    raise TrainingValidationError("重训步数增量必须是大于 0 的整数。")

if payload.retrain_step_delta is not None and payload.retrain_of_task_id is None:
    raise TrainingValidationError("仅在重训任务中允许设置重训步数增量，请提供重训来源任务。")

# load retrain source if retrain_of_task_id provided
# if delta provided, enforce mode equality with source requested_mode

requested_steps = requested_preset["steps"] + (payload.retrain_step_delta or 0)
effective_steps = effective_preset["steps"] + (payload.retrain_step_delta or 0)
```

- [ ] **Step 4: Persist and expose steps via existing fields only**

```python
# INSERT keeps using requested_steps/effective_steps columns
# response continues using requestedSteps/effectiveSteps
# optional metadata may be added inside config without schema break
```

- [ ] **Step 5: Run backend tests and verify pass**

Run: `pytest -q backend/tests/test_training_api.py backend/tests/test_training_api_mock_contract.py`
Expected: PASS.

### Task 3: Add frontend payload support and panel behavior for same-mode retrain

**Files:**
- Modify: `src/api/training.ts`
- Modify: `src/api/training.test.ts`
- Modify: `src/components/TrainingProgressPanel.tsx`
- Modify: `src/App.test.tsx` (only if needed for behavior regression)

- [ ] **Step 1: Add optional field in start payload type**

```ts
export type StartTrainingPayload = {
  characterId: string;
  mode: TrainingMode;
  baseModel?: TrainingModel;
  confirmFluxDevLicense?: boolean;
  retrainOfTaskId?: string;
  retrainStepDelta?: number;
};
```

- [ ] **Step 2: Add API unit test proving payload serialization is backward-compatible**

```ts
const item = await startTraining({
  characterId: "char-1",
  mode: "fine",
  retrainOfTaskId: "task-1",
  retrainStepDelta: 600,
});
expect(fetchMock).toHaveBeenCalledWith(... JSON.stringify({ ..., retrainStepDelta: 600 }))
```

- [ ] **Step 3: Update panel retrain-with-more-steps flow to keep same mode**

```ts
await startTraining({
  characterId: character.id,
  mode: currentTask.requestedMode,
  baseModel: currentTask.requestedModel,
  retrainOfTaskId: currentTask.id,
  retrainStepDelta: 600,
});
```

- [ ] **Step 4: Keep user-visible Chinese text and remove obsolete blocker path**

```ts
setActionFeedback("已创建同模式增步重训任务，正在排队。");
```

- [ ] **Step 5: Run frontend tests for touched files**

Run: `npm run test:run -- src/api/training.test.ts src/App.test.tsx`
Expected: PASS.

### Task 4: Full verification and regression check

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `pytest -q backend/tests`
Expected: PASS with no regression in existing training mock contract tests.

- [ ] **Step 2: Run full frontend test suite**

Run: `npm run test:run`
Expected: PASS with no regression in training flow tests.

- [ ] **Step 3: Run build check**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Capture final contract evidence**

```text
- old request (no retrainStepDelta) unchanged
- new request with retrainStepDelta creates task
- fine mode same-mode retrain with increased steps works
- invalid values return Chinese error
```
