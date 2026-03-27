from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="Mely AI Backend")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:1420", "http://localhost:1420"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router, prefix="/api")
    return app


app = create_app()

