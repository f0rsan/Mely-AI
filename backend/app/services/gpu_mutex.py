from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.task_queue import TaskQueue

GPU_EXCLUSIVE_PREFIXES = ("training-", "generation-", "tts-", "llm-training-", "visual-training-")


class EngineGpuMutexError(Exception):
    """Raised when a GPU-exclusive task is running and another engine cannot start."""


def check_gpu_exclusive(task_queue: "TaskQueue") -> None:
    """Raise EngineGpuMutexError if any GPU-exclusive task is currently running."""
    for task in task_queue.list():
        if task.status == "running" and any(
            task.name.startswith(p) for p in GPU_EXCLUSIVE_PREFIXES
        ):
            raise EngineGpuMutexError(
                "GPU 正被其他任务占用，请等待当前任务完成后再试"
            )
