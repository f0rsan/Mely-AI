from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.task_queue import TaskQueue

GPU_EXCLUSIVE_PREFIXES = ("training-", "generation-", "tts-", "llm-training-", "visual-training-")


class EngineGpuMutexError(Exception):
    """Raised when a GPU-exclusive task is running and another engine cannot start."""


def _is_gpu_exclusive_task(task: object) -> bool:
    category = getattr(task, "category", None)
    if category == "gpu_exclusive":
        return True
    if category == "background":
        return False

    name = getattr(task, "name", "")
    if not isinstance(name, str):
        return False
    return any(name.startswith(prefix) for prefix in GPU_EXCLUSIVE_PREFIXES)


def check_gpu_exclusive(task_queue: "TaskQueue") -> None:
    """Raise EngineGpuMutexError if any GPU-exclusive task is currently running."""
    for task in task_queue.list():
        if task.status == "running" and _is_gpu_exclusive_task(task):
            raise EngineGpuMutexError(
                "GPU 正被其他任务占用，请等待当前任务完成后再试"
            )
