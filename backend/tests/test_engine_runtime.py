"""Tests for ComfyUIRuntime service.

All tests use FakeProcessLauncher + FakeHttpClient to avoid spawning real processes.
Timing constants are overridden to near-zero so async loops complete fast.
"""
from __future__ import annotations

import asyncio
import subprocess
from typing import Sequence
from unittest.mock import MagicMock

import pytest

from app.services.engine_runtime import (
    ComfyUIRuntime,
    EngineGpuMutexError,
)
from app.services.task_queue import TaskQueue


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeProcess:
    """Mimics subprocess.Popen[bytes] just enough for the runtime."""

    pid: int = 9999

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
            # Default: keep returning True once sequence exhausted.
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
) -> tuple[ComfyUIRuntime, FakeProcessLauncher, TaskQueue]:
    launcher = FakeProcessLauncher()
    queue = task_queue or TaskQueue()
    http_client = FakeHttpClient(responses if responses is not None else [True] * 100)
    runtime = ComfyUIRuntime(
        task_queue=queue,
        launcher=launcher,
        comfyui_cmd=["fake-comfyui"],
        http_client=http_client,
        **FAST,
    )
    return runtime, launcher, queue


async def start_and_wait_running(runtime: ComfyUIRuntime, timeout: float = 2.0) -> None:
    await runtime.start()
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if runtime.get_status().state == "running":
            return
        await asyncio.sleep(0.02)
    raise TimeoutError("runtime did not reach 'running' within timeout")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initial_state_is_stopped():
    runtime, _, _ = make_runtime()
    status = runtime.get_status()
    assert status.state == "stopped"
    assert status.restart_count == 0
    assert status.error_message is None
    assert status.pid is None


@pytest.mark.asyncio
async def test_start_transitions_to_starting_then_running():
    runtime, launcher, _ = make_runtime(responses=[True] * 50)
    await runtime.start()

    # Immediately after start(), state should be 'starting' (process launched).
    assert runtime.get_status().state == "starting"
    assert len(launcher.launched) == 1

    await start_and_wait_running(runtime)
    status = runtime.get_status()
    assert status.state == "running"
    assert status.pid == 9999

    await runtime.stop()


@pytest.mark.asyncio
async def test_start_is_idempotent_when_running():
    runtime, launcher, _ = make_runtime(responses=[True] * 50)
    await start_and_wait_running(runtime)

    await runtime.start()  # second call — should be a no-op
    assert len(launcher.launched) == 1  # still only one process

    await runtime.stop()


@pytest.mark.asyncio
async def test_stop_from_running_transitions_to_stopped():
    runtime, launcher, _ = make_runtime(responses=[True] * 50)
    await start_and_wait_running(runtime)

    await runtime.stop()

    status = runtime.get_status()
    assert status.state == "stopped"
    assert status.pid is None
    assert launcher.last.terminated


@pytest.mark.asyncio
async def test_crash_triggers_restart():
    """Process exits immediately after startup → restart_count must increase."""
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


@pytest.mark.asyncio
async def test_three_crashes_reach_failed_state():
    """After MAX_RESTARTS+1 crashes the runtime must enter 'failed'."""
    launcher = FakeProcessLauncher()
    queue = TaskQueue()

    # All pings succeed so health check passes each time;
    # processes die immediately after being declared running.
    ping_responses = [True] * 200
    http_client = FakeHttpClient(ping_responses)

    runtime = ComfyUIRuntime(
        task_queue=queue,
        launcher=launcher,
        comfyui_cmd=["fake-comfyui"],
        http_client=http_client,
        **FAST,
    )

    await runtime.start()

    # Crash each process shortly after it starts.
    async def crash_loop():
        for _ in range(10):
            await asyncio.sleep(0.05)
            if launcher.launched:
                launcher.last.exit_with(1)

    crash_task = asyncio.create_task(crash_loop())

    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        state = runtime.get_status().state
        if state == "failed":
            break
        await asyncio.sleep(0.05)

    await crash_task

    status = runtime.get_status()
    assert status.state == "failed"
    assert status.restart_count > runtime.MAX_RESTARTS
    assert status.error_message is not None
    assert "崩溃" in status.error_message  # Chinese message present


@pytest.mark.asyncio
async def test_gpu_mutex_blocks_start_when_training_is_running():
    runtime, _, queue = make_runtime()
    await queue.start()

    async def long_runner(progress):
        await asyncio.sleep(10)

    await queue.submit(name="training-lora-abc", runner=long_runner)
    # Give the worker a moment to pick up the task.
    await asyncio.sleep(0.05)

    with pytest.raises(EngineGpuMutexError) as exc_info:
        await runtime.start()

    assert "训练任务" in str(exc_info.value)
    assert runtime.get_status().state == "stopped"

    await queue.stop()


@pytest.mark.asyncio
async def test_gpu_mutex_allows_start_when_training_is_not_running():
    runtime, _, queue = make_runtime(responses=[True] * 50)
    await queue.start()

    async def quick_runner(progress):
        pass

    task = await queue.submit(name="training-lora-xyz", runner=quick_runner)
    # Wait for the task to complete.
    deadline = asyncio.get_event_loop().time() + 2.0
    while asyncio.get_event_loop().time() < deadline:
        snap = queue.get(task.id)
        if snap and snap.status == "completed":
            break
        await asyncio.sleep(0.02)

    # Completed training should not block start.
    await runtime.start()
    await start_and_wait_running(runtime)
    assert runtime.get_status().state == "running"

    await runtime.stop()
    await queue.stop()


@pytest.mark.asyncio
async def test_failed_state_blocks_restart_attempt():
    """Once failed, calling start() again must be a no-op (state stays 'failed')."""
    # Use enough False responses to cover all startup retries:
    # MAX_RESTARTS=3 → 4 health-wait phases × ~50 pings each = ~200. Use 500 to be safe.
    runtime, launcher, _ = make_runtime(responses=[False] * 500)

    await runtime.start()

    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        if runtime.get_status().state == "failed":
            break
        await asyncio.sleep(0.05)

    assert runtime.get_status().state == "failed"

    await runtime.start()  # must be no-op since state is 'failed'
    # failed state is a terminal state — start() should not change it
    assert runtime.get_status().state == "failed"
    # Only the initial process was launched (no re-launch on failed)
    # (restart attempts are internal; the external start() call is rejected)
