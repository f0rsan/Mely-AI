"""Voice API — reference audio upload, voiceprint extraction, TTS synthesis,
and TTS engine lifecycle management.

All endpoints mirror the engine.py / archive.py patterns.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from app.db.connection import connect_database
from app.schemas.voice import (
    TTSEngineActionResponse,
    TTSEngineStatusResponse,
    TTSSynthesizeAcceptedResponse,
    TTSSynthesizeRequest,
    VoiceprintExtractAcceptedResponse,
    VoiceStatusResponse,
    VoiceUploadResponse,
)
from app.services.gpu_mutex import EngineGpuMutexError
from app.services.voice_service import (
    VoiceCharacterNotFoundError,
    VoiceInvalidDurationError,
    VoiceInvalidFormatError,
    VoiceNotBoundError,
    VoiceReferenceNotFoundError,
    VoiceServiceError,
    VoiceSynthesisUnavailableError,
)

router = APIRouter()

ALLOWED_EXTENSIONS = {"wav"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB hard cap


# ---------------------------------------------------------------------------
# dependency helpers
# ---------------------------------------------------------------------------


def _resolve_voice_service(request: Request):
    svc = getattr(request.app.state, "voice_service", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="语音服务尚未初始化，请稍后重试")
    return svc


def _resolve_tts_runtime(request: Request):
    runtime = getattr(request.app.state, "tts_runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="TTS 引擎服务尚未初始化，请稍后重试")
    return runtime


def _resolve_bootstrap(request: Request):
    bootstrap = getattr(request.app.state, "bootstrap", None)
    if bootstrap is None or bootstrap.status != "ok":
        raise HTTPException(status_code=503, detail="服务初始化失败，请稍后重试")
    return bootstrap


def _tts_status_to_response(status) -> TTSEngineStatusResponse:
    return TTSEngineStatusResponse(
        state=status.state,
        restartCount=status.restart_count,
        errorMessage=status.error_message,
        pid=status.pid,
    )


# ---------------------------------------------------------------------------
# reference audio upload
# ---------------------------------------------------------------------------


@router.post(
    "/voice/upload-reference",
    response_model=VoiceUploadResponse,
    status_code=201,
)
async def upload_reference_audio(
    character_id: str,
    file: UploadFile,
    request: Request,
) -> VoiceUploadResponse:
    svc = _resolve_voice_service(request)

    # Validate file extension
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="当前仅支持 WAV 参考音频上传，请先转换为 WAV 后重试。",
        )

    audio_bytes = await file.read()
    if len(audio_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件过大，参考音频最大 10MB。")

    # Estimate duration from file size (rough; real impl would use ffprobe/mutagen).
    # Caller is expected to pass duration via query param for validation.
    # For the API contract we accept duration_seconds as a query param.
    duration_seconds_str = request.query_params.get("durationSeconds", "")
    try:
        duration_seconds = float(duration_seconds_str)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=422,
            detail="请提供 durationSeconds 查询参数（参考音频时长，单位秒）。",
        )

    try:
        asset = svc.save_reference_audio(
            character_id=character_id,
            audio_bytes=audio_bytes,
            original_filename=filename,
            duration_seconds=duration_seconds,
            audio_format=ext,
        )
    except VoiceCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except VoiceInvalidFormatError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except VoiceInvalidDurationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except VoiceServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return VoiceUploadResponse(
        characterId=character_id,
        referenceAudioPath=asset.reference_audio_path or "",
        durationSeconds=asset.reference_audio_duration or duration_seconds,
        audioFormat=ext,
        status="extracting",
        message="参考音频上传成功，声纹提取已开始",
    )


# ---------------------------------------------------------------------------
# voiceprint extraction
# ---------------------------------------------------------------------------


@router.post(
    "/voice/extract-voiceprint",
    response_model=VoiceprintExtractAcceptedResponse,
    status_code=202,
)
async def extract_voiceprint(character_id: str, request: Request) -> VoiceprintExtractAcceptedResponse:
    svc = _resolve_voice_service(request)

    try:
        task_id = await svc.submit_voiceprint_extraction(character_id)
    except VoiceCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except VoiceReferenceNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except VoiceServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return VoiceprintExtractAcceptedResponse(
        taskId=task_id,
        characterId=character_id,
        message="声纹提取任务已提交",
    )


# ---------------------------------------------------------------------------
# TTS synthesis
# ---------------------------------------------------------------------------


@router.post(
    "/voice/synthesize",
    response_model=TTSSynthesizeAcceptedResponse,
    status_code=202,
)
async def synthesize(
    payload: TTSSynthesizeRequest,
    request: Request,
) -> TTSSynthesizeAcceptedResponse:
    svc = _resolve_voice_service(request)

    try:
        task_id = await svc.submit_synthesis(
            character_id=payload.character_id,
            text=payload.text,
            language=payload.language,
            speed=payload.speed,
            output_format=payload.output_format,
        )
    except VoiceCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except VoiceNotBoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except VoiceSynthesisUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except EngineGpuMutexError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except VoiceServiceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return TTSSynthesizeAcceptedResponse(
        taskId=task_id,
        characterId=payload.character_id,
        message="语音合成任务已提交",
    )


# ---------------------------------------------------------------------------
# TTS engine management  (MUST be before /{character_id}/status to avoid route conflict)
# ---------------------------------------------------------------------------


@router.get("/voice/engine/status", response_model=TTSEngineStatusResponse)
def get_tts_engine_status(request: Request) -> TTSEngineStatusResponse:
    runtime = _resolve_tts_runtime(request)
    return _tts_status_to_response(runtime.get_status())


@router.post(
    "/voice/engine/start",
    response_model=TTSEngineActionResponse,
    status_code=202,
)
async def start_tts_engine(request: Request) -> TTSEngineActionResponse:
    runtime = _resolve_tts_runtime(request)
    try:
        await runtime.start()
    except EngineGpuMutexError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="TTS 引擎操作失败，请稍后重试") from exc
    return TTSEngineActionResponse(
        status=_tts_status_to_response(runtime.get_status()),
        message="TTS 引擎启动指令已发送",
    )


@router.post(
    "/voice/engine/stop",
    response_model=TTSEngineActionResponse,
    status_code=200,
)
async def stop_tts_engine(request: Request) -> TTSEngineActionResponse:
    runtime = _resolve_tts_runtime(request)
    try:
        await runtime.stop()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="TTS 引擎操作失败，请稍后重试") from exc
    return TTSEngineActionResponse(
        status=_tts_status_to_response(runtime.get_status()),
        message="TTS 引擎已停止",
    )


# ---------------------------------------------------------------------------
# voice status  (parameterized path — AFTER fixed paths to avoid conflict)
# ---------------------------------------------------------------------------


@router.get(
    "/voice/{character_id}/status",
    response_model=VoiceStatusResponse,
)
def get_voice_status(character_id: str, request: Request) -> VoiceStatusResponse:
    svc = _resolve_voice_service(request)

    try:
        asset = svc.get_status(character_id)
    except VoiceCharacterNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return VoiceStatusResponse(
        characterId=asset.character_id,
        hasReference=asset.reference_audio_path is not None,
        status=asset.status,
        referenceAudioPath=asset.reference_audio_path,
        durationSeconds=asset.reference_audio_duration,
        ttsEngine=asset.tts_engine,
        boundAt=asset.bound_at,
    )


# ---------------------------------------------------------------------------
# audio file serving (symmetric to /generations/{id}/image)
# ---------------------------------------------------------------------------


@router.get("/generations/{generation_id}/audio")
def get_generation_audio(generation_id: str, request: Request) -> FileResponse:
    bootstrap = _resolve_bootstrap(request)

    from app.db.connection import connect_database
    import sqlite3

    conn = connect_database(bootstrap.db_path)
    conn.row_factory = sqlite3.Row
    with conn:
        row = conn.execute(
            "SELECT character_id, output_path, type FROM generations WHERE id = ?",
            (generation_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="生成记录不存在。")

    if row["type"] != "audio":
        raise HTTPException(status_code=400, detail="该生成记录不是音频类型。")

    audio_path = Path(row["output_path"]).resolve()
    allowed_root = (
        bootstrap.data_root / "characters" / row["character_id"] / "generations"
    ).resolve()

    try:
        audio_path.relative_to(allowed_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="无权访问该资源。")

    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="音频文件不存在。")

    return FileResponse(str(audio_path), media_type="audio/wav")
