import hashlib
import json
import socket
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def wait_download_terminal_state(client: TestClient, task_id: str) -> dict:
    deadline = time.time() + 8.0
    latest: dict | None = None

    while time.time() < deadline:
        response = client.get(f"/api/downloads/tasks/{task_id}")
        assert response.status_code == 200
        latest = response.json()
        if latest["status"] in {"completed", "failed"}:
            return latest
        time.sleep(0.05)

    raise AssertionError(f"下载任务在超时时间内未结束。最后状态: {latest}")


@contextmanager
def run_fixture_file_server(file_bytes: bytes, *, fail_first_request: bool = False):
    class FixtureFileHandler(BaseHTTPRequestHandler):
        interrupted = False

        def do_GET(self):  # noqa: N802
            if self.path != "/artifact.bin":
                self.send_response(404)
                self.end_headers()
                return

            start = 0
            range_header = self.headers.get("Range")
            if range_header and range_header.startswith("bytes=") and range_header.endswith("-"):
                start = int(range_header.removeprefix("bytes=").removesuffix("-"))

            total_size = len(file_bytes)
            if start >= total_size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{total_size}")
                self.end_headers()
                return

            body = file_bytes[start:]
            status_code = 206 if start > 0 else 200
            self.send_response(status_code)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            if status_code == 206:
                self.send_header(
                    "Content-Range",
                    f"bytes {start}-{total_size - 1}/{total_size}",
                )
            self.end_headers()

            should_interrupt = fail_first_request and not FixtureFileHandler.interrupted and start == 0
            if should_interrupt:
                FixtureFileHandler.interrupted = True
                cutoff = max(1, len(body) // 2)
                self.wfile.write(body[:cutoff])
                self.wfile.flush()
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return

            self.wfile.write(body)

        def log_message(self, _format, *_args):  # noqa: A003
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureFileHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        base_url = f"http://127.0.0.1:{server.server_port}/artifact.bin"
        yield base_url
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1.0)


def write_model_registry(
    registry_path: Path,
    *,
    model_id: str,
    url: str,
    relative_path: str,
    size: int,
    sha256_value: str,
) -> None:
    registry_path.write_text(
        json.dumps(
            {
                "models": [
                    {
                        "id": model_id,
                        "name": "测试下载模型",
                        "url": url,
                        "size": size,
                        "sha256": sha256_value,
                        "relativePath": relative_path,
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_download_task_can_complete_and_pass_checksum(
    temp_data_root: Path,
    tmp_path: Path,
    monkeypatch,
) -> None:
    file_bytes = b"mely-smoke-download" * 4096
    digest = hashlib.sha256(file_bytes).hexdigest()
    registry_path = tmp_path / "model-registry.json"
    monkeypatch.setenv("MELY_MODEL_REGISTRY_PATH", str(registry_path))

    with run_fixture_file_server(file_bytes) as artifact_url:
        write_model_registry(
            registry_path,
            model_id="smoke-model",
            url=artifact_url,
            relative_path="smoke/small.bin",
            size=len(file_bytes),
            sha256_value=digest,
        )
        app = create_app()

        with TestClient(app) as client:
            create_response = client.post("/api/downloads/tasks", json={"modelId": "smoke-model"})
            assert create_response.status_code == 202
            created_task = create_response.json()
            assert created_task["status"] == "pending"
            assert created_task["progress"] == 0

            final_state = wait_download_terminal_state(client, created_task["id"])

        assert final_state["status"] == "completed"
        assert final_state["error"] is None
        assert final_state["sha256"] == digest

    output_path = temp_data_root / "models" / "smoke" / "small.bin"
    assert output_path.exists()
    assert output_path.read_bytes() == file_bytes


def test_download_task_can_resume_after_interruption(
    temp_data_root: Path,
    tmp_path: Path,
    monkeypatch,
) -> None:
    file_bytes = b"mely-resume" * 60000
    digest = hashlib.sha256(file_bytes).hexdigest()
    registry_path = tmp_path / "model-registry.json"
    monkeypatch.setenv("MELY_MODEL_REGISTRY_PATH", str(registry_path))

    with run_fixture_file_server(file_bytes, fail_first_request=True) as artifact_url:
        write_model_registry(
            registry_path,
            model_id="resume-model",
            url=artifact_url,
            relative_path="resume/artifact.bin",
            size=len(file_bytes),
            sha256_value=digest,
        )
        app = create_app()

        with TestClient(app) as client:
            create_response = client.post("/api/downloads/tasks", json={"modelId": "resume-model"})
            assert create_response.status_code == 202
            task_id = create_response.json()["id"]

            first_terminal = wait_download_terminal_state(client, task_id)
            assert first_terminal["status"] == "failed"
            assert first_terminal["downloadedBytes"] > 0
            assert first_terminal["error"] == "下载中断，请检查网络后重试。"

            resume_response = client.post(f"/api/downloads/tasks/{task_id}/resume")
            assert resume_response.status_code == 202
            resumed = resume_response.json()
            assert resumed["id"] == task_id

            final_state = wait_download_terminal_state(client, task_id)

        assert final_state["status"] == "completed"
        assert final_state["error"] is None

    output_path = temp_data_root / "models" / "resume" / "artifact.bin"
    assert output_path.read_bytes() == file_bytes


def test_download_task_fails_with_cn_error_when_checksum_mismatch(
    temp_data_root: Path,
    tmp_path: Path,
    monkeypatch,
) -> None:
    file_bytes = b"checksum-mismatch-case" * 2048
    wrong_digest = "a" * 64
    registry_path = tmp_path / "model-registry.json"
    monkeypatch.setenv("MELY_MODEL_REGISTRY_PATH", str(registry_path))

    with run_fixture_file_server(file_bytes) as artifact_url:
        write_model_registry(
            registry_path,
            model_id="checksum-model",
            url=artifact_url,
            relative_path="checksum/check.bin",
            size=len(file_bytes),
            sha256_value=wrong_digest,
        )
        app = create_app()

        with TestClient(app) as client:
            create_response = client.post("/api/downloads/tasks", json={"modelId": "checksum-model"})
            assert create_response.status_code == 202
            task_id = create_response.json()["id"]
            final_state = wait_download_terminal_state(client, task_id)

    assert final_state["status"] == "failed"
    assert final_state["error"] == "下载文件校验失败，请重试。"


def test_download_task_can_resume_after_restart(
    temp_data_root: Path,
    tmp_path: Path,
    monkeypatch,
) -> None:
    file_bytes = b"restart-resume-case" * 50000
    digest = hashlib.sha256(file_bytes).hexdigest()
    registry_path = tmp_path / "model-registry.json"
    monkeypatch.setenv("MELY_MODEL_REGISTRY_PATH", str(registry_path))
    recover_task_id = "recover-task-001"
    relative_path = "recovery/restart.bin"

    with run_fixture_file_server(file_bytes) as artifact_url:
        write_model_registry(
            registry_path,
            model_id="recover-model",
            url=artifact_url,
            relative_path=relative_path,
            size=len(file_bytes),
            sha256_value=digest,
        )

        first_app = create_app()
        with TestClient(first_app) as client:
            health_response = client.get("/api/health")
            assert health_response.status_code == 200

        temp_file_path = temp_data_root / "models" / f"{relative_path}.part"
        temp_file_path.parent.mkdir(parents=True, exist_ok=True)
        partial_size = len(file_bytes) // 3
        temp_file_path.write_bytes(file_bytes[:partial_size])

        db_path = temp_data_root / "db" / "mely.db"
        now = _utc_now_iso()
        with sqlite3.connect(db_path) as connection:
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
                    status,
                    progress,
                    downloaded_bytes,
                    total_bytes,
                    message,
                    error,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    recover_task_id,
                    "recover-model",
                    "测试下载模型",
                    artifact_url,
                    str(temp_data_root / "models" / relative_path),
                    str(temp_file_path),
                    len(file_bytes),
                    digest,
                    "running",
                    int((partial_size / len(file_bytes)) * 100),
                    partial_size,
                    len(file_bytes),
                    "下载中",
                    None,
                    now,
                    now,
                ),
            )
            connection.commit()

        second_app = create_app()
        with TestClient(second_app) as client:
            final_state = wait_download_terminal_state(client, recover_task_id)

    assert final_state["status"] == "completed"
    assert final_state["error"] is None
    output_path = temp_data_root / "models" / relative_path
    assert output_path.read_bytes() == file_bytes
