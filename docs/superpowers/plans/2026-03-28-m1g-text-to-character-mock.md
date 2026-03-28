# M1G Text-to-Character Mock Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a mock-only front-half flow from text prompt to candidate selection and handoff into existing M1C dataset import flow.

**Architecture:** Add a dedicated `文字创角（Mock）` tab in character detail so the text-to-character flow remains isolated from M1C dataset UI while reusing M1C data ingestion state. Use a strict mock contract for candidate generation and handoff, with explicit Chinese disclaimer that this is not real G1 output.

**Tech Stack:** React + TypeScript + Vitest + Testing Library

---

### Task 1: Define Mock Contract For Text-to-Character

**Files:**
- Create: `src/mocks/textToCharacter.ts`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Add failing test for mock states in the UI**
- [ ] **Step 2: Implement deterministic mock candidate contract (4-8 images, loading/empty/error branches)**
- [ ] **Step 3: Verify tests fail then pass after minimal implementation**

### Task 2: Add Text-to-Character Workspace UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Add new detail tab `textToCharacter` and workspace component**
- [ ] **Step 2: Implement Chinese input prompt, loading, success, empty, error UI states**
- [ ] **Step 3: Implement candidate card selection and confirmation CTA (`加入数据集`)**
- [ ] **Step 4: Add explicit in-page disclaimer: `本轮为 mock 联调，不代表真实 G1 结果`**
- [ ] **Step 5: Keep existing dataset/dna/training tab behavior unchanged**

### Task 3: Wire Handoff Into Existing M1C Dataset Entry

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Convert selected mock candidates into `File[]` and reuse existing dataset preview state**
- [ ] **Step 2: On successful handoff, switch back to dataset tab with success message**
- [ ] **Step 3: Ensure user can continue with existing `开始评估` action (M1C path)**

### Task 4: Cover End-to-End Front-Half Flow With Tests

**Files:**
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add integration test for text input -> generate mock candidates -> select -> add to dataset -> return to dataset tab**
- [ ] **Step 2: Add tests for empty result and failed generation states**
- [ ] **Step 3: Confirm existing test suite still passes (no regression in M1C/M1D/M1F flows)**

### Task 5: Verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run `npm run test:run -- src/App.test.tsx`**
- [ ] **Step 2: Run `npm run test:run`**
- [ ] **Step 3: Run `npm run build`**
- [ ] **Step 4: Confirm final UI/UX copy is Chinese, and all mock disclaimers are visible**

## Finish Criteria

- [ ] User can enter Chinese text description and trigger mock candidate generation.
- [ ] UI renders 4-8 mock candidate cards on success.
- [ ] User can select candidates and confirm `加入数据集`.
- [ ] Handoff returns to existing M1C dataset import tab with selected images preloaded.
- [ ] Empty/loading/success/error states are all present with natural Chinese copy.
- [ ] Tests validate behavior (not static shell only).
- [ ] UI clearly states this is mock-only, not real G1 output.
