"""Tests for TTSRuntime service.

All tests use FakeProcessLauncher + FakeHttpClient to avoid spawning real processes.
Timing constants are overridden to near-zero so async loops complete fast.
"""
from __future__ import annotations

import asyncio
import subprocess
from typing import Sequence
from unittest.mock import MagicMock

import pytest

from app.services.gpu_mutex import EngineGpuMutexError
from app.services.task_queue import TaskQueue
from app.services.tts_runtime import TTSRuntime


# ---------------------------------------------------------------------------
# Fakes (mirrors test_engine_runtime.py pattern)
# ---------------------------------------------------------------------------


class FakeProcess:
    """Mimics subprocess.Popen[bytes] just enough for the runtime."""

    pid: int = 7777

    def __init__(self) -> None:
        self._returncode: int | None = None
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        return self._returncode

    def wait(self) -> int:
        return self._returncode or 0

    def terminate(self) -> None:
        self.terminated = True
        self._returncode = -15

    def kill(self) -> None:
        self.killed = True
        self._returncode = -9

    def exit_with(self, code: int = 1) -> None:
        """Simulate process crash."""
        self._returncode = code


class FakeProcessLauncher:
    """Returns a new FakeProcess on each launch() call."""

    def __init__(self) -> None:
        self.launched: list[FakeProcess] = []

    def launch(self, cmd: list[str], **kwargs) -> FakeProcess:  # type: ignore[override]
        proc = FakeProcess()
        self.launched.append(proc)
        return proc

    @property
    def last(self) -> FakeProcess:
        return self.launched[-1]


class FakeHttpClient:
    """Replays a predefined sequence of ping results."""

    def __init__(self, responses: Sequence[bool]) -> None:
        self._responses = list(responses)
        self._index = 0

    async def get(self, url: str, *, timeout: float = 2.0) -> MagicMock:  # type: ignore[override]
        if self._index >= len(self._responses):
            result = True
        else:
            result = self._responses[self._index]
            self._index += 1

        if not result:
            raise ConnectionRefusedError("fake connection refused")
        resp = MagicMock()
        resp.status_code = 200
        return resp

    async def aclose(self) -> None:
        pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FAST = dict(
    health_check_timeout_s=0.01,
    health_poll_interval_s=0.01,
    startup_timeout_s=0.5,
    backoff_base_s=0.01,
)


def make_runtime(
    responses: Sequence[bool] | None = None,
    *,
    task_queue: TaskQueue | None = None,
) -> tuple[TTSRuntime, FakeProcessLauncher, TaskQueue]:
    launcher = FakeProcessLauncher()
    queue = task_queue or TaskQueue()
    http_client = FakeHttpClient(responses if responses is not None else [True] * 100)
    runtime = TTSRuntime(
        task_queue=queue,
        launcher=launcher,
        tts_cmd=["fake-f5-tts"],
        http_client=http_client,
        **FAST,
    )
    return runtime, launcher, queue


async def start_and_wait_running(runtime: TTSRuntime, timeout: float = 2.0) -> None:
    await runtime.start()
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if runtime.get_status().state == "running":
            return
        await asyncio.sleep(0.02)
    raise TimeoutError("TTSRuntime did not reach 'running' within timeout")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_success():
    """Fake launcher + fake http client that returns healthy → status becomes running."""
    runtime, launcher, _ = make_runtime(responses=[True] * 50)
    await runtime.start()

    # Immediately after start(), state should be 'starting'.
    assert runtime.get_status().state == "starting"
    assert len(launcher.launched) == 1

    await start_and_wait_running(runtime)
    status = runtime.get_status()
    assert status.state == "running"
    assert status.pid == 7777

    await runtime.stop()


@pytest.mark.asyncio
async def test_start_timeout():
    """Health check never returns healthy → status becomes failed."""
    runtime, _, _ = make_runtime(responses=[False] * 500)

    await runtime.start()

    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        if runtime.get_status().state == "failed":
            break
        await asyncio.sleep(0.05)

    assert runtime.get_status().state == "failed"


@pytest.mark.asyncio
async def test_stop_running_runtime():
    """Start then stop → status becomes stopped."""
    runtime, launcher, _ = make_runtime(responses=[True] * 50)
    await start_and_wait_running(runtime)

    await runtime.stop()

    status = runtime.get_status()
    assert status.state == "stopped"
    assert status.pid is None
    assert launcher.last.terminated


@pytest.mark.asyncio
async def test_gpu_mutex_blocks_start():
    """task_queue has a running generation-xyz task → start() raises EngineGpuMutexError."""
    runtime, _, queue = make_runtime()
    await queue.start()

    async def long_runner(progress):
        await asyncio.sleep(10)

    await queue.submit(name="generation-xyz", runner=long_runner)
    # Give the worker a moment to pick up the task.
    await asyncio.sleep(0.05)

    with pytest.raises(EngineGpuMutexError):
        await runtime.start()

    assert runtime.get_status().state == "stopped"

    await queue.stop()


@pytest.mark.asyncio
async def test_restart_on_crash():
    """Process crashes (exits), runtime detects and restarts up to MAX_RESTARTS."""
    runtime, launcher, _ = make_runtime(responses=[True] * 200)
    await start_and_wait_running(runtime)

    # Simulate process crash while running.
    launcher.last.exit_with(1)

    # Wait until restart_count becomes positive (crash was detected and handled).
    deadline = asyncio.get_event_loop().time() + 3.0
    while asyncio.get_event_loop().time() < deadline:
        if runtime.get_status().restart_count >= 1:
            break
        await asyncio.sleep(0.02)

    assert runtime.get_status().restart_count >= 1

    await runtime.stop()
