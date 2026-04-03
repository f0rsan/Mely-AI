from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Literal
from uuid import uuid4

from app.services.gpu_mutex import GPU_EXCLUSIVE_PREFIXES


TaskStatus = Literal["pending", "running", "completed", "failed"]
TaskCategory = Literal["background", "gpu_exclusive"]
TaskProgressReporter = Callable[[int, str | None], Awaitable[None]]
TaskRunner = Callable[[TaskProgressReporter], Awaitable[None]]
_UNSET = object()
_CATEGORY_BACKGROUND: TaskCategory = "background"
_CATEGORY_GPU_EXCLUSIVE: TaskCategory = "gpu_exclusive"
_ALL_CATEGORIES: tuple[TaskCategory, ...] = (
    _CATEGORY_BACKGROUND,
    _CATEGORY_GPU_EXCLUSIVE,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class TaskSnapshot:
    id: str
    name: str
    status: TaskStatus
    progress: int
    message: str | None
    error: str | None
    category: TaskCategory = _CATEGORY_BACKGROUND
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class TaskQueue:
    def __init__(self, *, stop_timeout_seconds: float = 3.0) -> None:
        self._tasks: dict[str, TaskSnapshot] = {}
        self._runners: dict[str, TaskRunner] = {}
        self._queues: dict[TaskCategory, asyncio.Queue[str | None]] = {
            category: asyncio.Queue() for category in _ALL_CATEGORIES
        }
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._state_lock = asyncio.Lock()
        self._workers: dict[TaskCategory, asyncio.Task[None] | None] = {
            category: None for category in _ALL_CATEGORIES
        }
        self._started = False
        self._stop_timeout_seconds = max(stop_timeout_seconds, 0.1)

    @staticmethod
    def _new_queues() -> dict[TaskCategory, asyncio.Queue[str | None]]:
        return {category: asyncio.Queue() for category in _ALL_CATEGORIES}

    async def start(self) -> None:
        for category in _ALL_CATEGORIES:
            worker = self._workers[category]
            if worker is None or worker.done():
                self._workers[category] = asyncio.create_task(self._run_worker(category))
        self._started = True

    async def stop(self) -> None:
        if not self._started and all(worker is None for worker in self._workers.values()):
            return

        for category in _ALL_CATEGORIES:
            await self._queues[category].put(None)

        workers = [worker for worker in self._workers.values() if worker is not None]
        if workers:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*workers, return_exceptions=True),
                    timeout=self._stop_timeout_seconds,
                )
            except asyncio.TimeoutError:
                for worker in workers:
                    worker.cancel()
                await asyncio.gather(*workers, return_exceptions=True)

        for category in _ALL_CATEGORIES:
            self._workers[category] = None
        # Recreate queues to avoid stale sentinel values after timed cancellation.
        self._queues = self._new_queues()
        self._started = False

    async def submit(
        self,
        name: str,
        runner: TaskRunner,
        *,
        category: TaskCategory | None = None,
        task_id: str | None = None,
        initial_progress: int = 0,
        initial_message: str | None = "任务已进入队列",
    ) -> TaskSnapshot:
        if not self._started:
            raise RuntimeError("task_queue_not_started")

        resolved_task_id = task_id or uuid4().hex
        resolved_category = self._resolve_category(name=name, category=category)
        normalized_progress = min(max(initial_progress, 0), 100)

        async with self._state_lock:
            existing = self._tasks.get(resolved_task_id)
            if existing is not None and existing.status in {"pending", "running"}:
                raise RuntimeError("task_already_running")

            if existing is None:
                snapshot = TaskSnapshot(
                    id=resolved_task_id,
                    name=name,
                    status="pending",
                    progress=normalized_progress,
                    message=initial_message,
                    error=None,
                    category=resolved_category,
                )
                self._tasks[resolved_task_id] = snapshot
            else:
                existing.name = name
                existing.status = "pending"
                existing.progress = normalized_progress
                existing.message = initial_message
                existing.error = None
                existing.category = resolved_category
                existing.updated_at = utc_now_iso()
                snapshot = existing

            self._runners[resolved_task_id] = runner

        await self._publish(snapshot)
        await self._queues[resolved_category].put(resolved_task_id)
        return snapshot

    def get(self, task_id: str) -> TaskSnapshot | None:
        return self._tasks.get(task_id)

    def list(self) -> list[TaskSnapshot]:
        return sorted(self._tasks.values(), key=lambda item: item.created_at, reverse=True)

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        channel: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers.add(channel)

        for task in self.list():
            channel.put_nowait(self._build_event(task))

        return channel

    async def unsubscribe(self, channel: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(channel)

    async def _run_worker(self, category: TaskCategory) -> None:
        while True:
            task_id = await self._queues[category].get()
            if task_id is None:
                break

            try:
                await self._run_task(task_id)
            except asyncio.CancelledError:
                await asyncio.shield(self._mark_cancelled(task_id))
                raise

    async def _run_task(self, task_id: str) -> None:
        runner = self._runners.get(task_id)
        if runner is None:
            return

        await self._update(task_id, status="running", message="任务执行中", error=None)

        async def report(progress: int, message: str | None = None) -> None:
            normalized = min(max(progress, 0), 100)
            await self._update(
                task_id,
                progress=normalized,
                message=message if message is not None else _UNSET,
                error=None,
            )

        try:
            await runner(report)
        except Exception as exc:  # pragma: no cover
            message = str(exc).strip() or "任务执行失败，请稍后重试。"
            await self._update(task_id, status="failed", error=message, message=None)
        else:
            # Preserve the last message set by the runner (e.g. JSON payload with archiveId).
            await self._update(task_id, status="completed", progress=100, message=_UNSET, error=None)
        finally:
            self._runners.pop(task_id, None)

    async def _update(
        self,
        task_id: str,
        *,
        status: TaskStatus | object = _UNSET,
        progress: int | object = _UNSET,
        message: str | None | object = _UNSET,
        error: str | None | object = _UNSET,
    ) -> None:
        async with self._state_lock:
            snapshot = self._tasks.get(task_id)
            if snapshot is None:
                return

            if status is not _UNSET:
                snapshot.status = status  # type: ignore[assignment]
            if progress is not _UNSET:
                snapshot.progress = progress  # type: ignore[assignment]
            if message is not _UNSET:
                snapshot.message = message  # type: ignore[assignment]
            if error is not _UNSET:
                snapshot.error = error  # type: ignore[assignment]

            snapshot.updated_at = utc_now_iso()

        await self._publish(snapshot)

    async def _mark_cancelled(self, task_id: str) -> None:
        snapshot = self._tasks.get(task_id)
        if snapshot is None:
            return
        # Preserve failed tasks and completed tasks as-is.
        if snapshot.status in {"failed", "completed"}:
            self._runners.pop(task_id, None)
            return

        await self._update(
            task_id,
            status="failed",
            error="任务已中断，请重试。",
            message=None,
        )
        self._runners.pop(task_id, None)

    async def _publish(self, snapshot: TaskSnapshot) -> None:
        event = self._build_event(snapshot)
        for channel in list(self._subscribers):
            channel.put_nowait(event)

    @staticmethod
    def _build_event(snapshot: TaskSnapshot) -> dict[str, Any]:
        return {"event": "task_updated", "task": snapshot.to_dict()}

    @staticmethod
    def _resolve_category(*, name: str, category: TaskCategory | None) -> TaskCategory:
        if category is None:
            if any(name.startswith(prefix) for prefix in GPU_EXCLUSIVE_PREFIXES):
                return _CATEGORY_GPU_EXCLUSIVE
            return _CATEGORY_BACKGROUND

        if category not in _ALL_CATEGORIES:
            raise RuntimeError("task_category_invalid")
        return category
