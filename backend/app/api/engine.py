from fastapi import APIRouter, HTTPException, Request

from app.schemas.engine import EngineStartResponse, EngineStatus, EngineStopResponse
from app.services.engine_runtime import ComfyUIRuntime, EngineGpuMutexError

router = APIRouter()


def _resolve_engine_runtime(request: Request) -> ComfyUIRuntime:
    runtime = getattr(request.app.state, "engine_runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="图像引擎服务尚未初始化，请稍后重试")
    return runtime


@router.get("/engine/status", response_model=EngineStatus)
def get_engine_status(request: Request) -> EngineStatus:
    runtime = _resolve_engine_runtime(request)
    return runtime.get_status()


@router.post("/engine/start", response_model=EngineStartResponse, status_code=202)
async def start_engine(request: Request) -> EngineStartResponse:
    runtime = _resolve_engine_runtime(request)
    try:
        await runtime.start()
    except EngineGpuMutexError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="图像引擎操作失败，请稍后重试") from exc
    return EngineStartResponse(
        status=runtime.get_status(),
        message="图像引擎启动指令已发送",
    )


@router.post("/engine/stop", response_model=EngineStopResponse, status_code=200)
async def stop_engine(request: Request) -> EngineStopResponse:
    runtime = _resolve_engine_runtime(request)
    try:
        await runtime.stop()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="图像引擎操作失败，请稍后重试") from exc
    return EngineStopResponse(
        status=runtime.get_status(),
        message="图像引擎已停止",
    )
