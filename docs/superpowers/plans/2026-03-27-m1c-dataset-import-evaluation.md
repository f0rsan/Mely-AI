# M1C Dataset Import & Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real, testable M1C pipeline where users can batch-import training images, preview them, receive quality evaluation and improvement suggestions, and expose reusable dataset metadata for downstream modules.

**Architecture:** Build a dedicated dataset service and API under character scope, persist normalized report metadata in SQLite, and wire a focused dataset workspace UI into the current character detail shell. Keep training execution, DNA, WD14, and G1 integrations strictly out of scope.

**Tech Stack:** FastAPI + SQLite migration + Python service layer + React/TypeScript + Vitest + Pytest

---

### Task 1: Establish RED Baseline for M1C Backend Contract

**Files:**
- Create: `backend/tests/test_dataset_api.py`
- Test: `backend/tests/test_dataset_api.py`

- [ ] **Step 1: Write failing tests for dataset import and report retrieval**

```python
def test_import_dataset_generates_quality_report_and_persists_output(...):
    response = client.post(f"/api/characters/{character_id}/dataset/import", json={...})
    assert response.status_code == 200
```

- [ ] **Step 2: Add error-path tests (invalid base64 / missing character)**

```python
assert bad_payload_response.status_code == 400
assert bad_payload_response.json()["detail"] == "图片导入失败，请检查图片格式后重试"
```

- [ ] **Step 3: Run tests to verify RED**

Run: `pytest -q backend/tests/test_dataset_api.py`  
Expected: FAIL due missing API/service


### Task 2: Add SQLite Persistence for Dataset Reports

**Files:**
- Create: `backend/migrations/0004_dataset_reports.sql`
- Modify: `backend/tests/test_health.py`
- Test: `backend/tests/test_health.py`

- [ ] **Step 1: Add `dataset_reports` table**

```sql
CREATE TABLE IF NOT EXISTS dataset_reports (
    character_id TEXT PRIMARY KEY,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Add `dataset_images` metadata table**

```sql
CREATE TABLE IF NOT EXISTS dataset_images (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    angle_bucket TEXT NOT NULL,
    quality_status TEXT NOT NULL,
    issues_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);
```

- [ ] **Step 3: Update health test migration assertion**

Run: `pytest -q backend/tests/test_health.py`  
Expected: PASS including `0004_dataset_reports.sql`


### Task 3: Implement Dataset Service (Import + Evaluation + Suggestions + Report)

**Files:**
- Create: `backend/app/services/dataset.py`
- Test: `backend/tests/test_dataset_api.py`

- [ ] **Step 1: Implement payload decoding and image validation**

```python
data = base64.b64decode(content_base64, validate=True)
if not data:
    raise DatasetValidationError("图片导入失败，请检查图片格式后重试")
```

- [ ] **Step 2: Implement dimension parser for PNG/JPG/WebP and compute file hash**

```python
width, height, image_format = detect_image_dimensions(data)
sha256 = hashlib.sha256(data).hexdigest()
```

- [ ] **Step 3: Implement angle bucket inference and issue detection**

```python
angle_bucket = infer_angle_bucket(file_name)
issues = collect_image_issues(width, height, duplicate, aspect_ratio)
```

- [ ] **Step 4: Implement quality score, coverage summary, and training mode recommendation**

```python
quality_score = calculate_quality_score(total, qualified, distribution)
recommended_mode = recommend_training_mode(quality_score, qualified, distribution)
```

- [ ] **Step 5: Implement recommendation generation in Chinese**

```python
recommendations = [
    "背面角度偏少，建议补充 2-3 张背面参考图。",
]
```

- [ ] **Step 6: Persist report JSON + image metadata and return standardized report**

Run: `pytest -q backend/tests/test_dataset_api.py`  
Expected: PASS


### Task 4: Add Dataset API Endpoints and App Router Wiring

**Files:**
- Create: `backend/app/api/datasets.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_dataset_api.py`

- [ ] **Step 1: Add import endpoint**

```python
@router.post("/characters/{character_id}/dataset/import")
def import_dataset(...):
    ...
```

- [ ] **Step 2: Add report endpoint**

```python
@router.get("/characters/{character_id}/dataset/report")
def get_dataset_report(...):
    ...
```

- [ ] **Step 3: Map service errors to Chinese HTTP details**

```python
raise HTTPException(status_code=404, detail="角色不存在")
```

- [ ] **Step 4: Wire datasets router in app startup**

Run: `pytest -q backend/tests/test_dataset_api.py`  
Expected: PASS


### Task 5: Build Frontend Dataset Workspace (Import + Preview + Evaluation Display)

**Files:**
- Create: `src/api/datasets.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/App.test.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Add dataset API client**

```ts
export async function importCharacterDataset(characterId: string, files: File[]): Promise<DatasetReport> { ... }
```

- [ ] **Step 2: Replace detail placeholder with dataset workspace panel**

```tsx
<h1 id="detail-title">数据集导入与评估</h1>
```

- [ ] **Step 3: Implement multi-file picker and preview grid**

```tsx
<input type="file" multiple accept="image/*" ... />
```

- [ ] **Step 4: Render quality score, angle distribution, problem items, and recommendations**

```tsx
<section aria-label="数据集质量评分">...</section>
```

- [ ] **Step 5: Add frontend tests for new detail behavior and import flow**

Run: `npm run test:run`  
Expected: PASS


### Task 6: Full Verification and Handoff Readiness

**Files:**
- Test: `backend/tests`
- Test: `src`

- [ ] **Step 1: Run focused backend tests**

Run: `pytest -q backend/tests/test_dataset_api.py`  
Expected: PASS

- [ ] **Step 2: Run backend full regression**

Run: `pytest -q backend/tests`  
Expected: PASS

- [ ] **Step 3: Run frontend tests**

Run: `npm run test:run`  
Expected: PASS

- [ ] **Step 4: Confirm standardized downstream fields exist**

```text
required fields:
- totalImages
- qualifiedImages / problemImages
- angleDistribution
- problemItems
- recommendedTrainingMode
```

