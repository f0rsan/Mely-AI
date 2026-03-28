# M1D DNA + WD14 Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成角色 DNA 手动配置、建议值合同、auto prompt 预览与保存链，并在条件具备时接上 WD14 自动打标。

**Architecture:** 在现有 `characters` 数据模型上新增“DNA 更新接口 + 建议值接口”，让前端可读取建议值、编辑五项字段并保存。WD14 作为可选来源挂在建议值管线中，不可用时返回明确占位状态并保持页面可用。

**Tech Stack:** React + TypeScript（Vite/Vitest）, FastAPI + Pydantic + SQLite（Pytest）

---

### Task 1: 后端 DNA 保存链与建议值合同（含 WD14 占位）

**Files:**
- Modify: `backend/app/schemas/characters.py`
- Modify: `backend/app/services/characters.py`
- Modify: `backend/app/api/characters.py`
- Add: `backend/app/services/dna_suggestions.py`
- Modify: `backend/tests/test_characters_api.py`

- [ ] **Step 1: 先写失败测试（DNA 更新 + 建议值接口 + WD14 不可用占位）**

```bash
pytest -q backend/tests/test_characters_api.py -k "dna or suggestion"
```

- [ ] **Step 2: 新增 DNA 更新请求与建议值响应 schema，保持字段命名兼容现有接口**

```python
# CharacterDNAUpdateRequest + CharacterDNASuggestionResponse
```

- [ ] **Step 3: 在 service 层实现 DNA upsert、auto_prompt 组装、建议值生成与 WD14 可用性检测**

```python
def build_auto_prompt(...)
def get_dna_suggestions(...)
def upsert_character_dna(...)
```

- [ ] **Step 4: 暴露 API**

```python
# PUT /api/characters/{id}/dna
# GET /api/characters/{id}/dna/suggestions
```

- [ ] **Step 5: 运行后端测试并确认通过**

```bash
pytest -q backend/tests/test_characters_api.py
pytest -q backend/tests
```

### Task 2: 前端 DNA 工作区（编辑、建议值预填、prompt 预览、保存）

**Files:**
- Add: `src/api/characterDetail.ts`
- Add: `src/api/dna.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: 先写失败测试（打开角色后可见 DNA 表单、建议值可填充、可保存）**

```bash
npm run test:run -- src/App.test.tsx
```

- [ ] **Step 2: 新增前端 API 客户端（角色详情、DNA 建议值、DNA 保存）与类型守卫**

```typescript
fetchCharacterDetail(...)
fetchDnaSuggestions(...)
saveCharacterDna(...)
```

- [ ] **Step 3: 在角色详情页加入 DNA 面板**

```tsx
// 5字段表单 + 建议值来源提示 + auto prompt 预览 + 保存按钮
```

- [ ] **Step 4: 加入样式与移动端适配，保证 WD14 不可用时仍有清晰提示**

```css
/* dna-panel, dna-grid, dna-source, dna-prompt, dna-save */
```

- [ ] **Step 5: 运行前端测试并确认通过**

```bash
npm run test:run -- src/App.test.tsx src/api/*.test.ts
```

### Task 3: 全链路验证与回填材料

**Files:**
- Modify: `docs/M1_BUS_BOARD.md`（仅在需要同步约定时）
- Optional: `docs/DECISIONS.md`（若补充 WD14 状态说明）

- [ ] **Step 1: 运行完整验证命令，确认前后端关键测试都通过**

```bash
pytest -q backend/tests
npm run test:run
```

- [ ] **Step 2: 手动核对“WD14 可用/不可用”两种响应路径文案与稳定性**

```text
不可用：source=manual_default + wd14.available=false + reason
可用：source=wd14/mixed + fields 含建议值
```

- [ ] **Step 3: 输出交付清单（接口、数据合同、页面行为、风险）供 M1E/M1F/M1H 复用**

```text
严格按 M1_BUS_BOARD 的 7 项格式回填
```
