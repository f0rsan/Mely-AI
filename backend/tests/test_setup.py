from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import create_app


def test_setup_status_returns_runtime_and_gpu_summary(monkeypatch) -> None:
    app = create_app()

    async def fake_check_ollama_runtime():
        return SimpleNamespace(
            installed=True,
            running=False,
            version="0.6.0",
            minimum_version="0.3.10",
            platform="win32-amd64",
            models=[],
            hint="语言引擎未启动，请点击启动按钮后重试。",
        )

    monkeypatch.setattr("app.api.setup.check_ollama_runtime", fake_check_ollama_runtime)

    with TestClient(app) as client:
        client.app.state.training_service = SimpleNamespace(
            get_gpu_precheck=lambda: {"vramGB": 8.0, "source": "env", "result": "ok"}
        )
        client.app.state.engine_runtime = SimpleNamespace(
            get_status=lambda: SimpleNamespace(
                state="stopped",
                restartCount=0,
                errorMessage=None,
                pid=None,
            )
        )
        client.app.state.tts_runtime = SimpleNamespace(
            get_status=lambda: SimpleNamespace(
                state="failed",
                restartCount=1,
                errorMessage="TTS 引擎启动失败",
                pid=None,
            )
        )

        response = client.get("/api/setup/status")

    assert response.status_code == 200
    body = response.json()

    assert body["backend"]["status"] == "ok"
    assert body["backend"]["databaseInitialized"] is True
    assert body["gpu"]["vramGB"] == 8.0
    assert body["gpu"]["recommendedMode"] == "standard"
    assert body["gpu"]["target3070Ready"] is True
    assert "RTX 3070 8GB" in body["gpu"]["recommendation"]
    assert body["llm"]["installed"] is True
    assert body["llm"]["running"] is False
    assert body["llm"]["hint"] == "语言引擎未启动，请点击启动按钮后重试。"
    assert body["imageEngine"]["state"] == "stopped"
    assert body["ttsEngine"]["state"] == "failed"
    assert body["ttsEngine"]["errorMessage"] == "TTS 引擎启动失败"


def test_setup_status_marks_fallback_gpu_detection(monkeypatch) -> None:
    app = create_app()

    async def fake_check_ollama_runtime():
        return SimpleNamespace(
            installed=False,
            running=False,
            version=None,
            minimum_version="0.3.10",
            platform="unknown",
            models=[],
            hint="未检测到语言引擎，请先安装 Ollama。",
        )

    monkeypatch.setattr("app.api.setup.check_ollama_runtime", fake_check_ollama_runtime)

    with TestClient(app) as client:
        client.app.state.training_service = None
        response = client.get("/api/setup/status")

    assert response.status_code == 200
    body = response.json()

    assert body["gpu"]["source"] == "fallback"
    assert body["gpu"]["vramGB"] == 8.0
    assert "保守值估算" in body["gpu"]["recommendation"]


def test_backend_starts_without_llm_gpu_training_extras(monkeypatch) -> None:
    app = create_app()

    monkeypatch.setattr(
        "app.services.llm_training.get_missing_gpu_training_dependencies",
        lambda: ["unsloth", "torch"],
    )

    async def fake_check_ollama_runtime():
        return SimpleNamespace(
            installed=False,
            running=False,
            version=None,
            minimum_version="0.3.10",
            platform="unknown",
            models=[],
            hint="未检测到语言引擎，请先安装 Ollama。",
        )

    monkeypatch.setattr("app.api.setup.check_ollama_runtime", fake_check_ollama_runtime)

    with TestClient(app) as client:
        assert client.app.state.llm_training_service is not None
        assert client.app.state.llm_runtime_manager is not None
        response = client.get("/api/setup/status")

    assert response.status_code == 200
