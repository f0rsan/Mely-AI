# M1 LLM Training Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current placeholder LLM fine-tuning executor with a real subprocess-based Unsloth pipeline, wire base-model selection through the product, and verify the full text-first training chain on the current RTX 5060 16GB machine without losing the RTX 3070 8GB product baseline.

**Architecture:** FastAPI remains the coordinator and state owner. Actual model fine-tuning runs in an isolated Python subprocess that communicates with the parent process through line-delimited JSON on stdout. The parent process persists training state, handles cancellation and recovery, and hands completed GGUF outputs to the existing Ollama registration service.

**Tech Stack:** FastAPI, SQLite, TaskQueue, Ollama, Unsloth QLoRA, asyncio subprocess, React, TypeScript, pytest, Vitest

---

## Planning Assumptions

1. **Current development / validation machine:** RTX 5060 16GB.
2. **Current product baseline remains:** RTX 3070 8GB, because `docs/PROJECT_CONTEXT.md` and `docs/FEATURE_SPEC.md` still use that as the release target.
3. **Resulting rule:** verification must be split into:
   - current-machine bring-up on RTX 5060 16GB
   - baseline compatibility verification for RTX 3070 8GB
4. **Do not tune defaults purely for 16GB** unless product docs are explicitly updated. If a setting only works comfortably on 16GB, mark it as a non-default override.
5. **Registration failure policy:** if GGUF export succeeds but Ollama registration fails, training job may be marked complete while the `llm_models` record stays `pending`; the UI must surface that state clearly.

## File Map

**Create**
- `backend/app/services/llm_base_models.py` — training-compatible base-model catalog, Ollama tag to HuggingFace model mapping, per-model defaults, per-model safety checks
- `backend/app/services/unsloth_worker.py` — isolated Unsloth subprocess entrypoint, JSON protocol, checkpoint / export / cancel handling
- `backend/tests/test_llm_base_models.py` — base-model mapping and precheck coverage
- `backend/tests/test_llm_training_runner.py` — subprocess protocol parsing, completion, cancellation, recovery, registration handoff
- `docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md` — this plan

**Modify**
- `backend/app/services/llm_training.py` — replace stub executor with real subprocess orchestration, add recovery
- `backend/app/main.py` — pass `data_root` and `llm_model_service` into the LLM training service, call startup recovery
- `backend/app/api/llm_training.py` — keep contract stable, tighten validation if needed
- `backend/pyproject.toml` — add optional GPU dependency group for Unsloth / Torch / Transformers / TRL
- `src/components/LLMTrainingPanel.tsx` — base model selector, richer progress fields, clearer registration-pending copy
- `src/components/LLMTrainingPanel.test.tsx` — UI coverage for model selection and richer progress display
- `src/api/llmTraining.ts` — only if request / response shape needs small additions
- `docs/PROJECT_CONTEXT.md` — update only if product-level hardware policy is intentionally changed
- `docs/FEATURE_SPEC.md` — update only if product-level hardware policy is intentionally changed

## Scope Guardrails

- Keep the worker single-purpose: one process per training job.
- Do not move Unsloth imports into the main FastAPI process.
- Do not add a second model registry system; reuse the current Ollama model lifecycle.
- Do not convert the product baseline from 3070 8GB to 5060 16GB unless product docs are explicitly re-approved.

## Task 0: Dependency Isolation And Runtime Contract

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_setup.py`

- [ ] Add an optional dependency group for GPU training libraries instead of mixing them into the base backend install.
- [ ] Keep FastAPI bootable when the GPU training extras are absent.
- [ ] Add one setup-path assertion proving the backend can still start in a non-GPU environment.
- [ ] Define the runtime contract in code comments: missing GPU extras should fail at training start with a Chinese error, not at app import time.

**Verification**
- Run: `pytest -q backend/tests/test_setup.py`
- Expected: backend startup still passes without Unsloth installed

**Exit criteria**
- Base backend install remains lightweight.
- Missing Unsloth dependencies no longer risk crashing the API process during import.

## Task 1: Base Model Mapping And Preflight Validation

**Files:**
- Create: `backend/app/services/llm_base_models.py`
- Modify: `backend/app/services/llm_training.py`
- Test: `backend/tests/test_llm_base_models.py`
- Test: `backend/tests/test_llm_training.py`

- [ ] Add a single source of truth for trainable LLM base models.
- [ ] Map each supported Ollama tag to:
  - HuggingFace model id
  - default LoRA rank
  - max sequence length
  - dtype / quantization expectation
  - safe defaults for 16GB bring-up and 8GB baseline
- [ ] In `start_training()`, validate that:
  - the requested base model is supported for training
  - the model is already available in Ollama
  - the selected mode is allowed under the current VRAM policy
- [ ] Return clear Chinese errors for:
  - unsupported training model
  - model not downloaded
  - mode exceeds current hardware policy

**Verification**
- Run: `pytest -q backend/tests/test_llm_base_models.py backend/tests/test_llm_training.py`
- Expected: unsupported / missing-model cases return explicit Chinese failures

**Exit criteria**
- Training start no longer accepts arbitrary model names.
- The plan now has a stable bridge from product model choice to real training config.

## Task 2: Unsloth Worker Process

**Files:**
- Create: `backend/app/services/unsloth_worker.py`
- Test: `backend/tests/test_llm_training_runner.py`

- [ ] Build a standalone worker entrypoint that reads one JSON config payload from stdin or argv path.
- [ ] Define the worker protocol:
  - `progress`
  - `status`
  - `complete`
  - `error`
- [ ] Redirect stderr into a persistent job log file so worker crashes remain diagnosable without leaking raw tracebacks to users.
- [ ] Save checkpoints every 100 steps.
- [ ] Support cancellation using a **cancel sentinel file or cancel flag check**, not only POSIX signal semantics. This keeps cancellation behavior consistent on Windows.
- [ ] Export GGUF with `q4_k_m` after successful training.
- [ ] Emit a final `complete` event containing adapter and GGUF paths.

**Verification**
- Run focused protocol tests with mocked worker IO.
- Run a local dry-run mode that validates config parsing without loading Unsloth.

**Exit criteria**
- A worker process can succeed, fail, and cancel without bringing down the API process.
- Protocol output is line-delimited JSON only.

## Task 3: Replace The Stub Runner In LLM Training Service

**Files:**
- Modify: `backend/app/services/llm_training.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_llm_training_runner.py`
- Test: `backend/tests/test_llm_training.py`

- [ ] Replace `_build_runner()` placeholder logic with real subprocess orchestration.
- [ ] Inject `data_root` and `llm_model_service` into the training service constructor.
- [ ] Build the worker config from:
  - character id
  - training mode
  - mapped base model
  - resolved dataset paths
  - output directories
  - checkpoint directory
- [ ] Read stdout line-by-line and update:
  - status
  - progress
  - current step
  - total steps
  - loss
  - eta
- [ ] Read stderr or merged logs without risking pipe blockage.
- [ ] On cancellation request, terminate the worker and record a user-friendly cancellation outcome.
- [ ] On worker failure, translate the failure into stable Chinese errors:
  - out of memory
  - dependency missing
  - export failed
  - unknown worker crash

**Verification**
- Run: `pytest -q backend/tests/test_llm_training.py backend/tests/test_llm_training_runner.py`
- Expected: job lifecycle covers queued → preparing → training → exporting → registering / completed / failed / canceled

**Exit criteria**
- The current stub path is gone.
- LLM training jobs can now drive real work through the queue system.

## Task 4: Automatic Model Registration Handoff

**Files:**
- Modify: `backend/app/services/llm_training.py`
- Modify: `backend/app/services/llm_model_service.py` (only if small status-handling adjustments are needed)
- Test: `backend/tests/test_llm_models.py`
- Test: `backend/tests/test_llm_training_runner.py`

- [ ] After a successful worker `complete` event, call `LLMModelService.register_model()`.
- [ ] Persist the exported GGUF path and final loss into the training job before registration.
- [ ] If registration succeeds:
  - mark training job `completed`
  - create `llm_models` row as `ready`
- [ ] If registration fails but GGUF exists:
  - mark training job `completed`
  - keep `llm_models` row as `pending`
  - keep a clear warning message for UI display
- [ ] If GGUF export itself failed:
  - mark training job `failed`
  - do not create a ready model record

**Verification**
- Run: `pytest -q backend/tests/test_llm_models.py backend/tests/test_llm_training_runner.py`
- Expected: registration success and registration-pending cases are both covered

**Exit criteria**
- The exported model can move directly into the existing private-model list.

## Task 5: Startup Recovery For Interrupted Jobs

**Files:**
- Modify: `backend/app/services/llm_training.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_llm_training_runner.py`

- [ ] Add `recover_interrupted_jobs()` to sweep jobs left in:
  - `preparing`
  - `training`
  - `exporting`
  - `registering`
- [ ] On app startup, mark those jobs as failed with a Chinese message explaining that the app or training process was interrupted.
- [ ] Do not touch already terminal jobs.

**Verification**
- Run recovery test coverage.
- Expected: interrupted jobs become visible failed records instead of permanent hanging states

**Exit criteria**
- Restarting the app no longer leaves ghost training jobs in active states forever.

## Task 6: Frontend Base Model Selection And Richer Progress

**Files:**
- Modify: `src/components/LLMTrainingPanel.tsx`
- Modify: `src/components/LLMTrainingPanel.test.tsx`
- Modify: `src/api/llmTraining.ts` only if strictly needed

- [ ] Add a base-model selector to the training panel.
- [ ] Populate it from the known training-compatible model list; short-term hardcoding is acceptable if it reuses the same source-of-truth names as backend validation.
- [ ] Default selection should follow:
  - character default base model, if training-compatible
  - otherwise the global text default
- [ ] Include a visible note when a model is available for chat but not for training.
- [ ] Expand active job cards to show:
  - step count
  - loss
  - ETA
  - registration-pending warning when relevant

**Verification**
- Run: `npm run test:run -- src/components/LLMTrainingPanel.test.tsx`
- Expected: model selection and richer progress states render correctly

**Exit criteria**
- “Choose model + choose dataset + start training” becomes a real user-visible path, not a partial API capability.

## Task 7: Current-Machine Bring-Up On RTX 5060 16GB

**Files:**
- Modify only if issues are found during validation
- Reference: `backend/scripts/validate_llm_pipeline.py`

- [ ] Verify Ollama runtime is running and base model is downloaded.
- [ ] Install the GPU training dependency group.
- [ ] Run the smallest end-to-end training loop on the actual RTX 5060 16GB machine.
- [ ] Validate:
  - worker boots correctly
  - progress events stream correctly
  - cancellation works
  - GGUF exports
  - Ollama registration succeeds
  - the resulting model can answer a test chat
- [ ] Record peak VRAM, total wall-clock time, and any parameter overrides needed on this machine.

**Verification**
- Run current-machine end-to-end once for `light`, once for `standard`, then optionally `fine`

**Exit criteria**
- The real executor is proven on the actual development box.
- Any machine-specific launch issues are fixed before 8GB baseline tuning starts.

## Task 8: Preserve Or Reconfirm The RTX 3070 8GB Product Baseline

**Files:**
- Modify: `backend/app/services/llm_base_models.py` only if parameter fallback changes are required
- Modify: `docs/PROJECT_CONTEXT.md` only if the product target is intentionally changed
- Modify: `docs/FEATURE_SPEC.md` only if the product target is intentionally changed

- [ ] Decide explicitly whether 3070 8GB remains the release baseline.
- [ ] If **yes**, run or schedule separate compatibility validation against the 8GB baseline and keep shipping defaults 8GB-safe.
- [ ] If **no**, update product docs before changing default training parameters or user-facing promises.
- [ ] Keep two records:
  - current-machine verification (5060 16GB)
  - release-baseline verification (3070 8GB or revised target)

**Verification**
- Document one of two outcomes:
  - `3070 baseline preserved; defaults remain 8GB-safe`
  - `product baseline changed; docs updated intentionally`

**Exit criteria**
- Hardware policy is no longer implicit.
- Release defaults and validation evidence point at the same machine target.

## Recommended Execution Order

1. Task 0
2. Task 1 and Task 6 in parallel
3. Task 2
4. Task 3
5. Task 4 and Task 5 in parallel
6. Task 7
7. Task 8

## Key Risks To Watch

- **Windows cancellation semantics:** `terminate()` is not the same as a graceful POSIX SIGTERM flow; use a worker-visible cancel flag or sentinel file.
- **Dependency matrix drift:** Unsloth / Torch / CUDA versions must stay isolated from the base backend install.
- **Training defaults drifting toward 16GB-only settings:** keep release defaults tied to the product baseline until docs are intentionally changed.
- **Packaged path resolution:** Tauri sidecar packaging must resolve the worker module path and any checkpoint / export directories reliably in packaged builds.
- **Registration ambiguity:** if training succeeded but registration failed, the UI must make that state obvious instead of looking “done and missing.”

## Success Definition

- The placeholder executor is fully replaced.
- A user can choose a dataset, choose a base model, start training, watch progress, cancel if needed, and receive a usable or retryable model outcome.
- The chain is proven on the real RTX 5060 16GB machine.
- Product baseline policy is explicitly preserved or explicitly changed, not left ambiguous.

## Recommended First Slice

- Start with **Task 0 + Task 1 + Task 6**.
- That gives the team:
  - a stable dependency boundary
  - a real training start gate
  - a real UI path for model selection
- Then move into the worker and runner once the contract is frozen.

## Notes Compared With The Previous Draft

- The previous “T7 = RTX 3070 8GB true-machine validation” step is now split.
- RTX 5060 16GB is treated as the **actual current machine**, not the release baseline by default.
- Cancellation is adjusted away from a signal-only design so Windows behavior stays predictable.
- Dependency isolation is raised to its own explicit task because the current environment does not yet have the required Unsloth stack installed.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-13-m1-llm-training-executor.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
