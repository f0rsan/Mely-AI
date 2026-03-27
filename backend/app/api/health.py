from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/health", response_model=None)
def read_health(request: Request):
    bootstrap = getattr(request.app.state, "bootstrap", None)

    if bootstrap is None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "app": "mely-backend",
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
