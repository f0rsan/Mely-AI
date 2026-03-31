# M2-B Generation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first M2 leaf slice that defines the generation workbench contract end-to-end: character readiness, default costume/bootstrap, typed request payload, mock generation submission, and a frontend contract shell that later M2 leaves can plug into without changing the user-facing shape.

**Architecture:** Keep this slice contract-first and engine-free. The backend exposes a read-only workbench contract plus a mock submission endpoint backed by the existing task queue, while the frontend renders a detail-page contract panel and listens to existing task updates. This slice does not generate real images or archive files; it fixes the shape of the main chain so M2-C through M2-I can extend it without changing the contract.

**Tech Stack:** Git worktrees, Git branches, Python 3.11+, FastAPI, Pydantic, SQLite, pytest, React 18, TypeScript, Vitest, React Testing Library

---

**Execution topology:** This plan runs in the leaf worktree `.worktrees/m2b-generation-contract` on branch `codex/m2b-generation-contract`, based on the integration branch `codex/m2a-generation`. After verification, merge the leaf branch back into `codex/m2a-generation` with `--ff-only`. Do not merge this leaf directly into `main`.

## File Structure

- `backend/app/schemas/generations.py` — typed backend contract models for workbench loading and mock generation submission.
- `backend/app/services/generation_contract.py` — generation readiness rules, default base costume bootstrap, request validation, and mock job snapshot shaping.
- `backend/app/api/generations.py` — generation contract endpoints.
- `backend/app/main.py` — register the generation router.
- `backend/tests/test_generation_contract_api.py` — backend tests for workbench contract and mock submission.
- `src/api/generations.ts` — typed frontend API client and generation job/task merge helper.
- `src/api/generations.test.ts` — frontend client tests.
- `src/components/GenerationContractPanel.tsx` — detail-page contract shell for M2-B.
- `src/components/GenerationContractPanel.test.tsx` — component tests for ready/blocked/mock-submit behavior.
- `src/App.tsx` — mount the generation contract panel inside the character detail shell.
- `src/App.test.tsx` — update detail-shell test inputs so the new panel has contract data.
- `src/styles.css` — minimal styles for the contract panel.

### Task 0: Prepare the integration and leaf worktrees

**Files:**
- Modify: none

- [ ] **Step 1: Verify the project-local worktree directory exists and is ignored**

Run:

```bash
ls -d .worktrees
git check-ignore -v .worktrees
```

Expected:

```text
.worktrees
.gitignore:...:.worktrees/	.worktrees
```

- [ ] **Step 2: Create the M2 integration worktree if it does not already exist**

Run:

```bash
git branch --list 'codex/m2a-generation'
```

If the output is empty, create the branch and worktree:

```bash
git worktree add .worktrees/m2a-generation -b codex/m2a-generation main
```

If the output already contains `codex/m2a-generation`, attach a worktree to the existing branch instead:

```bash
git worktree add .worktrees/m2a-generation codex/m2a-generation
```

Expected for a new branch:

```text
Preparing worktree (new branch 'codex/m2a-generation')
HEAD is now at ... [M2] Add bus execution design
```

- [ ] **Step 3: Create the M2-B leaf worktree from the integration branch**

Run:

```bash
git worktree add .worktrees/m2b-generation-contract -b codex/m2b-generation-contract codex/m2a-generation
cd .worktrees/m2b-generation-contract
```

Expected:

```text
Preparing worktree (new branch 'codex/m2b-generation-contract')
HEAD is now at ... [M2] Add bus execution design
```

- [ ] **Step 4: Install dependencies in the leaf worktree and verify the baseline**

Run:

```bash
npm install
python -m pip install -e "backend[dev]"
pytest -q backend/tests
npm run test:run
npm run build
```

Expected:

```text
19 passed in ...
...
Test Files  3 passed
...
✓ built in ...
```

### Task 1: Add the backend generation workbench contract read model

**Files:**
- Create: `backend/app/schemas/generations.py`
- Create: `backend/app/services/generation_contract.py`
- Create: `backend/app/api/generations.py`
- Create: `backend/tests/test_generation_contract_api.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the failing backend tests for loading the generation workbench contract**

Create `backend/tests/test_generation_contract_api.py`:

```python
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _ready_character_payload() -> dict:
    return {
        "name": "星野ミカ",
        "dna": {
            "hairColor": "pink",
            "eyeColor": "violet",
            "skinTone": "fair",
            "bodyType": "slim",
            "style": "anime",
            "extraTags": ["vtuber", "smile"],
            "autoPrompt": "pink hair, violet eyes, anime girl",
        },
        "visual": {
            "loraPath": "/tmp/lora/hoshino_mika_v3.safetensors",
            "triggerWord": "hoshino_mika",
            "recommendedWeight": 0.85,
            "baseCheckpoint": "flux-dev",
            "trainingConfig": {"steps": 1600},
            "trainingStatus": "completed",
            "trainingProgress": 1.0,
        },
    }


def test_generation_workbench_contract_returns_defaults_and_creates_base_costume(
    temp_data_root: Path,
) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json=_ready_character_payload())
        character_id = created.json()["id"]

        response = client.get(f"/api/characters/{character_id}/generation-workbench")

    assert response.status_code == 200
    body = response.json()
    assert body["characterId"] == character_id
    assert body["characterName"] == "星野ミカ"
    assert body["canGenerate"] is True
    assert body["blockingReason"] is None
    assert body["selectedCostumeId"]
    assert body["costumes"] == [
        {
            "id": body["selectedCostumeId"],
            "name": "基础造型",
            "costumePrompt": "",
            "isDefault": True,
        }
    ]
    assert body["promptSources"] == {
        "dnaPrompt": "pink hair, violet eyes, anime girl",
        "triggerWord": "hoshino_mika",
        "costumePrompt": "",
    }
    assert body["parameterDefaults"] == {
        "width": 1024,
        "height": 1024,
        "steps": 28,
        "sampler": "DPM++ 2M Karras",
        "cfgScale": 3.5,
        "seed": None,
        "loraWeight": 0.85,
    }
    assert body["tagOptions"] == ["封面图", "表情包", "周边", "预告图"]

    with sqlite3.connect(temp_data_root / "db" / "mely.db") as connection:
        row = connection.execute(
            "SELECT name, costume_prompt FROM costumes WHERE character_id = ?",
            (character_id,),
        ).fetchone()

    assert row == ("基础造型", "")


def test_generation_workbench_contract_blocks_untrained_character(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "未训练角色"})
        character_id = created.json()["id"]

        response = client.get(f"/api/characters/{character_id}/generation-workbench")

    assert response.status_code == 200
    body = response.json()
    assert body["canGenerate"] is False
    assert body["blockingReason"] == "该角色当前还不能生成，请先完成视觉训练。"
    assert body["costumes"][0]["name"] == "基础造型"


def test_generation_workbench_contract_returns_404_for_unknown_character(
    temp_data_root: Path,
) -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.get(
            "/api/characters/11111111-1111-1111-1111-111111111111/generation-workbench"
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "角色不存在"
```

- [ ] **Step 2: Run the new backend tests and verify they fail before implementation**

Run:

```bash
pytest -q backend/tests/test_generation_contract_api.py
```

Expected:

```text
FFF
...
E       assert 404 == 200
```

- [ ] **Step 3: Implement the backend generation workbench contract**

Create `backend/app/schemas/generations.py`:

```python
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GenerationCostumeOption(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    costume_prompt: str = Field(alias="costumePrompt")
    is_default: bool = Field(alias="isDefault")


class GenerationPromptSources(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dna_prompt: str = Field(alias="dnaPrompt")
    trigger_word: str = Field(alias="triggerWord")
    costume_prompt: str = Field(alias="costumePrompt")


class GenerationParameterDefaults(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    width: int = Field(default=1024, ge=256, le=2048)
    height: int = Field(default=1024, ge=256, le=2048)
    steps: int = Field(default=28, ge=1, le=150)
    sampler: str = "DPM++ 2M Karras"
    cfg_scale: float = Field(default=3.5, alias="cfgScale", ge=0.1, le=30.0)
    seed: int | None = None
    lora_weight: float = Field(default=0.85, alias="loraWeight", ge=0.0, le=1.5)


class GenerationWorkbenchContractResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    character_name: str = Field(alias="characterName")
    can_generate: bool = Field(alias="canGenerate")
    blocking_reason: str | None = Field(default=None, alias="blockingReason")
    costumes: list[GenerationCostumeOption]
    selected_costume_id: str = Field(alias="selectedCostumeId")
    prompt_sources: GenerationPromptSources = Field(alias="promptSources")
    parameter_defaults: GenerationParameterDefaults = Field(alias="parameterDefaults")
    tag_options: list[str] = Field(alias="tagOptions")


class GenerationSubmitRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character_id: str = Field(alias="characterId")
    costume_id: str = Field(alias="costumeId")
    scene_prompt: str = Field(alias="scenePrompt")
    negative_prompt: str = Field(default="", alias="negativePrompt")
    width: int = Field(ge=256, le=2048)
    height: int = Field(ge=256, le=2048)
    steps: int = Field(ge=1, le=150)
    sampler: str
    cfg_scale: float = Field(alias="cfgScale", ge=0.1, le=30.0)
    seed: int | None = None
    lora_weight: float = Field(alias="loraWeight", ge=0.0, le=1.5)
    tags: list[str] = Field(default_factory=list)

    @field_validator("scene_prompt")
    @classmethod
    def validate_scene_prompt(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("场景描述不能为空")
        return normalized

    @field_validator("negative_prompt")
    @classmethod
    def normalize_negative_prompt(cls, value: str) -> str:
        return value.strip()

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for item in value:
            trimmed = item.strip()
            if trimmed and trimmed not in normalized:
                normalized.append(trimmed)
        return normalized


class GenerationMockJobSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    task_id: str = Field(alias="taskId")
    character_id: str = Field(alias="characterId")
    costume_id: str = Field(alias="costumeId")
    scene_prompt: str = Field(alias="scenePrompt")
    status: Literal["pending", "running", "completed", "failed"]
    stage: Literal["queued", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    message: str | None = None
    error: str | None = None
    tags: list[str]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class GenerationJobAcceptedResponse(BaseModel):
    job: GenerationMockJobSnapshot
```

Create `backend/app/services/generation_contract.py`:

```python
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.schemas.characters import CharacterDetailResponse
from app.schemas.generations import (
    GenerationCostumeOption,
    GenerationMockJobSnapshot,
    GenerationParameterDefaults,
    GenerationPromptSources,
    GenerationSubmitRequest,
    GenerationWorkbenchContractResponse,
)
from app.services.characters import CharacterNotFoundError, get_character_detail
from app.services.task_queue import TaskSnapshot

DEFAULT_TAG_OPTIONS = ["封面图", "表情包", "周边", "预告图"]
DEFAULT_SAMPLER = "DPM++ 2M Karras"


class GenerationContractValidationError(Exception):
    """Raised when a generation request does not satisfy the contract."""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _fetch_costume_rows(connection: sqlite3.Connection, character_id: str) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT id, name, costume_prompt, created_at
        FROM costumes
        WHERE character_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (character_id,),
    ).fetchall()


def _ensure_base_costume(connection: sqlite3.Connection, character_id: str) -> list[sqlite3.Row]:
    costumes = _fetch_costume_rows(connection, character_id)
    if costumes:
        return costumes

    connection.execute(
        """
        INSERT INTO costumes (id, character_id, name, parent_id, costume_lora, costume_prompt, created_at)
        VALUES (?, ?, ?, NULL, NULL, ?, ?)
        """,
        (str(uuid4()), character_id, "基础造型", "", _utc_now_iso()),
    )
    connection.commit()
    return _fetch_costume_rows(connection, character_id)


def _resolve_readiness(character: CharacterDetailResponse) -> tuple[bool, str | None]:
    visual = character.visual
    if visual is None:
        return False, "该角色当前还不能生成，请先完成视觉训练。"

    if visual.training_status != "completed":
        return False, "该角色当前还不能生成，请先完成视觉训练。"

    if not visual.lora_path or not visual.trigger_word:
        return False, "该角色的视觉资产还不完整，请先完成训练结果绑定。"

    return True, None


def build_generation_workbench_contract(
    connection: sqlite3.Connection,
    character_id: str,
) -> GenerationWorkbenchContractResponse:
    character = get_character_detail(connection, character_id)
    costumes = _ensure_base_costume(connection, character_id)
    selected_costume = costumes[0]

    can_generate, blocking_reason = _resolve_readiness(character)

    dna_prompt = ""
    trigger_word = ""
    lora_weight = 0.85

    if character.dna is not None and character.dna.auto_prompt:
        dna_prompt = character.dna.auto_prompt

    if character.visual is not None:
        trigger_word = character.visual.trigger_word or ""
        if character.visual.recommended_weight is not None:
            lora_weight = character.visual.recommended_weight

    return GenerationWorkbenchContractResponse(
        characterId=character.id,
        characterName=character.name,
        canGenerate=can_generate,
        blockingReason=blocking_reason,
        costumes=[
            GenerationCostumeOption(
                id=row["id"],
                name=row["name"],
                costumePrompt=row["costume_prompt"],
                isDefault=index == 0,
            )
            for index, row in enumerate(costumes)
        ],
        selectedCostumeId=selected_costume["id"],
        promptSources=GenerationPromptSources(
            dnaPrompt=dna_prompt,
            triggerWord=trigger_word,
            costumePrompt=selected_costume["costume_prompt"],
        ),
        parameterDefaults=GenerationParameterDefaults(
            sampler=DEFAULT_SAMPLER,
            loraWeight=lora_weight,
        ),
        tagOptions=DEFAULT_TAG_OPTIONS,
    )


def validate_generation_submission(
    contract: GenerationWorkbenchContractResponse,
    payload: GenerationSubmitRequest,
) -> None:
    if payload.character_id != contract.character_id:
        raise GenerationContractValidationError("生成请求中的角色信息无效，请重新进入生成工作台。")

    if not contract.can_generate:
        raise GenerationContractValidationError(
            contract.blocking_reason or "该角色当前还不能生成，请稍后重试。"
        )

    allowed_costumes = {costume.id for costume in contract.costumes}
    if payload.costume_id not in allowed_costumes:
        raise GenerationContractValidationError("所选造型不存在，请刷新后重试。")


def build_mock_generation_job(
    task: TaskSnapshot,
    payload: GenerationSubmitRequest,
) -> GenerationMockJobSnapshot:
    stage_by_status = {
        "pending": "queued",
        "running": "running",
        "completed": "completed",
        "failed": "failed",
    }

    return GenerationMockJobSnapshot(
        id=task.id,
        taskId=task.id,
        characterId=payload.character_id,
        costumeId=payload.costume_id,
        scenePrompt=payload.scene_prompt,
        status=task.status,
        stage=stage_by_status[task.status],
        progress=task.progress,
        message=task.message,
        error=task.error,
        tags=payload.tags,
        createdAt=task.created_at,
        updatedAt=task.updated_at,
    )
```

Create `backend/app/api/generations.py`:

```python
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.db.connection import connect_database
from app.schemas.generations import GenerationWorkbenchContractResponse
from app.services.characters import CharacterNotFoundError
from app.services.generation_contract import build_generation_workbench_contract

router = APIRouter()


@dataclass(slots=True)
class GenerationRuntime:
    db_path: Path
    data_root: Path


def _resolve_runtime(request: Request) -> GenerationRuntime:
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    return GenerationRuntime(db_path=bootstrap.db_path, data_root=bootstrap.data_root)


@contextmanager
def _open_connection(db_path: Path):
    with connect_database(db_path) as connection:
        connection.row_factory = sqlite3.Row
        yield connection


@router.get(
    "/characters/{character_id}/generation-workbench",
    response_model=GenerationWorkbenchContractResponse,
)
def get_generation_workbench(character_id: str, request: Request):
    runtime = _resolve_runtime(request)

    try:
        with _open_connection(runtime.db_path) as connection:
            return build_generation_workbench_contract(connection, character_id)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
```

Modify `backend/app/main.py` imports and router registration:

```python
from app.api.generations import router as generations_router
```

and:

```python
    app.include_router(generations_router, prefix="/api")
```

- [ ] **Step 4: Run the backend contract tests and verify they pass**

Run:

```bash
pytest -q backend/tests/test_generation_contract_api.py
```

Expected:

```text
3 passed in ...
```

- [ ] **Step 5: Commit the backend contract read model**

Run:

```bash
git add backend/app/schemas/generations.py \
  backend/app/services/generation_contract.py \
  backend/app/api/generations.py \
  backend/app/main.py \
  backend/tests/test_generation_contract_api.py
git commit -m "[M2] Add generation contract API"
```

Expected:

```text
[codex/m2b-generation-contract ...] [M2] Add generation contract API
```

### Task 2: Add mock generation submission on top of the existing task queue

**Files:**
- Modify: `backend/app/api/generations.py`
- Modify: `backend/app/services/generation_contract.py`
- Modify: `backend/tests/test_generation_contract_api.py`

- [ ] **Step 1: Extend the backend tests to cover mock submission and Chinese validation errors**

Append to `backend/tests/test_generation_contract_api.py`:

```python
import time


def _wait_for_task_completion(client: TestClient, task_id: str) -> dict:
    deadline = time.time() + 3.0
    latest: dict | None = None

    while time.time() < deadline:
        response = client.get(f"/api/tasks/{task_id}")
        assert response.status_code == 200
        latest = response.json()
        if latest["status"] in {"completed", "failed"}:
            return latest
        time.sleep(0.02)

    raise AssertionError(f"任务没有在预期时间内完成。最后状态: {latest}")


def test_mock_generation_submission_returns_job_and_finishes(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json=_ready_character_payload())
        character_id = created.json()["id"]

        contract = client.get(f"/api/characters/{character_id}/generation-workbench")
        selected_costume_id = contract.json()["selectedCostumeId"]

        response = client.post(
            "/api/generations/mock",
            json={
                "characterId": character_id,
                "costumeId": selected_costume_id,
                "scenePrompt": "在咖啡馆里看书，午后阳光透过窗户照进来",
                "negativePrompt": "",
                "width": 1024,
                "height": 1024,
                "steps": 28,
                "sampler": "DPM++ 2M Karras",
                "cfgScale": 3.5,
                "seed": None,
                "loraWeight": 0.85,
                "tags": ["封面图"],
            },
        )

        assert response.status_code == 202
        body = response.json()
        assert body["job"]["characterId"] == character_id
        assert body["job"]["scenePrompt"] == "在咖啡馆里看书，午后阳光透过窗户照进来"
        assert body["job"]["status"] == "pending"
        assert body["job"]["stage"] == "queued"
        assert body["job"]["tags"] == ["封面图"]

        final_task = _wait_for_task_completion(client, body["job"]["taskId"])

    assert final_task["status"] == "completed"
    assert final_task["progress"] == 100
    assert final_task["error"] is None


def test_mock_generation_submission_rejects_blocked_characters(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json={"name": "还没训练"})
        character_id = created.json()["id"]

        contract = client.get(f"/api/characters/{character_id}/generation-workbench")
        selected_costume_id = contract.json()["selectedCostumeId"]

        response = client.post(
            "/api/generations/mock",
            json={
                "characterId": character_id,
                "costumeId": selected_costume_id,
                "scenePrompt": "测试场景",
                "negativePrompt": "",
                "width": 1024,
                "height": 1024,
                "steps": 28,
                "sampler": "DPM++ 2M Karras",
                "cfgScale": 3.5,
                "seed": None,
                "loraWeight": 0.85,
                "tags": ["封面图"],
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "该角色当前还不能生成，请先完成视觉训练。"


def test_mock_generation_submission_rejects_unknown_costume(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        created = client.post("/api/characters", json=_ready_character_payload())
        character_id = created.json()["id"]

        response = client.post(
            "/api/generations/mock",
            json={
                "characterId": character_id,
                "costumeId": "missing-costume",
                "scenePrompt": "测试场景",
                "negativePrompt": "",
                "width": 1024,
                "height": 1024,
                "steps": 28,
                "sampler": "DPM++ 2M Karras",
                "cfgScale": 3.5,
                "seed": None,
                "loraWeight": 0.85,
                "tags": ["封面图"],
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "所选造型不存在，请刷新后重试。"
```

- [ ] **Step 2: Run the new mock-submission tests and confirm they fail**

Run:

```bash
pytest -q backend/tests/test_generation_contract_api.py -k "mock_generation_submission"
```

Expected:

```text
FFF
...
E       assert 404 == 202
```

- [ ] **Step 3: Implement the mock submission endpoint using the existing task queue**

Modify `backend/app/api/generations.py` imports:

```python
import asyncio
```

Add these imports:

```python
from app.api.tasks import resolve_task_queue_from_request
from app.schemas.generations import (
    GenerationJobAcceptedResponse,
    GenerationSubmitRequest,
    GenerationWorkbenchContractResponse,
)
from app.services.generation_contract import (
    GenerationContractValidationError,
    build_generation_workbench_contract,
    build_mock_generation_job,
    validate_generation_submission,
)
```

Append the mock route to `backend/app/api/generations.py`:

```python
@router.post(
    "/generations/mock",
    response_model=GenerationJobAcceptedResponse,
    status_code=202,
)
async def create_mock_generation(request: Request, payload: GenerationSubmitRequest):
    runtime = _resolve_runtime(request)
    queue = resolve_task_queue_from_request(request)

    try:
        with _open_connection(runtime.db_path) as connection:
            contract = build_generation_workbench_contract(connection, payload.character_id)
            validate_generation_submission(contract, payload)
    except CharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GenerationContractValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    async def run_mock_generation(progress) -> None:
        await progress(20, "正在校验生成请求")
        await asyncio.sleep(0.05)
        await progress(55, "正在准备图像引擎")
        await asyncio.sleep(0.05)
        await progress(85, "契约验证完成，等待 M2-C 接入真实引擎")
        await asyncio.sleep(0.05)

    task = await queue.submit(
        name=f"generation-contract-{payload.character_id}",
        runner=run_mock_generation,
        initial_message="生成任务已进入队列",
    )

    return {"job": build_mock_generation_job(task, payload)}
```

No change is required in `backend/app/services/generation_contract.py` if you created `validate_generation_submission()` and `build_mock_generation_job()` in Task 1. If Task 1 omitted them, add those two functions now using the exact code shown there.

- [ ] **Step 4: Run the full backend contract test file and verify all cases pass**

Run:

```bash
pytest -q backend/tests/test_generation_contract_api.py
```

Expected:

```text
6 passed in ...
```

- [ ] **Step 5: Commit the mock submission contract**

Run:

```bash
git add backend/app/api/generations.py \
  backend/app/services/generation_contract.py \
  backend/tests/test_generation_contract_api.py
git commit -m "[M2] Add mock generation submission"
```

Expected:

```text
[codex/m2b-generation-contract ...] [M2] Add mock generation submission
```

### Task 3: Add the typed frontend generation contract client

**Files:**
- Create: `src/api/generations.ts`
- Create: `src/api/generations.test.ts`

- [ ] **Step 1: Write the failing frontend API tests**

Create `src/api/generations.test.ts`:

```typescript
import { afterEach, expect, test, vi } from "vitest";

import {
  createMockGenerationJob,
  fetchGenerationWorkbenchContract,
  mergeTaskIntoGenerationJob,
} from "./generations";
import type { TaskSnapshot } from "./tasks";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("fetches a valid generation workbench contract", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      characterId: "char-1",
      characterName: "星野ミカ",
      canGenerate: true,
      blockingReason: null,
      selectedCostumeId: "costume-1",
      costumes: [
        {
          id: "costume-1",
          name: "基础造型",
          costumePrompt: "",
          isDefault: true,
        },
      ],
      promptSources: {
        dnaPrompt: "pink hair, violet eyes, anime girl",
        triggerWord: "hoshino_mika",
        costumePrompt: "",
      },
      parameterDefaults: {
        width: 1024,
        height: 1024,
        steps: 28,
        sampler: "DPM++ 2M Karras",
        cfgScale: 3.5,
        seed: null,
        loraWeight: 0.85,
      },
      tagOptions: ["封面图", "表情包", "周边", "预告图"],
    }),
  });

  const result = await fetchGenerationWorkbenchContract("char-1");

  expect(result.characterName).toBe("星野ミカ");
  expect(result.canGenerate).toBe(true);
  expect(result.costumes[0].name).toBe("基础造型");
  expect(result.parameterDefaults.sampler).toBe("DPM++ 2M Karras");
});

test("returns backend detail when mock generation submit is rejected", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({
      detail: "该角色当前还不能生成，请先完成视觉训练。",
    }),
  });

  await expect(
    createMockGenerationJob({
      characterId: "char-1",
      costumeId: "costume-1",
      scenePrompt: "测试场景",
      negativePrompt: "",
      width: 1024,
      height: 1024,
      steps: 28,
      sampler: "DPM++ 2M Karras",
      cfgScale: 3.5,
      seed: null,
      loraWeight: 0.85,
      tags: ["封面图"],
    }),
  ).rejects.toThrow("该角色当前还不能生成，请先完成视觉训练。");
});

test("merges task updates into a generation job snapshot", () => {
  const initialJob = {
    id: "task-1",
    taskId: "task-1",
    characterId: "char-1",
    costumeId: "costume-1",
    scenePrompt: "测试场景",
    status: "pending" as const,
    stage: "queued" as const,
    progress: 0,
    message: "生成任务已进入队列",
    error: null,
    tags: ["封面图"],
    createdAt: "2026-03-28T00:00:00Z",
    updatedAt: "2026-03-28T00:00:00Z",
  };

  const taskUpdate: TaskSnapshot = {
    id: "task-1",
    name: "generation-contract-char-1",
    status: "running",
    progress: 55,
    message: "正在准备图像引擎",
    error: null,
    createdAt: "2026-03-28T00:00:00Z",
    updatedAt: "2026-03-28T00:00:01Z",
  };

  const merged = mergeTaskIntoGenerationJob(initialJob, taskUpdate);

  expect(merged.status).toBe("running");
  expect(merged.stage).toBe("running");
  expect(merged.progress).toBe(55);
  expect(merged.message).toBe("正在准备图像引擎");
});
```

- [ ] **Step 2: Run the new frontend API tests and confirm they fail**

Run:

```bash
npm run test:run -- src/api/generations.test.ts
```

Expected:

```text
FAIL  src/api/generations.test.ts
Error: Failed to resolve import "./generations"
```

- [ ] **Step 3: Implement the typed frontend generation client**

Create `src/api/generations.ts`:

```typescript
import type { TaskSnapshot } from "./tasks";

export type GenerationCostumeOption = {
  id: string;
  name: string;
  costumePrompt: string;
  isDefault: boolean;
};

export type GenerationPromptSources = {
  dnaPrompt: string;
  triggerWord: string;
  costumePrompt: string;
};

export type GenerationParameterDefaults = {
  width: number;
  height: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  seed: number | null;
  loraWeight: number;
};

export type GenerationWorkbenchContract = {
  characterId: string;
  characterName: string;
  canGenerate: boolean;
  blockingReason: string | null;
  costumes: GenerationCostumeOption[];
  selectedCostumeId: string;
  promptSources: GenerationPromptSources;
  parameterDefaults: GenerationParameterDefaults;
  tagOptions: string[];
};

export type GenerationMockRequest = {
  characterId: string;
  costumeId: string;
  scenePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  seed: number | null;
  loraWeight: number;
  tags: string[];
};

export type GenerationMockJob = {
  id: string;
  taskId: string;
  characterId: string;
  costumeId: string;
  scenePrompt: string;
  status: "pending" | "running" | "completed" | "failed";
  stage: "queued" | "running" | "completed" | "failed";
  progress: number;
  message?: string | null;
  error?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

function resolveWorkbenchUrl(characterId: string): string {
  return `${DEFAULT_API_BASE_URL}/api/characters/${characterId}/generation-workbench`;
}

function resolveMockGenerationUrl(): string {
  return `${DEFAULT_API_BASE_URL}/api/generations/mock`;
}

function isGenerationCostumeOption(value: unknown): value is GenerationCostumeOption {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<GenerationCostumeOption>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.costumePrompt === "string" &&
    typeof candidate.isDefault === "boolean"
  );
}

function isGenerationWorkbenchContract(value: unknown): value is GenerationWorkbenchContract {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<GenerationWorkbenchContract>;
  return (
    typeof candidate.characterId === "string" &&
    typeof candidate.characterName === "string" &&
    typeof candidate.canGenerate === "boolean" &&
    (candidate.blockingReason === null || typeof candidate.blockingReason === "string") &&
    Array.isArray(candidate.costumes) &&
    candidate.costumes.every((item) => isGenerationCostumeOption(item)) &&
    typeof candidate.selectedCostumeId === "string" &&
    typeof candidate.promptSources === "object" &&
    candidate.promptSources !== null &&
    typeof candidate.parameterDefaults === "object" &&
    candidate.parameterDefaults !== null &&
    Array.isArray(candidate.tagOptions)
  );
}

function isGenerationMockJob(value: unknown): value is GenerationMockJob {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<GenerationMockJob>;
  const validStatus =
    candidate.status === "pending" ||
    candidate.status === "running" ||
    candidate.status === "completed" ||
    candidate.status === "failed";
  const validStage =
    candidate.stage === "queued" ||
    candidate.stage === "running" ||
    candidate.stage === "completed" ||
    candidate.stage === "failed";

  return (
    typeof candidate.id === "string" &&
    typeof candidate.taskId === "string" &&
    typeof candidate.characterId === "string" &&
    typeof candidate.costumeId === "string" &&
    typeof candidate.scenePrompt === "string" &&
    validStatus &&
    validStage &&
    typeof candidate.progress === "number" &&
    Array.isArray(candidate.tags) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isGenerationMockResponse(value: unknown): value is { job: GenerationMockJob } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { job?: unknown };
  return isGenerationMockJob(candidate.job);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readBackendDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as { detail?: unknown };
  return typeof candidate.detail === "string" ? candidate.detail : null;
}

export async function fetchGenerationWorkbenchContract(
  characterId: string,
  signal?: AbortSignal,
): Promise<GenerationWorkbenchContract> {
  let response: Response;
  try {
    response = await fetch(resolveWorkbenchUrl(characterId), { signal });
  } catch {
    throw new Error("GENERATION_CONTRACT_UNAVAILABLE");
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(readBackendDetail(payload) ?? "GENERATION_CONTRACT_UNAVAILABLE");
  }

  if (!isGenerationWorkbenchContract(payload)) {
    throw new Error("INVALID_GENERATION_CONTRACT_RESPONSE");
  }

  return payload;
}

export async function createMockGenerationJob(
  input: GenerationMockRequest,
  signal?: AbortSignal,
): Promise<GenerationMockJob> {
  let response: Response;
  try {
    response = await fetch(resolveMockGenerationUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    throw new Error("GENERATION_SUBMIT_UNAVAILABLE");
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(readBackendDetail(payload) ?? "GENERATION_SUBMIT_FAILED");
  }

  if (!isGenerationMockResponse(payload)) {
    throw new Error("INVALID_GENERATION_SUBMIT_RESPONSE");
  }

  return payload.job;
}

export function mergeTaskIntoGenerationJob(
  job: GenerationMockJob,
  task: TaskSnapshot,
): GenerationMockJob {
  const stage =
    task.status === "pending"
      ? "queued"
      : task.status === "running"
        ? "running"
        : task.status === "completed"
          ? "completed"
          : "failed";

  return {
    ...job,
    status: task.status,
    stage,
    progress: task.progress,
    message: task.message,
    error: task.error,
    updatedAt: task.updatedAt,
  };
}
```

- [ ] **Step 4: Run the frontend API tests and verify they pass**

Run:

```bash
npm run test:run -- src/api/generations.test.ts
```

Expected:

```text
✓ src/api/generations.test.ts (...)
```

- [ ] **Step 5: Commit the frontend generation client**

Run:

```bash
git add src/api/generations.ts src/api/generations.test.ts
git commit -m "[M2] Add generation contract client"
```

Expected:

```text
[codex/m2b-generation-contract ...] [M2] Add generation contract client
```

### Task 4: Render the generation contract shell inside the character detail view

**Files:**
- Create: `src/components/GenerationContractPanel.tsx`
- Create: `src/components/GenerationContractPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the failing UI tests for the contract shell**

Create `src/components/GenerationContractPanel.test.tsx`:

```typescript
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { GenerationContractPanel } from "./GenerationContractPanel";

const fetchMock = vi.fn();

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  MockWebSocket.instances = [];
});

test("renders the contract shell for a ready character and updates mock job progress", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        characterId: "char-1",
        characterName: "星野ミカ",
        canGenerate: true,
        blockingReason: null,
        selectedCostumeId: "costume-1",
        costumes: [{ id: "costume-1", name: "基础造型", costumePrompt: "", isDefault: true }],
        promptSources: {
          dnaPrompt: "pink hair, violet eyes, anime girl",
          triggerWord: "hoshino_mika",
          costumePrompt: "",
        },
        parameterDefaults: {
          width: 1024,
          height: 1024,
          steps: 28,
          sampler: "DPM++ 2M Karras",
          cfgScale: 3.5,
          seed: null,
          loraWeight: 0.85,
        },
        tagOptions: ["封面图", "表情包", "周边", "预告图"],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        job: {
          id: "task-1",
          taskId: "task-1",
          characterId: "char-1",
          costumeId: "costume-1",
          scenePrompt: "契约验证场景：在直播封面中微笑看向镜头",
          status: "pending",
          stage: "queued",
          progress: 0,
          message: "生成任务已进入队列",
          error: null,
          tags: ["封面图"],
          createdAt: "2026-03-28T00:00:00Z",
          updatedAt: "2026-03-28T00:00:00Z",
        },
      }),
    });

  render(<GenerationContractPanel characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");
  expect(screen.getByText("pink hair, violet eyes, anime girl")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "提交契约验证任务" })).toBeEnabled();

  const stream = MockWebSocket.instances[0];
  stream.emitOpen();

  await user.click(screen.getByRole("button", { name: "提交契约验证任务" }));
  await screen.findByText("生成任务已进入队列");

  stream.emitMessage({
    event: "task_updated",
    task: {
      id: "task-1",
      name: "generation-contract-char-1",
      status: "running",
      progress: 55,
      message: "正在准备图像引擎",
      error: null,
      createdAt: "2026-03-28T00:00:00Z",
      updatedAt: "2026-03-28T00:00:01Z",
    },
  });

  await screen.findByText("正在准备图像引擎");
  expect(screen.getByText("55%")).toBeInTheDocument();
});

test("shows a blocked message when the character is not ready", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      characterId: "char-2",
      characterName: "未训练角色",
      canGenerate: false,
      blockingReason: "该角色当前还不能生成，请先完成视觉训练。",
      selectedCostumeId: "costume-2",
      costumes: [{ id: "costume-2", name: "基础造型", costumePrompt: "", isDefault: true }],
      promptSources: { dnaPrompt: "", triggerWord: "", costumePrompt: "" },
      parameterDefaults: {
        width: 1024,
        height: 1024,
        steps: 28,
        sampler: "DPM++ 2M Karras",
        cfgScale: 3.5,
        seed: null,
        loraWeight: 0.85,
      },
      tagOptions: ["封面图", "表情包", "周边", "预告图"],
    }),
  });

  render(<GenerationContractPanel characterId="char-2" characterName="未训练角色" />);

  await screen.findByText("该角色当前还不能生成，请先完成视觉训练。");
  expect(screen.getByRole("button", { name: "提交契约验证任务" })).toBeDisabled();
});
```

Modify the detail-shell test in `src/App.test.tsx` so detail view has a second fetch response:

```typescript
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        characterId: "char-1",
        characterName: "星野ミカ",
        canGenerate: true,
        blockingReason: null,
        selectedCostumeId: "costume-1",
        costumes: [{ id: "costume-1", name: "基础造型", costumePrompt: "", isDefault: true }],
        promptSources: {
          dnaPrompt: "pink hair, violet eyes, anime girl",
          triggerWord: "hoshino_mika",
          costumePrompt: "",
        },
        parameterDefaults: {
          width: 1024,
          height: 1024,
          steps: 28,
          sampler: "DPM++ 2M Karras",
          cfgScale: 3.5,
          seed: null,
          loraWeight: 0.85,
        },
        tagOptions: ["封面图", "表情包", "周边", "预告图"],
      }),
    });
```

- [ ] **Step 2: Run the UI tests and confirm they fail**

Run:

```bash
npm run test:run -- src/components/GenerationContractPanel.test.tsx
```

Expected:

```text
FAIL  src/components/GenerationContractPanel.test.tsx
Error: Failed to resolve import "./GenerationContractPanel"
```

- [ ] **Step 3: Implement the contract shell component and wire it into the detail view**

Create `src/components/GenerationContractPanel.tsx`:

```tsx
import { useEffect, useState } from "react";

import {
  createMockGenerationJob,
  fetchGenerationWorkbenchContract,
  mergeTaskIntoGenerationJob,
  type GenerationMockJob,
  type GenerationWorkbenchContract,
} from "../api/generations";
import { createTaskStream, type TaskConnectionState } from "../api/tasks";

type ContractState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; contract: GenerationWorkbenchContract };

export function GenerationContractPanel({
  characterId,
  characterName,
}: {
  characterId: string;
  characterName: string;
}) {
  const [state, setState] = useState<ContractState>({ kind: "loading" });
  const [job, setJob] = useState<GenerationMockJob | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [taskConnection, setTaskConnection] = useState<TaskConnectionState>("connecting");

  useEffect(() => {
    const abortController = new AbortController();
    setState({ kind: "loading" });

    void fetchGenerationWorkbenchContract(characterId, abortController.signal)
      .then((contract) => {
        setState({ kind: "ready", contract });
      })
      .catch((error: Error) => {
        setState({
          kind: "error",
          message:
            error.message === "GENERATION_CONTRACT_UNAVAILABLE"
              ? "生成工作台契约加载失败，请稍后重试。"
              : error.message,
        });
      });

    return () => {
      abortController.abort();
    };
  }, [characterId]);

  useEffect(() => {
    const disconnect = createTaskStream(
      (event) => {
        setJob((current) => {
          if (current === null || event.task.id !== current.taskId) {
            return current;
          }

          return mergeTaskIntoGenerationJob(current, event.task);
        });
      },
      setTaskConnection,
    );

    return () => {
      disconnect();
    };
  }, []);

  async function handleSubmitMockJob() {
    if (state.kind !== "ready") {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await createMockGenerationJob({
        characterId,
        costumeId: state.contract.selectedCostumeId,
        scenePrompt: "契约验证场景：在直播封面中微笑看向镜头",
        negativePrompt: "",
        width: state.contract.parameterDefaults.width,
        height: state.contract.parameterDefaults.height,
        steps: state.contract.parameterDefaults.steps,
        sampler: state.contract.parameterDefaults.sampler,
        cfgScale: state.contract.parameterDefaults.cfgScale,
        seed: state.contract.parameterDefaults.seed,
        loraWeight: state.contract.parameterDefaults.loraWeight,
        tags: state.contract.tagOptions.slice(0, 1),
      });

      setJob(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交契约验证任务失败，请稍后重试。";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <section className="generation-contract-panel">
        <h2>生成主链路契约</h2>
        <p>正在加载 {characterName} 的生成契约...</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="generation-contract-panel">
        <h2>生成主链路契约</h2>
        <p className="generation-contract-error">{state.message}</p>
      </section>
    );
  }

  const { contract } = state;

  return (
    <section className="generation-contract-panel" aria-labelledby="generation-contract-title">
      <div className="generation-contract-header">
        <div>
          <p className="eyebrow">M2-B</p>
          <h2 id="generation-contract-title">生成主链路契约</h2>
        </div>
        <span className={`task-connection task-connection-${taskConnection}`}>
          {taskConnection === "connected" ? "任务流已连接" : "任务流连接中"}
        </span>
      </div>

      <p className="generation-contract-lead">
        这一层先固定“能不能生成、要提交什么、进度怎么返回”，真实图像引擎将在后续叶子任务接入。
      </p>

      <div className="generation-contract-grid">
        <article className="generation-contract-card">
          <h3>生成就绪状态</h3>
          <p className={contract.canGenerate ? "generation-ready" : "generation-blocked"}>
            {contract.canGenerate ? "该角色已满足生成前置条件。" : contract.blockingReason}
          </p>
          <h4>可用造型</h4>
          <ul className="generation-contract-list">
            {contract.costumes.map((costume) => (
              <li key={costume.id}>
                {costume.name}
                {costume.isDefault ? "（默认）" : ""}
              </li>
            ))}
          </ul>
        </article>

        <article className="generation-contract-card">
          <h3>Prompt 来源</h3>
          <dl className="generation-contract-definition">
            <div>
              <dt>DNA Prompt</dt>
              <dd>{contract.promptSources.dnaPrompt || "暂无"}</dd>
            </div>
            <div>
              <dt>触发词</dt>
              <dd>{contract.promptSources.triggerWord || "暂无"}</dd>
            </div>
            <div>
              <dt>造型附加</dt>
              <dd>{contract.promptSources.costumePrompt || "暂无"}</dd>
            </div>
          </dl>
        </article>

        <article className="generation-contract-card">
          <h3>默认参数</h3>
          <dl className="generation-contract-definition">
            <div>
              <dt>尺寸</dt>
              <dd>
                {contract.parameterDefaults.width} × {contract.parameterDefaults.height}
              </dd>
            </div>
            <div>
              <dt>Steps</dt>
              <dd>{contract.parameterDefaults.steps}</dd>
            </div>
            <div>
              <dt>Sampler</dt>
              <dd>{contract.parameterDefaults.sampler}</dd>
            </div>
            <div>
              <dt>CFG</dt>
              <dd>{contract.parameterDefaults.cfgScale}</dd>
            </div>
            <div>
              <dt>LoRA 权重</dt>
              <dd>{contract.parameterDefaults.loraWeight}</dd>
            </div>
          </dl>
          <p className="generation-contract-tags">默认用途标签：{contract.tagOptions.join(" / ")}</p>
        </article>
      </div>

      <div className="generation-contract-actions">
        <button
          className="primary-button"
          type="button"
          onClick={handleSubmitMockJob}
          disabled={!contract.canGenerate || submitting}
        >
          提交契约验证任务
        </button>
        {submitError ? <p className="generation-contract-error">{submitError}</p> : null}
      </div>

      {job ? (
        <div className="generation-job-card">
          <p className="generation-job-title">当前契约任务</p>
          <p>{job.scenePrompt}</p>
          <p>阶段：{job.stage}</p>
          <p>进度：{job.progress}%</p>
          <p>{job.error ?? job.message ?? "等待任务更新..."}</p>
        </div>
      ) : null}
    </section>
  );
}
```

Modify the detail-shell branch in `src/App.tsx`:

```tsx
import { GenerationContractPanel } from "./components/GenerationContractPanel";
```

and replace the current placeholder block:

```tsx
          <p className="detail-placeholder">
            这里先接入生成主链路契约，真实出图和归档将在后续 M2 叶子任务继续补齐。
          </p>
          <GenerationContractPanel
            characterId={selectedCharacter.id}
            characterName={selectedCharacter.name}
          />
```

Append these styles to `src/styles.css`:

```css
.generation-contract-panel {
  margin-top: 1.5rem;
  padding: 1.25rem;
  border-radius: 1rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.generation-contract-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.generation-contract-lead {
  margin-top: 0.75rem;
  color: #cbd5e1;
}

.generation-contract-grid {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.875rem;
}

.generation-contract-card,
.generation-job-card {
  padding: 1rem;
  border-radius: 0.875rem;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.generation-contract-list,
.generation-contract-definition {
  margin-top: 0.75rem;
}

.generation-contract-definition div + div {
  margin-top: 0.5rem;
}

.generation-ready {
  color: #86efac;
}

.generation-blocked,
.generation-contract-error {
  color: #fca5a5;
}

.generation-contract-actions {
  margin-top: 1rem;
}

.generation-contract-tags,
.generation-job-title {
  margin-top: 0.75rem;
  color: #cbd5e1;
  font-weight: 600;
}
```

- [ ] **Step 4: Run the UI tests, then run the full frontend test suite and build**

Run:

```bash
npm run test:run -- src/components/GenerationContractPanel.test.tsx src/App.test.tsx
npm run test:run
npm run build
```

Expected:

```text
✓ src/components/GenerationContractPanel.test.tsx (...)
✓ src/App.test.tsx (...)
...
Test Files  ... passed
...
✓ built in ...
```

- [ ] **Step 5: Commit the contract shell UI**

Run:

```bash
git add src/components/GenerationContractPanel.tsx \
  src/components/GenerationContractPanel.test.tsx \
  src/App.tsx \
  src/App.test.tsx \
  src/styles.css
git commit -m "[M2] Add generation contract shell"
```

Expected:

```text
[codex/m2b-generation-contract ...] [M2] Add generation contract shell
```

### Task 5: Verify the leaf branch and merge it back into the M2 integration line

**Files:**
- Modify: none

- [ ] **Step 1: Run the leaf verification suite inside `.worktrees/m2b-generation-contract`**

Run:

```bash
pytest -q backend/tests/test_generation_contract_api.py backend/tests/test_task_queue_api.py backend/tests/test_characters_api.py
npm run test:run -- src/api/generations.test.ts src/components/GenerationContractPanel.test.tsx src/App.test.tsx
npm run build
git status --short
```

Expected:

```text
... passed ...
... passed ...
✓ built in ...
```

And `git status --short` should print nothing.

- [ ] **Step 2: Merge the verified leaf branch into the M2 integration worktree**

Run:

```bash
cd ../m2a-generation
git merge --ff-only codex/m2b-generation-contract
```

Expected:

```text
Updating ...
Fast-forward
...
```

- [ ] **Step 3: Re-run the same verification suite in the integration worktree**

Run:

```bash
pytest -q backend/tests/test_generation_contract_api.py backend/tests/test_task_queue_api.py backend/tests/test_characters_api.py
npm run test:run -- src/api/generations.test.ts src/components/GenerationContractPanel.test.tsx src/App.test.tsx
npm run build
git status --short
```

Expected:

```text
... passed ...
... passed ...
✓ built in ...
```

- [ ] **Step 4: Return the required closeout summary to the M2 bus thread**

Post this exact structure back to the bus thread:

```text
叶子任务：M2-B 生成主链路契约
用户新增能力：
1. 角色详情页可以看到生成前置条件、默认造型、Prompt 来源和默认参数
2. 可以提交一条“契约验证任务”，验证生成请求形状和任务状态流

验证结果：
1. backend/tests/test_generation_contract_api.py 通过
2. backend/tests/test_task_queue_api.py 通过
3. backend/tests/test_characters_api.py 通过
4. src/api/generations.test.ts 通过
5. src/components/GenerationContractPanel.test.tsx 通过
6. src/App.test.tsx 通过
7. npm run build 通过

剩余风险：
1. 还没有接入真实图像引擎
2. 还没有做真实 Prompt 自动组装
3. 还没有落盘归档

建议下一个叶子任务：
M2-C 图像引擎运行层
```

## Self-Review

Spec coverage:
- M2-B 需要定义角色是否可生成、默认造型、默认参数、状态流和用户错误文案。Task 1 和 Task 2 覆盖后端契约与状态流，Task 3 和 Task 4 覆盖前端类型与展示壳。
- 用户要求把工作树拆解开并为后续子线程执行做准备。Task 0 和 Task 5 覆盖工作树、分支和合回流程。

Placeholder scan:
- 已避免使用 TBD、TODO、后续补实现等占位说法作为执行步骤。
- 文中的“后续 M2 叶子任务继续补齐”只出现在用户可见文案里，不作为实现步骤或计划占位。

Type consistency:
- `characterId`, `costumeId`, `scenePrompt`, `cfgScale`, `loraWeight`, `taskId` 在后端 schema、前端 API 和组件层保持一致。
- `queued/running/completed/failed` 的阶段命名与 `pending/running/completed/failed` 的任务状态转换关系已经在 `mergeTaskIntoGenerationJob()` 和 `build_mock_generation_job()` 中统一。
