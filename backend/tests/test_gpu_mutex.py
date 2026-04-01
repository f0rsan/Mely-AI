"""Tests for the shared GPU mutex guard."""
from __future__ import annotations

import pytest

from app.services.gpu_mutex import EngineGpuMutexError, check_gpu_exclusive
from app.services.task_queue import TaskQueue


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeTask:
    def __init__(self, name: str, status: str) -> None:
        self.name = name
        self.status = status


class _FakeQueue:
    def __init__(self, tasks: list[_FakeTask]) -> None:
        self._tasks = tasks

    def list(self):
        return list(self._tasks)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_no_running_tasks():
    queue = _FakeQueue([])
    check_gpu_exclusive(queue)  # must not raise


def test_running_non_exclusive_task():
    queue = _FakeQueue([_FakeTask("other-task", "running")])
    check_gpu_exclusive(queue)  # must not raise


def test_running_training_task():
    queue = _FakeQueue([_FakeTask("training-char1", "running")])
    with pytest.raises(EngineGpuMutexError):
        check_gpu_exclusive(queue)


def test_running_generation_task():
    queue = _FakeQueue([_FakeTask("generation-char1", "running")])
    with pytest.raises(EngineGpuMutexError):
        check_gpu_exclusive(queue)


def test_running_tts_task():
    queue = _FakeQueue([_FakeTask("tts-char1", "running")])
    with pytest.raises(EngineGpuMutexError):
        check_gpu_exclusive(queue)


def test_completed_exclusive_task():
    queue = _FakeQueue([_FakeTask("training-char1", "completed")])
    check_gpu_exclusive(queue)  # completed task must not raise
