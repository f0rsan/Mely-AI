# Automatic Memory Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, non-blocking post-reply flow that extracts up to two durable memories from recent chat and stores them in the existing memory table.

**Architecture:** Keep chat generation unchanged until the assistant reply is saved. After that save succeeds, start a best-effort background extraction task that uses the existing Ollama chat path, filters candidates in code, and inserts only accepted memories into `character_memories`.

**Tech Stack:** FastAPI, Python 3.11, SQLite, existing Ollama service, pytest

---

### Task 1: Lock Behavior With Tests

**Files:**
- Create: `backend/tests/test_memory_extraction_service.py`
- Modify: `backend/tests/test_chat.py`

- [ ] Add service-level tests that cover accepted extraction, empty extraction, duplicate skipping, and source field persistence.
- [ ] Add chat-level tests that prove extraction failure does not break the main chat response.
- [ ] Run the new targeted tests first and confirm they fail for the expected missing behavior.

### Task 2: Add Minimal Extraction Service

**Files:**
- Create: `backend/app/services/memory_extraction_service.py`

- [ ] Add a focused service that builds the extraction prompt, calls Ollama, parses JSON, filters candidates, and writes accepted rows.
- [ ] Reuse the existing schema constraints and database table instead of introducing new storage.
- [ ] Keep database writes self-contained in the service so chat only triggers it.

### Task 3: Trigger Extraction After Reply Save

**Files:**
- Modify: `backend/app/services/chat_service.py`

- [ ] Start extraction only after the assistant reply is successfully saved.
- [ ] Run extraction as best-effort background work so the `done` SSE event is not blocked.
- [ ] Keep extraction failures in logs only; do not change user-visible chat success behavior.

### Task 4: Verify End-to-End

**Files:**
- Verify only

- [ ] Run the focused backend test files and confirm they pass.
- [ ] Run a real sample extraction against representative conversation data and inspect the inserted memory row.
- [ ] Confirm the new memory is picked up by prompt assembly in a follow-up chat turn.
