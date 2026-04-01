from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.archive import router as archive_router
from app.api.characters import router as characters_router
from app.api.datasets import router as datasets_router
from app.api.engine import router as engine_router
from app.api.generations import router as generations_router
from app.api.downloads import router as downloads_router
from app.api.health import router as health_router
from app.api.prompt import router as prompt_router
from app.api.tasks import router as tasks_router
from app.api.training import router as training_router
from app.api.voice import router as voice_router
from app.services.downloads import create_download_service
from app.services.training import create_training_service
from app.services.engine_runtime import ComfyUIRuntime
from app.services.tts_runtime import TTSRuntime
from app.services.voice_service import create_voice_service
from app.services.task_queue import TaskQueue
from app.services.bootstrap import bootstrap_application


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap_state = bootstrap_application()
    app.state.bootstrap = bootstrap_state
    task_queue = TaskQueue()
    app.state.task_queue = task_queue
    app.state.download_service = None
    app.state.training_service = None
    await task_queue.start()

    engine_runtime = ComfyUIRuntime(task_queue=task_queue)
    app.state.engine_runtime = engine_runtime

    tts_runtime = TTSRuntime(task_queue=task_queue)
    app.state.tts_runtime = tts_runtime
    app.state.voice_service = None

    if bootstrap_state.status == "ok":
        download_service = create_download_service(
            db_path=bootstrap_state.db_path,
            data_root=bootstrap_state.data_root,
            queue=task_queue,
        )
        app.state.download_service = download_service
        app.state.training_service = create_training_service(
            db_path=bootstrap_state.db_path,
            queue=task_queue,
        )
        app.state.voice_service = create_voice_service(
            db_path=bootstrap_state.db_path,
            data_root=bootstrap_state.data_root,
            queue=task_queue,
            tts_runtime=tts_runtime,
        )
        await download_service.recover_pending_tasks()
    try:
        yield
    finally:
        await tts_runtime.stop()
        await engine_runtime.stop()
        await task_queue.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="Mely AI Backend", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:1420", "http://localhost:1420"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router, prefix="/api")
    app.include_router(characters_router, prefix="/api")
    app.include_router(datasets_router, prefix="/api")
    app.include_router(archive_router, prefix="/api")
    app.include_router(engine_router, prefix="/api")
    app.include_router(prompt_router, prefix="/api")
    app.include_router(generations_router, prefix="/api")
    app.include_router(tasks_router, prefix="/api")
    app.include_router(downloads_router, prefix="/api")
    app.include_router(training_router, prefix="/api")
    app.include_router(voice_router, prefix="/api")

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request, _exc):
        return JSONResponse(
            status_code=422,
            content={"detail": "请求参数不合法，请检查后重试"},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request, _exc):
        return JSONResponse(
            status_code=500,
            content={"detail": "服务器开小差了，请稍后再试"},
        )

    return app


app = create_app()
