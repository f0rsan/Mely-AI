from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.characters import router as characters_router
from app.api.health import router as health_router
from app.api.tasks import router as tasks_router
from app.services.task_queue import TaskQueue
from app.services.bootstrap import bootstrap_application


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.bootstrap = bootstrap_application()
    task_queue = TaskQueue()
    app.state.task_queue = task_queue
    await task_queue.start()
    try:
        yield
    finally:
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
    app.include_router(tasks_router, prefix="/api")

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
