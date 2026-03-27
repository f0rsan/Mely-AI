import time

from fastapi.testclient import TestClient

from app.main import create_app


def wait_for_terminal_state(client: TestClient, task_id: str) -> dict:
    deadline = time.time() + 3.0
    latest: dict | None = None

    while time.time() < deadline:
        response = client.get(f"/api/tasks/{task_id}")
        assert response.status_code == 200
        latest = response.json()

        if latest["status"] in {"completed", "failed"}:
            return latest

        time.sleep(0.02)

    raise AssertionError(f"任务在超时时间内未结束。最后状态: {latest}")


def test_mock_task_can_complete_successfully(temp_data_root) -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.post(
            "/api/tasks/mock",
            json={"mode": "success", "steps": 3, "delayMs": 1},
        )

        assert response.status_code == 202
        created = response.json()
        assert created["task"]["status"] == "pending"
        assert created["task"]["progress"] == 0

        final_state = wait_for_terminal_state(client, created["task"]["id"])
        assert final_state["status"] == "completed"
        assert final_state["progress"] == 100
        assert final_state["error"] is None


def test_mock_task_can_fail_with_user_friendly_error(temp_data_root) -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.post(
            "/api/tasks/mock",
            json={"mode": "failure", "steps": 2, "delayMs": 1},
        )

        assert response.status_code == 202
        created = response.json()
        final_state = wait_for_terminal_state(client, created["task"]["id"])

    assert final_state["status"] == "failed"
    assert final_state["progress"] < 100
    assert final_state["error"] == "模拟任务执行失败，请稍后重试。"


def test_task_stream_sends_realtime_updates(temp_data_root) -> None:
    app = create_app()

    with TestClient(app) as client:
        with client.websocket_connect("/api/tasks/stream") as websocket:
            response = client.post(
                "/api/tasks/mock",
                json={"mode": "success", "steps": 2, "delayMs": 1},
            )
            assert response.status_code == 202
            task_id = response.json()["task"]["id"]

            matched_event = None
            for _ in range(6):
                event = websocket.receive_json()
                if event["task"]["id"] == task_id:
                    matched_event = event
                    break

    assert matched_event is not None
    assert matched_event["event"] == "task_updated"
    assert matched_event["task"]["status"] in {"pending", "running", "completed"}
