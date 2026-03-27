from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Literal
from uuid import uuid4


TaskStatus = Literal["pending", "running", "completed", "failed"]
TaskProgressReporter = Callable[[int, str | None], Awaitable[None]]
TaskRunner = Callable[[TaskProgressReporter], Awaitable[None]]
_UNSET = object()


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
    def __init__(self) -> None:
        self._tasks: dict[str, TaskSnapshot] = {}
        self._runners: dict[str, TaskRunner] = {}
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._state_lock = asyncio.Lock()
        self._worker: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run_worker())

    async def stop(self) -> None:
        if self._worker is None:
            return

        await self._queue.put(None)
        await self._worker
        self._worker = None

    async def submit(self, name: str, runner: TaskRunner) -> TaskSnapshot:
        if self._worker is None:
            raise RuntimeError("task_queue_not_started")

        task_id = uuid4().hex
        snapshot = TaskSnapshot(
            id=task_id,
            name=name,
            status="pending",
            progress=0,
            message="任务已进入队列",
            error=None,
        )

        async with self._state_lock:
            self._tasks[task_id] = snapshot
            self._runners[task_id] = runner

        await self._publish(snapshot)
        await self._queue.put(task_id)
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

    async def _run_worker(self) -> None:
        while True:
            task_id = await self._queue.get()
            if task_id is None:
                break

            await self._run_task(task_id)

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
            await self._update(task_id, status="completed", progress=100, message="任务已完成", error=None)
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

    async def _publish(self, snapshot: TaskSnapshot) -> None:
        event = self._build_event(snapshot)
        for channel in list(self._subscribers):
            channel.put_nowait(event)

    @staticmethod
    def _build_event(snapshot: TaskSnapshot) -> dict[str, Any]:
        return {"event": "task_updated", "task": snapshot.to_dict()}
