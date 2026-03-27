from __future__ import annotations

import asyncio
import hashlib
import os
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Literal
from uuid import uuid4

import httpx

from app.core.settings import Settings, get_settings
from app.db.connection import connect_database
from app.services.model_registry import ModelRegistry, load_model_registry
from app.services.task_queue import TaskQueue


DownloadStatus = Literal["pending", "running", "completed", "failed"]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(slots=True)
class DownloadTaskRecord:
    id: str
    model_id: str
    model_name: str
    url: str
    target_path: str
    temp_path: str
    expected_size: int | None
    expected_sha256: str | None
    actual_sha256: str | None
    status: DownloadStatus
    progress: int
    downloaded_bytes: int
    total_bytes: int | None
    message: str | None
    error: str | None
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "modelId": self.model_id,
            "modelName": self.model_name,
            "url": self.url,
            "targetPath": self.target_path,
            "tempPath": self.temp_path,
            "expectedSize": self.expected_size,
            "expectedSha256": self.expected_sha256,
            "sha256": self.actual_sha256,
            "status": self.status,
            "progress": self.progress,
            "downloadedBytes": self.downloaded_bytes,
            "totalBytes": self.total_bytes,
            "message": self.message,
            "error": self.error,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class DownloadServiceError(Exception):
    """Base error for the downloader service."""


class DownloadModelNotFoundError(DownloadServiceError):
    """Raised when model id is not found in the registry."""


class DownloadTaskNotFoundError(DownloadServiceError):
    """Raised when task id does not exist."""


class DownloadTaskConflictError(DownloadServiceError):
    """Raised when action conflicts with task state."""


class DownloadFileIntegrityError(DownloadServiceError):
    """Raised when downloaded file checksum is invalid."""


class DownloadTaskRepository:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path

    @contextmanager
    def _open_connection(self):
        with connect_database(self._db_path) as connection:
            connection.row_factory = sqlite3.Row
            yield connection

    @staticmethod
    def _to_record(row: sqlite3.Row) -> DownloadTaskRecord:
        return DownloadTaskRecord(
            id=row["id"],
            model_id=row["model_id"],
            model_name=row["model_name"],
            url=row["url"],
            target_path=row["target_path"],
            temp_path=row["temp_path"],
            expected_size=row["expected_size"],
            expected_sha256=row["expected_sha256"],
            actual_sha256=row["actual_sha256"],
            status=row["status"],
            progress=row["progress"],
            downloaded_bytes=row["downloaded_bytes"],
            total_bytes=row["total_bytes"],
            message=row["message"],
            error=row["error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create(self, record: DownloadTaskRecord) -> None:
        with self._open_connection() as connection:
            connection.execute(
                """
                INSERT INTO download_tasks (
                    id,
                    model_id,
                    model_name,
                    url,
                    target_path,
                    temp_path,
                    expected_size,
                    expected_sha256,
                    actual_sha256,
                    status,
                    progress,
                    downloaded_bytes,
                    total_bytes,
                    message,
                    error,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.model_id,
                    record.model_name,
                    record.url,
                    record.target_path,
                    record.temp_path,
                    record.expected_size,
                    record.expected_sha256,
                    record.actual_sha256,
                    record.status,
                    record.progress,
                    record.downloaded_bytes,
                    record.total_bytes,
                    record.message,
                    record.error,
                    record.created_at,
                    record.updated_at,
                ),
            )
            connection.commit()

    def get(self, task_id: str) -> DownloadTaskRecord | None:
        with self._open_connection() as connection:
            row = connection.execute(
                "SELECT * FROM download_tasks WHERE id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            return self._to_record(row)

    def list(self) -> list[DownloadTaskRecord]:
        with self._open_connection() as connection:
            rows = connection.execute(
                "SELECT * FROM download_tasks ORDER BY created_at DESC, id DESC"
            ).fetchall()
            return [self._to_record(row) for row in rows]

    def list_recoverable(self) -> list[DownloadTaskRecord]:
        with self._open_connection() as connection:
            rows = connection.execute(
                """
                SELECT * FROM download_tasks
                WHERE status IN ('pending', 'running')
                ORDER BY created_at ASC, id ASC
                """
            ).fetchall()
            return [self._to_record(row) for row in rows]

    def set_status(
        self,
        task_id: str,
        *,
        status: DownloadStatus,
        progress: int | None = None,
        downloaded_bytes: int | None = None,
        total_bytes: int | None = None,
        message: str | None = None,
        error: str | None = None,
        actual_sha256: str | None = None,
    ) -> DownloadTaskRecord:
        existing = self.get(task_id)
        if existing is None:
            raise DownloadTaskNotFoundError("下载任务不存在。")

        patched_progress = progress if progress is not None else existing.progress
        patched_downloaded = downloaded_bytes if downloaded_bytes is not None else existing.downloaded_bytes
        patched_total = total_bytes if total_bytes is not None else existing.total_bytes
        patched_sha = actual_sha256 if actual_sha256 is not None else existing.actual_sha256
        updated_at = utc_now_iso()

        with self._open_connection() as connection:
            connection.execute(
                """
                UPDATE download_tasks
                SET
                    status = ?,
                    progress = ?,
                    downloaded_bytes = ?,
                    total_bytes = ?,
                    message = ?,
                    error = ?,
                    actual_sha256 = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    patched_progress,
                    patched_downloaded,
                    patched_total,
                    message,
                    error,
                    patched_sha,
                    updated_at,
                    task_id,
                ),
            )
            connection.commit()

        refreshed = self.get(task_id)
        if refreshed is None:
            raise DownloadTaskNotFoundError("下载任务不存在。")
        return refreshed


def _sanitize_error_message(exc: Exception) -> str:
    if isinstance(exc, DownloadFileIntegrityError):
        return "下载文件校验失败，请重试。"
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError, httpx.NetworkError)):
        return "下载中断，请检查网络后重试。"
    if isinstance(exc, OSError):
        return "下载失败，请检查磁盘空间或目录权限。"
    if isinstance(exc, DownloadServiceError):
        detail = str(exc).strip()
        if detail:
            return detail
    return "下载失败，请稍后重试。"


@asynccontextmanager
async def _acquire_file_lock(lock_path: Path, *, timeout_seconds: float = 10.0) -> AsyncIterator[None]:
    start_time = time.monotonic()
    lock_fd: int | None = None
    while lock_fd is None:
        try:
            lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(lock_fd, str(os.getpid()).encode("utf-8"))
        except FileExistsError:
            if lock_path.exists():
                age = time.time() - lock_path.stat().st_mtime
                if age > 600:
                    lock_path.unlink(missing_ok=True)
                    continue
            if time.monotonic() - start_time > timeout_seconds:
                raise DownloadServiceError("下载任务正在处理中，请稍后重试。")
            await asyncio.sleep(0.1)

    try:
        yield
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        lock_path.unlink(missing_ok=True)


def _compute_progress(downloaded: int, total: int | None) -> int:
    if total is None or total <= 0:
        return 0
    return min(max(int((downloaded / total) * 100), 0), 100)


def _compute_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


class DownloadService:
    def __init__(
        self,
        *,
        db_path: Path,
        data_root: Path,
        queue: TaskQueue,
        registry: ModelRegistry,
    ) -> None:
        self._repository = DownloadTaskRepository(db_path)
        self._data_root = data_root
        self._queue = queue
        self._registry = registry

    def list_models(self) -> list[dict[str, object]]:
        return [item.to_dict() for item in self._registry.list_items()]

    def list_tasks(self) -> list[dict[str, object]]:
        return [item.to_dict() for item in self._repository.list()]

    def get_task(self, task_id: str) -> dict[str, object]:
        task = self._repository.get(task_id)
        if task is None:
            raise DownloadTaskNotFoundError("下载任务不存在。")
        return task.to_dict()

    async def create_task(self, model_id: str) -> dict[str, object]:
        model = self._registry.get_item(model_id)
        if model is None:
            raise DownloadModelNotFoundError("模型不存在，请先检查模型注册表。")

        task_id = uuid4().hex
        target_path = (self._data_root / "models" / model.relative_path).resolve()
        temp_path = target_path.with_suffix(target_path.suffix + ".part")
        now = utc_now_iso()
        downloaded_bytes = temp_path.stat().st_size if temp_path.exists() else 0
        total_bytes = model.size
        initial_progress = _compute_progress(downloaded_bytes, total_bytes)
        initial_record = DownloadTaskRecord(
            id=task_id,
            model_id=model.id,
            model_name=model.name,
            url=model.url,
            target_path=str(target_path),
            temp_path=str(temp_path),
            expected_size=model.size,
            expected_sha256=model.sha256,
            actual_sha256=None,
            status="pending",
            progress=initial_progress,
            downloaded_bytes=downloaded_bytes,
            total_bytes=total_bytes,
            message="下载任务已进入队列",
            error=None,
            created_at=now,
            updated_at=now,
        )
        self._repository.create(initial_record)

        await self._queue.submit(
            name=f"download-{model.id}",
            runner=self._build_runner(task_id),
            task_id=task_id,
            initial_progress=initial_progress,
            initial_message="下载任务已进入队列",
        )

        refreshed = self._repository.get(task_id)
        if refreshed is None:
            raise DownloadTaskNotFoundError("下载任务不存在。")
        return refreshed.to_dict()

    async def resume_task(self, task_id: str) -> dict[str, object]:
        existing = self._repository.get(task_id)
        if existing is None:
            raise DownloadTaskNotFoundError("下载任务不存在。")

        if existing.status in {"pending", "running"}:
            return existing.to_dict()
        if existing.status == "completed":
            raise DownloadTaskConflictError("下载任务已完成，无需继续。")

        pending = self._repository.set_status(
            task_id,
            status="pending",
            message="下载任务已重新进入队列",
            error=None,
        )

        await self._queue.submit(
            name=f"download-{pending.model_id}",
            runner=self._build_runner(task_id),
            task_id=task_id,
            initial_progress=pending.progress,
            initial_message="下载任务已重新进入队列",
        )
        refreshed = self._repository.get(task_id)
        if refreshed is None:
            raise DownloadTaskNotFoundError("下载任务不存在。")
        return refreshed.to_dict()

    async def recover_pending_tasks(self) -> None:
        recoverable = self._repository.list_recoverable()
        for item in recoverable:
            pending = self._repository.set_status(
                item.id,
                status="pending",
                message="应用重启后恢复下载",
                error=None,
            )
            await self._queue.submit(
                name=f"download-{pending.model_id}",
                runner=self._build_runner(pending.id),
                task_id=pending.id,
                initial_progress=pending.progress,
                initial_message="应用重启后恢复下载",
            )

    def _build_runner(self, task_id: str):
        async def run(progress_reporter) -> None:
            task = self._repository.get(task_id)
            if task is None:
                raise DownloadTaskNotFoundError("下载任务不存在。")

            target_path = Path(task.target_path)
            temp_path = Path(task.temp_path)
            lock_path = Path(f"{task.temp_path}.lock")
            target_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path.parent.mkdir(parents=True, exist_ok=True)

            downloaded_bytes = temp_path.stat().st_size if temp_path.exists() else 0
            total_bytes = task.total_bytes if task.total_bytes is not None else task.expected_size
            running = self._repository.set_status(
                task_id,
                status="running",
                progress=_compute_progress(downloaded_bytes, total_bytes),
                downloaded_bytes=downloaded_bytes,
                total_bytes=total_bytes,
                message="下载任务执行中",
                error=None,
            )
            await progress_reporter(running.progress, running.message)

            try:
                async with _acquire_file_lock(lock_path):
                    await self._download_file(task_id=task_id, progress_reporter=progress_reporter)
            except Exception as exc:
                latest = self._repository.get(task_id)
                latest_downloaded = latest.downloaded_bytes if latest is not None else downloaded_bytes
                latest_total = latest.total_bytes if latest is not None else total_bytes
                failed_progress = _compute_progress(latest_downloaded, latest_total)
                message = _sanitize_error_message(exc)
                self._repository.set_status(
                    task_id,
                    status="failed",
                    progress=failed_progress,
                    downloaded_bytes=latest_downloaded,
                    total_bytes=latest_total,
                    message=None,
                    error=message,
                )
                raise RuntimeError(message) from exc

        return run

    async def _download_file(self, *, task_id: str, progress_reporter) -> None:
        task = self._repository.get(task_id)
        if task is None:
            raise DownloadTaskNotFoundError("下载任务不存在。")

        target_path = Path(task.target_path)
        temp_path = Path(task.temp_path)
        downloaded_bytes = temp_path.stat().st_size if temp_path.exists() else 0
        expected_size = task.expected_size

        headers: dict[str, str] = {}
        if downloaded_bytes > 0:
            headers["Range"] = f"bytes={downloaded_bytes}-"

        timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=30.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, trust_env=False) as client:
            async with client.stream("GET", task.url, headers=headers) as response:
                if response.status_code not in {200, 206}:
                    raise DownloadServiceError("下载失败，服务器暂不可用，请稍后重试。")

                if response.status_code == 200 and downloaded_bytes > 0:
                    temp_path.unlink(missing_ok=True)
                    downloaded_bytes = 0

                content_length = response.headers.get("Content-Length")
                stream_length = int(content_length) if content_length and content_length.isdigit() else None
                if response.status_code == 206 and stream_length is not None:
                    total_bytes = downloaded_bytes + stream_length
                elif expected_size is not None:
                    total_bytes = expected_size
                else:
                    total_bytes = stream_length

                mode = "ab" if downloaded_bytes > 0 else "wb"
                last_progress = _compute_progress(downloaded_bytes, total_bytes)
                with temp_path.open(mode) as handle:
                    async for chunk in response.aiter_bytes(chunk_size=1024 * 128):
                        if not chunk:
                            continue
                        handle.write(chunk)
                        downloaded_bytes += len(chunk)
                        current_progress = _compute_progress(downloaded_bytes, total_bytes)
                        if current_progress != last_progress:
                            last_progress = current_progress
                            self._repository.set_status(
                                task_id,
                                status="running",
                                progress=current_progress,
                                downloaded_bytes=downloaded_bytes,
                                total_bytes=total_bytes,
                                message=f"下载中（{current_progress}%）",
                                error=None,
                            )
                            await progress_reporter(current_progress, f"下载中（{current_progress}%）")

        if expected_size is not None and downloaded_bytes != expected_size:
            raise DownloadServiceError("下载中断，请检查网络后重试。")

        actual_sha256 = _compute_sha256(temp_path)
        if task.expected_sha256 and actual_sha256 != task.expected_sha256:
            raise DownloadFileIntegrityError("下载文件校验失败，请重试。")

        temp_path.replace(target_path)
        self._repository.set_status(
            task_id,
            status="completed",
            progress=100,
            downloaded_bytes=downloaded_bytes,
            total_bytes=expected_size if expected_size is not None else downloaded_bytes,
            message="下载完成并通过校验",
            error=None,
            actual_sha256=actual_sha256,
        )
        await progress_reporter(100, "下载完成并通过校验")


def create_download_service(
    *,
    db_path: Path,
    data_root: Path,
    queue: TaskQueue,
    settings: Settings | None = None,
) -> DownloadService:
    resolved_settings = settings or get_settings()
    registry = load_model_registry(resolved_settings)
    return DownloadService(db_path=db_path, data_root=data_root, queue=queue, registry=registry)
