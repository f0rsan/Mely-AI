from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def read_health() -> dict[str, object]:
    return {
        "status": "ok",
        "app": "mely-backend",
        "services": {"api": "running"},
    }

