import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()
API_FEATURES = {"llmRuntimeReadiness": True}


@router.get("/health", response_model=None)
def read_health(request: Request):
    bootstrap = getattr(request.app.state, "bootstrap", None)

    build = {
        "version": os.getenv("MELY_DESKTOP_BUILD_VERSION"),
        "backendExecutable": os.getenv("MELY_BACKEND_EXECUTABLE"),
        "runtimeResourceRoot": os.getenv("MELY_LLM_RUNTIME_RESOURCE_ROOT"),
        "releaseSummaryPath": os.getenv("MELY_WINDOWS_BUILD_SUMMARY_PATH"),
    }

    if bootstrap is None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "app": "mely-backend",
                "build": build,
                "api": {"features": API_FEATURES},
                "services": {"api": "running"},
                "dataRoot": None,
                "database": {
                    "path": None,
                    "initialized": False,
                    "appliedMigrations": [],
                    "error": "bootstrap_not_run",
                },
                "error": "bootstrap_not_run",
            },
        )

    body = {
        "status": bootstrap.status,
        "app": "mely-backend",
        "build": build,
        "api": {"features": API_FEATURES},
        "services": {"api": "running"},
        "dataRoot": str(bootstrap.data_root),
        "database": {
            "path": str(bootstrap.db_path),
            "initialized": bootstrap.initialized,
            "appliedMigrations": bootstrap.applied_migrations,
            "error": bootstrap.error,
        },
    }

    if bootstrap.status != "ok":
        body["error"] = "bootstrap_failed"
        body["database"]["error"] = "bootstrap_failed"
        return JSONResponse(status_code=503, content=body)

    return body
