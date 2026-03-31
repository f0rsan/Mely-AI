from __future__ import annotations

import asyncio
import subprocess
from typing import TYPE_CHECKING, Protocol, runtime_checkable

import httpx

from app.schemas.engine import EngineState, EngineStatus

if TYPE_CHECKING:
    from app.services.task_queue import TaskQueue

TRAINING_TASK_PREFIX = "training-"

_DEFAULT_COMFYUI_CMD = [
    "python",
    "ComfyUI/main.py",
    "--listen",
    "127.0.0.1",
    "--port",
    "8188",
    "--headless",
]


class EngineGpuMutexError(Exception):
    """Raised when a training task holds the GPU and ComfyUI cannot start."""


@runtime_checkable
class ProcessLauncher(Protocol):
    def launch(
        self, cmd: list[str], **kwargs
    ) -> subprocess.Popen[bytes]: ...  # pragma: no cover


class DefaultProcessLauncher:
    def launch(self, cmd: list[str], **kwargs) -> subprocess.Popen[bytes]:
        return subprocess.Popen(cmd, **kwargs)  # pragma: no cover


class ComfyUIRuntime:
    MAX_RESTARTS: int = 3
    HEALTH_CHECK_URL: str = "http://127.0.0.1:8188/"
    HEALTH_CHECK_TIMEOUT_S: float = 2.0
    HEALTH_POLL_INTERVAL_S: float = 1.0
    STARTUP_TIMEOUT_S: float = 30.0
    BACKOFF_BASE_S: float = 2.0
    # Consecutive ping failures before declaring a crash during run-phase monitoring.
    PING_FAILURE_THRESHOLD: int = 3

    def __init__(
        self,
        task_queue: TaskQueue,
        launcher: ProcessLauncher | None = None,
        comfyui_cmd: list[str] | None = None,
        http_client: httpx.AsyncClient | None = None,
        *,
        health_check_timeout_s: float | None = None,
        health_poll_interval_s: float | None = None,
        startup_timeout_s: float | None = None,
        backoff_base_s: float | None = None,
    ) -> None:
        self._task_queue = task_queue
        self._launcher: ProcessLauncher = launcher or DefaultProcessLauncher()
        self._comfyui_cmd: list[str] = comfyui_cmd or _DEFAULT_COMFYUI_CMD
        self._http_client = http_client

        # Allow tests to override timing constants via constructor.
        if health_check_timeout_s is not None:
            self.HEALTH_CHECK_TIMEOUT_S = health_check_timeout_s
        if health_poll_interval_s is not None:
            self.HEALTH_POLL_INTERVAL_S = health_poll_interval_s
        if startup_timeout_s is not None:
            self.STARTUP_TIMEOUT_S = startup_timeout_s
        if backoff_base_s is not None:
            self.BACKOFF_BASE_S = backoff_base_s

        self._state: EngineState = "stopped"
        self._restart_count: int = 0
        self._error_message: str | None = None
        self._process: subprocess.Popen[bytes] | None = None
        self._monitor_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        async with self._lock:
            # Only start from a clean stopped state; failed requires stop() first.
            if self._state != "stopped":
                return

            self._check_gpu_mutex()

            self._state = "starting"
            self._error_message = None
            self._process = self._launcher.launch(
                self._comfyui_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        self._monitor_task = asyncio.create_task(self._monitor_loop())

    async def stop(self) -> None:
        if self._monitor_task is not None and not self._monitor_task.done():
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        self._monitor_task = None

        async with self._lock:
            await self._terminate_process()
            self._state = "stopped"

    def get_status(self) -> EngineStatus:
        pid: int | None = None
        if self._process is not None and self._process.poll() is None:
            pid = self._process.pid
        return EngineStatus(
            state=self._state,
            restartCount=self._restart_count,
            errorMessage=self._error_message,
            pid=pid,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_gpu_mutex(self) -> None:
        for task in self._task_queue.list():
            if task.name.startswith(TRAINING_TASK_PREFIX) and task.status == "running":
                raise EngineGpuMutexError(
                    "训练任务正在运行中，无法启动图像引擎，请等待训练完成后再试"
                )

    async def _terminate_process(self) -> None:
        if self._process is None:
            return
        if self._process.poll() is not None:
            self._process = None
            return
        self._process.terminate()
        try:
            await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(None, self._process.wait),
                timeout=5.0,
            )
        except asyncio.TimeoutError:
            self._process.kill()
        self._process = None

    async def _ping(self) -> bool:
        client = self._http_client
        own_client = False
        if client is None:
            client = httpx.AsyncClient()
            own_client = True
        try:
            resp = await client.get(
                self.HEALTH_CHECK_URL,
                timeout=self.HEALTH_CHECK_TIMEOUT_S,
            )
            return resp.status_code < 500
        except Exception:
            return False
        finally:
            if own_client:
                await client.aclose()

    async def _wait_for_healthy(self) -> bool:
        """Poll until the engine responds or startup times out. Returns True on success."""
        deadline = asyncio.get_event_loop().time() + self.STARTUP_TIMEOUT_S
        while asyncio.get_event_loop().time() < deadline:
            if self._process is not None and self._process.poll() is not None:
                # Process died before becoming healthy.
                return False
            if await self._ping():
                return True
            await asyncio.sleep(self.HEALTH_POLL_INTERVAL_S)
        return False

    async def _monitor_loop(self) -> None:
        # Phase 1: wait for engine to become healthy after startup.
        healthy = await self._wait_for_healthy()
        if not healthy:
            await self._handle_crash()
            return

        async with self._lock:
            if self._state == "starting":
                self._state = "running"

        # Phase 2: keep pinging while running; detect crashes.
        consecutive_failures = 0
        while True:
            await asyncio.sleep(self.HEALTH_POLL_INTERVAL_S)

            # Check if process has exited.
            if self._process is not None and self._process.poll() is not None:
                await self._handle_crash()
                return

            if await self._ping():
                consecutive_failures = 0
            else:
                consecutive_failures += 1
                if consecutive_failures >= self.PING_FAILURE_THRESHOLD:
                    await self._handle_crash()
                    return

    async def _handle_crash(self) -> None:
        async with self._lock:
            self._restart_count += 1

            if self._restart_count > self.MAX_RESTARTS:
                self._state = "failed"
                self._error_message = (
                    "图像引擎多次崩溃后仍无法恢复，请检查 GPU 驱动是否正常"
                )
                await self._terminate_process()
                return

            self._state = "restarting"
            await self._terminate_process()

        # Exponential backoff outside the lock.
        await asyncio.sleep(self.BACKOFF_BASE_S * self._restart_count)

        async with self._lock:
            if self._state != "restarting":
                # stop() was called during backoff — abort.
                return
            self._state = "starting"
            self._process = self._launcher.launch(
                self._comfyui_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        # Re-enter the monitor from the health-wait phase.
        healthy = await self._wait_for_healthy()
        if not healthy:
            await self._handle_crash()
            return

        async with self._lock:
            if self._state == "starting":
                self._state = "running"

        # Resume run-phase monitoring.
        consecutive_failures = 0
        while True:
            await asyncio.sleep(self.HEALTH_POLL_INTERVAL_S)

            if self._process is not None and self._process.poll() is not None:
                await self._handle_crash()
                return

            if await self._ping():
                consecutive_failures = 0
            else:
                consecutive_failures += 1
                if consecutive_failures >= self.PING_FAILURE_THRESHOLD:
                    await self._handle_crash()
                    return
