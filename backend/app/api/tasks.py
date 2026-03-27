import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field

from app.services.task_queue import TaskQueue

router = APIRouter()


class TaskPayload(BaseModel):
    id: str
    name: str
    status: Literal["pending", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    message: str | None = None
    error: str | None = None
    createdAt: str
    updatedAt: str


class TaskCreateResponse(BaseModel):
    task: TaskPayload


class TaskEventPayload(BaseModel):
    event: Literal["task_updated"]
    task: TaskPayload


class MockTaskRequest(BaseModel):
    mode: Literal["success", "failure"] = "success"
    steps: int = Field(default=5, ge=1, le=20)
    delayMs: int = Field(default=300, ge=1, le=5000)


def resolve_task_queue_from_request(request: Request) -> TaskQueue:
    queue = getattr(request.app.state, "task_queue", None)
    if not isinstance(queue, TaskQueue):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="任务队列暂不可用，请稍后重试。",
        )
    return queue


def resolve_task_queue_from_websocket(websocket: WebSocket) -> TaskQueue:
    queue = getattr(websocket.app.state, "task_queue", None)
    if not isinstance(queue, TaskQueue):
        raise RuntimeError("task_queue_not_available")
    return queue


@router.post("/tasks/mock", response_model=TaskCreateResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_mock_task(request: Request, payload: MockTaskRequest) -> dict:
    queue = resolve_task_queue_from_request(request)

    async def run_mock_task(progress) -> None:
        for step in range(1, payload.steps + 1):
            if payload.mode == "failure" and step == payload.steps:
                raise RuntimeError("模拟任务执行失败，请稍后重试。")

            await asyncio.sleep(payload.delayMs / 1000)
            percent = int((step / payload.steps) * 100)
            await progress(percent, f"模拟任务进行中（{step}/{payload.steps}）")

    task = await queue.submit(name=f"mock-{payload.mode}", runner=run_mock_task)
    return {"task": task.to_dict()}


@router.get("/tasks", response_model=list[TaskPayload])
async def list_tasks(request: Request) -> list[dict]:
    queue = resolve_task_queue_from_request(request)
    return [task.to_dict() for task in queue.list()]


@router.get("/tasks/{task_id}", response_model=TaskPayload)
async def get_task(task_id: str, request: Request) -> dict:
    queue = resolve_task_queue_from_request(request)
    task = queue.get(task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在。")

    return task.to_dict()


@router.websocket("/tasks/stream")
async def stream_task_events(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        queue = resolve_task_queue_from_websocket(websocket)
    except RuntimeError:
        await websocket.close(code=1011, reason="任务队列暂不可用")
        return

    channel = queue.subscribe()

    try:
        while True:
            event = await channel.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        return
    finally:
        await queue.unsubscribe(channel)
