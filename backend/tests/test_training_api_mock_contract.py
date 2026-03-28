import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


MOCK_PATH = Path(__file__).resolve().parents[2] / "docs" / "mocks" / "m1b_flux_training_mock_data.json"


def _load_contract_group(group_name: str) -> dict:
    data = json.loads(MOCK_PATH.read_text(encoding="utf-8"))
    return data["trainingStartContractMock"][group_name]


def _wait_training_terminal_state(client: TestClient, training_task_id: str) -> dict:
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


def test_mock_happy_path_3070_contract_can_be_used_directly(temp_data_root: Path, monkeypatch) -> None:
    contract = _load_contract_group("happyPath3070")
    monkeypatch.setenv("MELY_GPU_VRAM_GB", str(contract["response"]["precheck"]["vramGB"]))

    app = create_app()
    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "mock-3070-角色"}).json()
        request_payload = dict(contract["request"])
        request_payload["characterId"] = character["id"]

        response = client.post("/api/training/start", json=request_payload)
        assert response.status_code == 202
        created = response.json()

        assert created["requestedModel"] == contract["response"]["requestedModel"]
        assert created["effectiveModel"] == contract["response"]["effectiveModel"]
        assert created["requestedMode"] == contract["response"]["requestedMode"]
        assert created["effectiveMode"] == contract["response"]["effectiveMode"]
        assert created["precheck"]["vramGB"] == contract["response"]["precheck"]["vramGB"]
        assert created["precheck"]["source"] == contract["response"]["precheck"]["source"]

        expected_codes = {item["code"] for item in contract["response"]["downgradeReasons"]}
        actual_codes = {item["code"] for item in created["downgradeReasons"]}
        assert expected_codes.issubset(actual_codes)

        final_state = _wait_training_terminal_state(client, created["id"])
        # 当前 M1E 仍是合同层占位执行器，状态会停在 failed，而不是 mock 中的 completed。
        assert final_state["businessStatus"] == "failed"
        assert final_state["queueStatus"] == "failed"


def test_mock_happy_path_24gb_flux_schnell_can_be_used_directly(
    temp_data_root: Path,
    monkeypatch,
) -> None:
    contract = _load_contract_group("happyPath24GBFluxSchnell")
    monkeypatch.setenv("MELY_GPU_VRAM_GB", str(contract["response"]["precheck"]["vramGB"]))

    app = create_app()
    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "mock-24gb-角色"}).json()
        request_payload = dict(contract["request"])
        request_payload["characterId"] = character["id"]

        response = client.post("/api/training/start", json=request_payload)
        assert response.status_code == 202
        created = response.json()

    assert created["requestedModel"] == contract["response"]["requestedModel"]
    assert created["effectiveModel"] == contract["response"]["effectiveModel"]
    assert created["downgradeReasons"] == contract["response"]["downgradeReasons"]
    assert created["config"]["effective"].get("assistantLoraPath") == "ostris/FLUX.1-schnell-training-adapter"


def test_mock_flux_dev_license_rejected_can_be_used_directly(temp_data_root: Path) -> None:
    contract = _load_contract_group("fluxDevLicenseRejected")

    app = create_app()
    with TestClient(app) as client:
        character = client.post("/api/characters", json={"name": "mock-license-角色"}).json()
        request_payload = dict(contract["request"])
        request_payload["characterId"] = character["id"]

        response = client.post("/api/training/start", json=request_payload)

    assert response.status_code == contract["response"]["statusCode"]
    assert response.json()["detail"] == contract["response"]["detail"]
