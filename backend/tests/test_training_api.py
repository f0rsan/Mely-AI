import sqlite3
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def wait_training_terminal_state(client: TestClient, training_task_id: str) -> dict:
    deadline = time.time() + 3.0
    latest: dict | None = None

    while time.time() < deadline:
        response = client.get(f"/api/training/tasks/{training_task_id}")
        assert response.status_code == 200
        latest = response.json()
        if latest["businessStatus"] in {"completed", "failed", "canceled"}:
            return latest
        time.sleep(0.02)

    raise AssertionError(f"训练任务在超时时间内未结束。最后状态: {latest}")


def test_training_start_creates_contract_and_applies_flux_vram_downgrade(
    temp_data_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "8")
    app = create_app()

    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "训练角色"}).json()
        response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "standard",
                "baseModel": "flux-schnell",
            },
        )

        assert response.status_code == 202
        created = response.json()
        assert created["characterId"] == character["id"]
        assert created["requestedModel"] == "flux-schnell"
        assert created["effectiveModel"] == "sdxl"
        assert created["requestedMode"] == "standard"
        assert created["effectiveMode"] == "standard"
        assert created["requestedSteps"] == 1800
        assert created["effectiveSteps"] == 1800
        assert created["businessStatus"] in {"queued", "preparing", "failed"}
        assert created["queueStatus"] in {"pending", "running", "failed"}
        assert created["precheck"]["vramGB"] == 8.0
        assert created["precheck"]["source"] == "env"
        assert "flux_vram_guard" in [reason["code"] for reason in created["downgradeReasons"]]
        assert created["samplePreviews"] == []
        assert created["validationImages"] == []

        final_state = wait_training_terminal_state(client, created["id"])
        assert final_state["businessStatus"] == "failed"
        assert final_state["queueStatus"] == "failed"
        assert final_state["userVisibleError"] == "训练任务已通过预检并入队，但当前环境未接入真实训练执行器。"


def test_training_start_downgrades_fine_mode_when_vram_not_enough(
    temp_data_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "8")
    app = create_app()

    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "精细模式测试角色"}).json()
        response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "fine",
                "baseModel": "sdxl",
            },
        )

    assert response.status_code == 202
    created = response.json()
    assert created["requestedMode"] == "fine"
    assert created["effectiveMode"] == "standard"
    assert "mode_vram_guard" in [reason["code"] for reason in created["downgradeReasons"]]


def test_training_start_rejects_flux_dev_without_license_confirmation(
    temp_data_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "24")
    app = create_app()

    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "许可测试角色"}).json()
        response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "standard",
                "baseModel": "flux-dev",
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "flux-dev 存在非商用许可风险，继续前请先确认许可。"


def test_training_start_allows_same_mode_retrain_with_step_delta(
    temp_data_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "24")
    app = create_app()

    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "增步重训角色"}).json()
        first_response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "fine",
                "baseModel": "sdxl",
            },
        )
        assert first_response.status_code == 202
        first_job = first_response.json()

        retrain_response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "fine",
                "baseModel": "sdxl",
                "retrainOfTaskId": first_job["id"],
                "retrainStepDelta": 600,
            },
        )

    assert retrain_response.status_code == 202
    created = retrain_response.json()
    assert created["requestedMode"] == "fine"
    assert created["effectiveMode"] == "fine"
    assert created["requestedSteps"] == 3400
    assert created["effectiveSteps"] == 3400


def test_training_start_rejects_invalid_retrain_step_delta_with_cn_message(
    temp_data_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "24")
    app = create_app()

    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "非法增步角色"}).json()
        first_response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "standard",
                "baseModel": "sdxl",
            },
        )
        assert first_response.status_code == 202
        first_job = first_response.json()

        response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "standard",
                "baseModel": "sdxl",
                "retrainOfTaskId": first_job["id"],
                "retrainStepDelta": 0,
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "重训步数增量必须是大于 0 的整数。"


def test_training_start_rejects_step_delta_without_retrain_source(
    temp_data_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "24")
    app = create_app()

    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "缺少来源任务角色"}).json()
        response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "fine",
                "baseModel": "sdxl",
                "retrainStepDelta": 300,
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "仅在重训任务中允许设置重训步数增量，请提供重训来源任务。"


def test_training_start_rejects_step_delta_when_mode_changes(
    temp_data_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "24")
    app = create_app()

    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "模式冲突角色"}).json()
        first_response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "standard",
                "baseModel": "sdxl",
            },
        )
        assert first_response.status_code == 202
        first_job = first_response.json()

        response = client.post(
            "/api/training/start",
            json={
                "characterId": character["id"],
                "mode": "fine",
                "baseModel": "sdxl",
                "retrainOfTaskId": first_job["id"],
                "retrainStepDelta": 500,
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "增加步数重训时，训练模式必须与来源任务一致。"


def test_training_start_returns_cn_error_for_missing_character(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.post(
            "/api/training/start",
            json={"characterId": "not-exists", "mode": "standard"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "角色不存在"


def test_training_start_syncs_visual_assets_status(temp_data_root: Path, monkeypatch) -> None:
    monkeypatch.setenv("MELY_GPU_VRAM_GB", "8")
    app = create_app()

    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "视觉状态同步角色"}).json()
        response = client.post(
            "/api/training/start",
            json={"characterId": character["id"], "mode": "standard"},
        )
        assert response.status_code == 202
        task_id = response.json()["id"]

        detail = client.get(f"/api/characters/{character['id']}")

    assert detail.status_code == 200
    visual = detail.json()["visual"]
    assert visual is not None
    assert visual["trainingStatus"] in {
        "queued",
        "preparing",
        "failed",
    }
    assert isinstance(visual["trainingConfig"], dict)

    with sqlite3.connect(temp_data_root / "db" / "mely.db") as connection:
        row = connection.execute(
            "SELECT queue_task_id, requested_model, effective_model FROM training_jobs WHERE id = ?",
            (task_id,),
        ).fetchone()

    assert row is not None
    assert row[0] == task_id
    assert row[1] == "flux-schnell"
    assert row[2] == "sdxl"
