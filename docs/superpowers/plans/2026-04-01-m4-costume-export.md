# M4 造型与导出 — 实施计划

> 规划日期：2026-04-01 | 模型：Claude Opus 4.6
> 前置完成：M0 基础层 / M1 视觉训练 / M2 生成工作台 / M3 声音绑定

---

## 1. 范围评估 — 可构建 vs 需要真实 AI

| 功能 | 可立即构建? | 说明 |
|------|------------|------|
| 造型 CRUD API (T4.1) | ✅ YES | 纯 SQLite CRUD，树结构查询 |
| 造型分支创建流程 (T4.2) | ⚠️ PARTIAL | 流程 UI 完全可建；preview generation 需要 ComfyUI — 用 mock 任务（同 M2 generations/mock 模式） |
| 版本树可视化 UI (T4.3) | ✅ YES | 纯前端组件 |
| 设定书数据聚合 (T4.4) | ✅ YES | 查询 DB + 文件系统 |
| PDF 设定书生成 (T4.5) | ✅ YES | reportlab，新增依赖 |
| 导出 UI (T4.6) | ✅ YES | 前端组件 |
| 创作时间戳系统 (T4.7) | ✅ YES | SHA-256 哈希链，纯 Python |
| LoRA AES-256 加密 (T4.8) | ❌ DEFER | 复杂度高（设备指纹跨平台差异、密钥管理），与其他 M4 功能无依赖 — 推迟到 M5 |
| M4 集成测试 (T4.9) | ✅ YES | 在 mock 模式下完整验证 |

**决策**：T4.8（LoRA 加密）不在本轮实施。所有其他任务照常推进，preview generation 使用 mock 任务队列。

---

## 2. DB 迁移

### 现有 schema 已覆盖（无需修改）

`0001_initial_schema.sql` 已包含：
- `costumes` 表 (id, character_id, name, parent_id, costume_lora, costume_prompt, created_at)
- `costume_previews` 表 (id, costume_id, image_path, sort_order)

### 新增 `backend/migrations/0006_creation_timestamps.sql`

```sql
-- M4: creation proof hash chain for IP attribution
CREATE TABLE IF NOT EXISTS creation_proofs (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    -- 'training' | 'image_generation' | 'tts_generation' | 'costume_create' | 'export_pdf'
    timestamp TEXT NOT NULL,         -- ISO 8601
    data_hash TEXT NOT NULL,         -- SHA-256 of operation parameters
    output_hash TEXT,                -- SHA-256 of output file (nullable)
    prev_proof_hash TEXT,            -- SHA-256 of previous proof (null for first)
    proof_hash TEXT NOT NULL,        -- SHA-256(id|op|ts|data_hash|output_hash|prev)
    metadata TEXT,                   -- JSON, operation-specific extras
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_creation_proofs_character ON creation_proofs(character_id);
CREATE INDEX IF NOT EXISTS idx_creation_proofs_timestamp ON creation_proofs(timestamp DESC);
```

### 新增 `backend/migrations/0007_exports.sql`

```sql
-- M4: exported artifacts tracking
CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    export_type TEXT NOT NULL,       -- 'pdf_character_sheet'
    file_path TEXT NOT NULL,
    file_size INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'generating' | 'completed' | 'failed'
    error_message TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exports_character ON exports(character_id);
CREATE INDEX IF NOT EXISTS idx_exports_status ON exports(status);
```

---

## 3. Worktree 叶子划分

```
M4-A (costume api)  ──→ M4-B (costume ui) ──┐
                                              ├──→ M4-E (integration)
M4-C (pdf + proof)  ──→ M4-D (export ui)  ──┘
```

| 叶子 | 分支名 | 内容 | 依赖 | 工时 |
|------|--------|------|------|------|
| M4-A | `codex/m4a-costume-service` | CostumeService + API + migration 0006 | 无 | 1.5d |
| M4-B | `codex/m4b-costume-tree-ui` | CostumeWorkspace + CostumeTree + 创建流程 | M4-A | 2d |
| M4-C | `codex/m4c-pdf-export` | PDFExportService + ProofService + migration 0007 + ExportAPI | 无 | 2d |
| M4-D | `codex/m4d-export-ui` | ExportWorkspace + ExportHistoryList | M4-C | 1d |
| M4-E | `codex/m4e-integration` | App.tsx tabs wiring + 集成测试 | M4-A~D | 1.5d |

**M4-A 和 M4-C 完全并行**。

---

## 4. M4-A：Costume Service + API

### Pydantic Schemas — `backend/app/schemas/costume.py`

```python
class CostumeCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(min_length=1, max_length=50)
    parent_id: str | None = Field(default=None, alias="parentId")
    costume_prompt: str = Field(min_length=1, alias="costumePrompt")

class CostumeUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str | None = Field(default=None, min_length=1, max_length=50)
    costume_prompt: str | None = Field(default=None, min_length=1, alias="costumePrompt")

class CostumeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    character_id: str = Field(alias="characterId")
    name: str
    parent_id: str | None = Field(alias="parentId")
    costume_lora: str | None = Field(default=None, alias="costumeLora")
    costume_prompt: str = Field(alias="costumePrompt")
    is_root: bool = Field(alias="isRoot")
    preview_count: int = Field(alias="previewCount")
    created_at: str = Field(alias="createdAt")

class CostumeTreeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    character_id: str = Field(alias="characterId")
    costumes: list[CostumeResponse]
    total: int

class CostumePreviewResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    costume_id: str = Field(alias="costumeId")
    image_path: str = Field(alias="imagePath")
    sort_order: int = Field(alias="sortOrder")

class CostumePreviewListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    costume_id: str = Field(alias="costumeId")
    previews: list[CostumePreviewResponse]

class CostumePreviewGenerateAcceptedResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    costume_id: str = Field(alias="costumeId")
    task_ids: list[str] = Field(alias="taskIds")
    message: str
```

### Service Layer — `backend/app/services/costume_service.py`

**Exceptions**:
```python
class CostumeNotFoundError(Exception): ...
class CostumeDeleteForbiddenError(Exception): ...
class CostumeParentNotFoundError(Exception): ...
class CostumeServiceError(Exception): ...
```

**Functions**:
```python
def create_costume(conn, data_root, character_id, request) -> CostumeResponse
    # 1. Verify character exists
    # 2. If parent_id, verify parent exists and belongs to same character
    # 3. INSERT into costumes
    # 4. mkdir data_root/characters/{id}/costumes/{costume_id}/previews/
    # 5. Return CostumeResponse

def list_costumes(conn, character_id) -> CostumeTreeResponse
    # SELECT all costumes + preview count (subquery), ordered by created_at ASC

def update_costume(conn, costume_id, request) -> CostumeResponse
    # Fetch → 404 if missing → UPDATE non-None fields → return updated

def delete_costume(conn, data_root, costume_id) -> None
    # Rules:
    # RULE 1: Cannot delete if parent_id IS NULL (root costume)
    # RULE 2: Cannot delete if children exist
    # RULE 3: Cannot delete if it's the last costume for the character
    # DELETE + rmtree preview directory

def list_costume_previews(conn, costume_id) -> CostumePreviewListResponse

async def submit_preview_generation(conn, data_root, costume_id, task_queue) -> list[str]
    # Submit 4 mock tasks, each creates a placeholder PNG + inserts into costume_previews
```

### API Endpoints — `backend/app/api/costumes.py`

| 方法 | 路径 | 状态码 | 说明 |
|------|------|--------|------|
| POST | `/api/characters/{character_id}/costumes` | 201 | 创建造型 |
| GET | `/api/characters/{character_id}/costumes` | 200 | 列表（含树结构） |
| PUT | `/api/costumes/{costume_id}` | 200 | 更新名称/Prompt |
| DELETE | `/api/costumes/{costume_id}` | 204 | 删除造型 |
| GET | `/api/costumes/{costume_id}/previews` | 200 | 预览图列表 |
| POST | `/api/costumes/{costume_id}/generate-previews` | 202 | 提交预览生成任务 |
| GET | `/api/costumes/{costume_id}/previews/{preview_id}/image` | 200 | 获取预览图文件 |

**错误映射**：
- `CostumeNotFoundError` → 404 `"造型不存在，请刷新后重试。"`
- `CostumeDeleteForbiddenError` → 409 `"该造型不能删除：{reason}"`
- `CostumeParentNotFoundError` → 400 `"父造型不存在，请检查后重试。"`

### 测试文件

**`backend/tests/test_costume_service.py`** — 18 个测试：
```
test_create_costume_returns_response_with_id
test_create_costume_with_parent_id
test_create_costume_parent_not_found_raises
test_create_costume_parent_wrong_character_raises
test_create_costume_creates_preview_directory
test_list_costumes_returns_flat_list_with_tree_data
test_list_costumes_includes_preview_count
test_list_costumes_empty_character_returns_empty
test_update_costume_name
test_update_costume_prompt
test_update_costume_partial_only_name
test_update_costume_not_found_raises
test_delete_costume_success
test_delete_costume_root_raises_forbidden
test_delete_costume_with_children_raises_forbidden
test_delete_costume_last_costume_raises_forbidden
test_delete_costume_not_found_raises
test_delete_costume_removes_preview_directory
```

**`backend/tests/test_costume_api.py`** — 13 个测试：
```
test_api_create_costume_returns_201
test_api_create_costume_invalid_payload_returns_422
test_api_create_costume_character_not_found_returns_404
test_api_list_costumes_returns_200_with_tree
test_api_update_costume_returns_200
test_api_update_costume_not_found_returns_404
test_api_delete_costume_returns_204
test_api_delete_costume_root_returns_409
test_api_delete_costume_with_children_returns_409
test_api_list_previews_returns_200
test_api_generate_previews_returns_202_with_task_ids
test_api_get_preview_image_returns_file
test_api_get_preview_image_not_found_returns_404
```

---

## 5. M4-B：造型树 UI

### 组件层次

```
CostumeWorkspace (src/components/CostumeWorkspace.tsx)
├── CostumeTree
│   └── CostumeNode (per costume)
│       ├── Thumbnail (40×40, first preview or placeholder)
│       ├── Name label
│       └── Actions (新建分支 / 删除 / 选为当前)
├── CostumeDetailPanel (selected costume detail)
│   ├── CostumePromptEditor (textarea for costume_prompt)
│   ├── CostumePreviewGrid (2×2 grid)
│   └── ActionBar (保存修改 / 生成预览 / 删除)
└── NewCostumeModal (overlay)
    ├── NameInput
    ├── PromptTextarea (自然语言差异描述)
    └── Actions (取消 / 创建并生成预览)
```

### CostumeWorkspace 状态机

```typescript
type CostumeWorkspaceState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; tree: CostumeTreeResponse; selectedId: string | null }
  | { phase: "creating"; parentId: string | null }  // NewCostumeModal open
  | { phase: "generating-previews"; costumeId: string; taskIds: string[] }
  | { phase: "deleting"; costumeId: string };
```

### 创建流程状态机（NewCostumeModal 内）

```typescript
type CreationFlowState =
  | { step: "naming"; name: string }
  | { step: "prompting"; name: string; prompt: string }
  | { step: "submitting" }
  | { step: "generating-previews"; taskIds: string[] }
  | { step: "reviewing"; costumeId: string }
  | { step: "saved" };
```

### 树渲染策略

使用 **flat list + 缩进** 方案（比 D3 简单，无额外依赖）：
- 从 API 获取 flat `CostumeRecord[]`
- 前端用 `Map<string | null, CostumeRecord[]>` 按 `parentId` 分组
- 递归渲染，每层增加 `padding-left`
- 根节点（parentId === null）显示「根造型」badge，不可删除

### 前端 API Client — `src/api/costumes.ts`

```typescript
export type CostumeRecord = {
  id: string; characterId: string; name: string; parentId: string | null;
  costumeLora: string | null; costumePrompt: string; isRoot: boolean;
  previewCount: number; createdAt: string;
};

export type CostumeTreeResponse = {
  characterId: string; costumes: CostumeRecord[]; total: number;
};

export async function fetchCostumeTree(characterId: string, signal?: AbortSignal): Promise<CostumeTreeResponse>
export async function createCostume(characterId: string, req: CostumeCreateRequest, signal?: AbortSignal): Promise<CostumeRecord>
export async function updateCostume(costumeId: string, req: CostumeUpdateRequest, signal?: AbortSignal): Promise<CostumeRecord>
export async function deleteCostume(costumeId: string, signal?: AbortSignal): Promise<void>
export async function fetchCostumePreviews(costumeId: string, signal?: AbortSignal): Promise<CostumePreviewListResponse>
export async function generateCostumePreviews(costumeId: string, signal?: AbortSignal): Promise<PreviewGenerateAcceptedResponse>
export function costumePreviewImageUrl(costumeId: string, previewId: string): string
```

### 测试文件

**`src/components/CostumeWorkspace.test.tsx`** — 8 个测试：
```
renders loading state
renders tree with root and child costumes
clicking a costume node selects it and shows detail panel
new branch button opens NewCostumeModal
creating costume calls API and refreshes tree
delete button disabled for root costume
delete button shows confirmation
generating previews shows progress indicator
```

**`src/api/costumes.test.ts`** — 5 个测试：
```
fetchCostumeTree returns parsed tree
fetchCostumeTree network error throws Chinese message
createCostume returns new costume record
deleteCostume returns void on 204
type guard rejects invalid costume record
```

---

## 6. M4-C：PDF 导出 + 创作证明

### 新增依赖

```toml
# backend/pyproject.toml
"reportlab>=4.2,<5.0"
```

### PDF Export Service — `backend/app/services/pdf_export.py`

```python
@dataclass
class CharacterSheetData:
    character_name: str
    character_id: str
    created_at: str
    dna: dict[str, str | None]          # hair_color, eye_color, etc.
    auto_prompt: str
    trigger_word: str | None
    recommended_weight: float | None
    base_checkpoint: str | None
    training_status: str | None
    costumes: list[CostumeSheetEntry]
    reference_images: list[Path]         # training dataset images (max 9)
    proof_chain_summary: str | None

@dataclass
class CostumeSheetEntry:
    name: str
    costume_prompt: str
    preview_image_paths: list[Path]

def aggregate_character_sheet_data(conn, data_root, character_id) -> CharacterSheetData
def generate_character_sheet_pdf(data, data_root, character_id) -> Path
```

**PDF 布局**：
1. 封面页：角色名 + 创建日期 + Mely AI 品牌
2. DNA 参数页：参数表格 + auto_prompt
3. 参考图页：3×3 网格（最多 9 张）
4. 造型页（每个造型一节）：名称 + Prompt + 2×2 预览图

**中文字体查找顺序**：
1. macOS: `/System/Library/Fonts/Supplemental/NotoSansCJKsc-Regular.otf`
2. Linux: `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`
3. Windows: `C:/Windows/Fonts/msyh.ttc`
4. Fallback: reportlab 内置 `UniGB-UCS2-H`

**输出路径**：`~/.mely/characters/{id}/exports/character-{name}-{YYYYMMDD-HHMMSS}.pdf`

### Proof Service — `backend/app/services/proof_service.py`

```python
def create_proof(conn, character_id, operation_type, params, output_path=None, metadata=None) -> ProofRecord
    # 1. Get last proof → prev_proof_hash
    # 2. data_hash = SHA-256(json.dumps(params, sort_keys=True))
    # 3. output_hash = SHA-256(file bytes) if output_path
    # 4. proof_hash = SHA-256(id|op|ts|data_hash|output_hash|prev)
    # 5. INSERT into creation_proofs

def export_proof_chain(conn, character_id) -> list[dict]
def verify_proof_chain(chain) -> tuple[bool, str | None]
```

### Export API Endpoints — `backend/app/api/exports.py`

| 方法 | 路径 | 状态码 | 说明 |
|------|------|--------|------|
| POST | `/api/characters/{id}/export-pdf` | 202 | 提交 PDF 生成任务 |
| GET | `/api/characters/{id}/exports` | 200 | 历史导出列表 |
| GET | `/api/exports/{export_id}/download` | 200 | 下载 PDF 文件 |
| POST | `/api/characters/{id}/proof` | 200 | 导出创作证明 JSON |
| GET | `/api/characters/{id}/proof/verify` | 200 | 验证哈希链完整性 |

### 测试文件

**`backend/tests/test_pdf_export.py`** — 9 个测试：
```
test_aggregate_character_sheet_data_returns_all_fields
test_aggregate_character_sheet_data_character_not_found
test_aggregate_includes_costumes_with_previews
test_aggregate_includes_reference_images
test_generate_pdf_creates_file
test_generate_pdf_file_is_valid_pdf (bytes start with %PDF)
test_generate_pdf_contains_character_name
test_generate_pdf_creates_exports_directory
test_generate_pdf_chinese_font_fallback
```

**`backend/tests/test_proof_service.py`** — 10 个测试：
```
test_create_proof_first_record_has_null_prev_hash
test_create_proof_second_record_links_to_first
test_create_proof_hash_is_deterministic
test_create_proof_with_output_file
test_export_proof_chain_returns_ordered_list
test_verify_proof_chain_valid
test_verify_proof_chain_detects_tampered_hash
test_verify_proof_chain_detects_broken_link
test_compute_data_hash_deterministic
test_compute_file_hash
```

**`backend/tests/test_export_api.py`** — 7 个测试：
```
test_api_export_pdf_returns_202
test_api_export_pdf_character_not_found_returns_404
test_api_list_exports_returns_200
test_api_download_export_returns_pdf_file
test_api_download_export_not_found_returns_404
test_api_export_proof_returns_chain
test_api_verify_proof_returns_valid
```

---

## 7. M4-D：导出 UI

### 组件层次

```
ExportWorkspace (src/components/ExportWorkspace.tsx)
├── CharacterSummaryCard
│   ├── 角色名 + 创建时间
│   ├── DNA 摘要（单行）
│   ├── 造型数量
│   └── 生成记录数量
├── ExportActions
│   ├── "导出设定书 PDF" 按钮
│   ├── [generating] → spinner + 进度文字
│   ├── [done] → "打开文件位置" + "重新导出" 按钮
│   └── "验证创作证明" 按钮 + 结果 badge
└── ExportHistoryList
    └── ExportHistoryItem (per record)
        ├── 日期 + 文件大小
        ├── 状态 badge
        └── "下载" 链接
```

### 状态机

```typescript
type ExportWorkspaceState =
  | { phase: "idle" }
  | { phase: "loading-exports" }
  | { phase: "ready"; exports: ExportRecord[] }
  | { phase: "generating"; taskId: string; exportId: string }
  | { phase: "done"; exportId: string; filePath: string }
  | { phase: "error"; message: string };
```

### 前端 API Client — `src/api/exports.ts`

```typescript
export async function submitPdfExport(characterId: string, signal?: AbortSignal): Promise<ExportAcceptedResponse>
export async function fetchExports(characterId: string, signal?: AbortSignal): Promise<ExportListResponse>
export function exportDownloadUrl(exportId: string): string
export async function verifyProofChain(characterId: string, signal?: AbortSignal): Promise<ProofVerifyResponse>
```

### 测试文件

**`src/components/ExportWorkspace.test.tsx`** — 6 个测试：
```
renders export button in idle state
clicking export button shows generating state
done state shows open-file and re-export buttons
export history list renders past exports
verify proof chain shows valid badge
error state shows retry button
```

**`src/api/exports.test.ts`** — 5 个测试：
```
submitPdfExport calls POST and returns accepted response
fetchExports returns list
exportDownloadUrl returns correct URL
verifyProofChain returns verification result
type guard rejects invalid export record
```

---

## 8. M4-E：集成

### App.tsx 变更

**1. 扩展 DetailTab 类型**：

```typescript
type DetailTab = "dataset" | "textToCharacter" | "dna" | "training"
               | "generation" | "voice" | "costume" | "export";
```

**2. 新增 tab 按钮**（在「声音绑定」后）：

```tsx
<button className={`detail-tab-button ${activeTab === "costume" ? "detail-tab-active" : ""}`}
        onClick={() => onSwitchTab("costume")}>造型</button>
<button className={`detail-tab-button ${activeTab === "export" ? "detail-tab-active" : ""}`}
        onClick={() => onSwitchTab("export")}>导出</button>
```

**3. 新增 tab 内容渲染**：

```tsx
{activeTab === "costume" && <CostumeWorkspace characterId={character.id} />}
{activeTab === "export" && <ExportWorkspace characterId={character.id} />}
```

**4. 新增 imports**：

```typescript
import { CostumeWorkspace } from "./components/CostumeWorkspace";
import { ExportWorkspace } from "./components/ExportWorkspace";
```

### GenerationWorkbenchPage 造型选择器更新

现有 workbench contract 已返回所有造型。M4-E 中：
- `CostumeWorkspace` 激活造型时，向上传递 `activeCostumeId`
- `GenerationWorkbenchPage` 接受可选 `activeCostumeId?: string` prop，预选对应造型
- 不需要新 API，复用 workbench contract

### App.tsx 体积控制

当前已 1400+ 行，M4 新组件全部自包含，App.tsx 只增加约 20 行 tab wiring。

### 集成测试 — `backend/tests/test_m4_integration.py`

4 个端到端测试：
```
test_full_costume_flow:
    创建角色 → 创建根造型 → 创建子造型 → 生成预览(mock)
    → 列表显示树结构 → 删除子造型成功 → 删除根造型失败

test_full_export_flow:
    创建角色+DNA → 创建造型+预览 → 提交PDF导出
    → 等待任务完成 → 下载PDF (验证 %PDF header)
    → 列表显示完成记录

test_proof_chain_flow:
    创建角色 → 创建造型(proof记录) → 生成预览(proof记录)
    → 导出PDF(proof记录) → 导出链(3条) → 验证通过

test_costume_activation_updates_workbench:
    创建角色 → 创建2个造型 → 获取workbench合约
    → 验证两个造型都在列表中
```

---

## 9. 测试总览

| 文件 | 预计测试数 |
|------|-----------|
| test_costume_service.py | 18 |
| test_costume_api.py | 13 |
| test_pdf_export.py | 9 |
| test_proof_service.py | 10 |
| test_export_api.py | 7 |
| test_m4_integration.py | 4 |
| CostumeWorkspace.test.tsx | 8 |
| src/api/costumes.test.ts | 5 |
| ExportWorkspace.test.tsx | 6 |
| src/api/exports.test.ts | 5 |
| **新增小计** | **~85** |
| **累计总数（含 M0–M3 的 268）** | **~353** |

---

## 10. 实施时序（天）

```
Day 1:  M4-A (costume service + schemas + migration 0006)  [backend]
Day 1:  M4-C (proof_service + migration 0007)              [backend, 并行]

Day 2:  M4-A (costume API + tests)                         [backend]
Day 2:  M4-C (pdf_export service + reportlab dep)          [backend, 并行]

Day 3:  M4-B (CostumeWorkspace + CostumeTree)              [frontend]
Day 3:  M4-C (export API + tests)                          [backend, 并行]

Day 4:  M4-B (NewCostumeModal + CostumeDetailPanel + tests) [frontend]
Day 4:  M4-D (ExportWorkspace + tests)                     [frontend, 并行]

Day 5:  M4-E (App.tsx wiring + integration tests)          [full-stack]
Day 6:  M4-E (cleanup + final test pass + merge to main)   [full-stack]
```

**关键路径**：M4-A → M4-B → M4-E（4 天）
**并行路径**：M4-C → M4-D → M4-E（4 天，与关键路径完全并行）
**总计**：~6 工作日（含缓冲约 8 天 = W13–W14）

---

## 11. 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| **reportlab 中文字体在不同 OS 上缺失** | PDF 中文乱码 | 高 | 字体查找链（macOS→Linux→Windows→fallback UniGB-UCS2-H）；测试中 mock 字体注册 |
| **造型预览依赖 ComfyUI** | 预览无真实图片 | 中 | 同 M2 模式：mock task 生成 placeholder PNG；真实引擎后续可替换 |
| **树删除边界情况** | 数据不一致 | 中 | 3 条硬规则（不删根/不删有子节点/不删最后一个）；service 层验证+测试；前端 disable 按钮 |
| **PDF 大图内存占用** | 低配机 OOM | 低 | 参考图 max 9 张，造型预览 max 4 张；图片缩放到 max 800px 再嵌入 |
| **App.tsx 过大（已 1400+ 行）** | 开发体验差、merge 冲突 | 高 | M4 新组件全部自包含；App.tsx 只增加 ~20 行；M5 考虑重构为路由模式 |

---

## 12. 新增文件清单

### Backend

```
backend/migrations/0006_creation_timestamps.sql    ← NEW
backend/migrations/0007_exports.sql                 ← NEW
backend/app/schemas/costume.py                      ← NEW
backend/app/schemas/export.py                       ← NEW
backend/app/services/costume_service.py             ← NEW
backend/app/services/pdf_export.py                  ← NEW
backend/app/services/proof_service.py               ← NEW
backend/app/api/costumes.py                         ← NEW
backend/app/api/exports.py                          ← NEW
backend/tests/test_costume_service.py               ← NEW
backend/tests/test_costume_api.py                   ← NEW
backend/tests/test_pdf_export.py                    ← NEW
backend/tests/test_proof_service.py                 ← NEW
backend/tests/test_export_api.py                    ← NEW
backend/tests/test_m4_integration.py                ← NEW
```

### Frontend

```
src/api/costumes.ts                                 ← NEW
src/api/costumes.test.ts                            ← NEW
src/api/exports.ts                                  ← NEW
src/api/exports.test.ts                             ← NEW
src/components/CostumeWorkspace.tsx                 ← NEW
src/components/CostumeWorkspace.test.tsx            ← NEW
src/components/ExportWorkspace.tsx                  ← NEW
src/components/ExportWorkspace.test.tsx             ← NEW
```

### 修改文件

```
backend/pyproject.toml     ← ADD reportlab>=4.2
backend/app/main.py        ← ADD costume + export routers + lifespan wiring
src/App.tsx                ← ADD "costume"/"export" tab union + buttons + content (~20 lines)
```
