from __future__ import annotations

from types import SimpleNamespace

from fastapi import APIRouter, Request

from app.services.ollama_service import check_ollama_runtime

router = APIRouter(prefix="/setup", tags=["setup"])


def _resolve_bootstrap(request: Request):
    return getattr(request.app.state, "bootstrap", None)


def _resolve_training_service(request: Request):
    return getattr(request.app.state, "training_service", None)


def _resolve_engine_runtime(request: Request):
    return getattr(request.app.state, "engine_runtime", None)


def _resolve_tts_runtime(request: Request):
    return getattr(request.app.state, "tts_runtime", None)


def _fallback_llm_runtime() -> SimpleNamespace:
    return SimpleNamespace(
        installed=False,
        running=False,
        version=None,
        minimum_version="0.3.10",
        platform="unknown",
        models=[],
        hint="语言引擎状态检测失败，请稍后重试。",
    )


def _build_gpu_summary(precheck: dict[str, float | str]) -> dict[str, float | str | bool]:
    vram_gb = float(precheck.get("vramGB", 8.0))
    source = str(precheck.get("source", "fallback"))
    result = str(precheck.get("result", "conservative_default"))

    if vram_gb >= 12:
        recommended_mode = "fine"
        recommendation = "显存条件较充足，可尝试精细视觉流程；首次仍建议先从标准模式开始。"
    elif vram_gb >= 8:
        recommended_mode = "standard"
        recommendation = "符合 RTX 3070 8GB 目标基线，建议先从标准视觉流程开始。"
    elif vram_gb >= 6:
        recommended_mode = "light"
        recommendation = "建议先使用轻量视觉流程，避免直接尝试高负载训练。"
    else:
        recommended_mode = "text_only"
        recommendation = "当前更适合先使用角色设定与文字能力。"

    if source == "fallback":
        recommendation = f"{recommendation} 当前未能直接读取显存，先按 8GB 保守值估算。"

    return {
        "vramGB": round(vram_gb, 2),
        "source": source,
        "result": result,
        "recommendedMode": recommended_mode,
        "target3070Ready": vram_gb >= 8,
        "fineTuneReady": vram_gb >= 12,
        "recommendation": recommendation,
    }


@router.get("/status", response_model=None)
async def read_setup_status(request: Request):
    bootstrap = _resolve_bootstrap(request)
    training_service = _resolve_training_service(request)
    engine_runtime = _resolve_engine_runtime(request)
    tts_runtime = _resolve_tts_runtime(request)

    if training_service is not None:
        gpu_precheck = training_service.get_gpu_precheck()
    else:
        gpu_precheck = {"vramGB": 8.0, "source": "fallback", "result": "conservative_default"}

    try:
        llm_runtime = await check_ollama_runtime()
    except Exception:
        llm_runtime = _fallback_llm_runtime()

    engine_status = (
        engine_runtime.get_status()
        if engine_runtime is not None
        else SimpleNamespace(state="failed", restart_count=0, error_message="图像引擎未初始化。", pid=None)
    )
    tts_status = (
        tts_runtime.get_status()
        if tts_runtime is not None
        else SimpleNamespace(state="failed", restart_count=0, error_message="TTS 引擎未初始化。", pid=None)
    )

    return {
        "backend": {
            "status": getattr(bootstrap, "status", "error"),
            "dataRoot": str(getattr(bootstrap, "data_root", "")) if bootstrap is not None else None,
            "databaseInitialized": bool(getattr(bootstrap, "initialized", False)),
        },
        "gpu": _build_gpu_summary(gpu_precheck),
        "llm": {
            "installed": bool(llm_runtime.installed),
            "running": bool(llm_runtime.running),
            "version": llm_runtime.version,
            "minimumVersion": llm_runtime.minimum_version,
            "platform": llm_runtime.platform,
            "models": [
                {
                    "name": model.name,
                    "sizeBytes": model.size_bytes,
                    "modifiedAt": model.modified_at,
                    "digest": model.digest,
                }
                for model in llm_runtime.models
            ],
            "hint": llm_runtime.hint,
        },
        "imageEngine": {
            "state": engine_status.state,
            "restartCount": getattr(engine_status, "restartCount", getattr(engine_status, "restart_count", 0)),
            "errorMessage": getattr(engine_status, "errorMessage", getattr(engine_status, "error_message", None)),
            "pid": engine_status.pid,
        },
        "ttsEngine": {
            "state": tts_status.state,
            "restartCount": getattr(tts_status, "restartCount", getattr(tts_status, "restart_count", 0)),
            "errorMessage": getattr(tts_status, "errorMessage", getattr(tts_status, "error_message", None)),
            "pid": tts_status.pid,
        },
    }
