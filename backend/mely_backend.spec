# PyInstaller spec file for the Mely AI backend sidecar.
#
# Build command (run from the `backend/` directory):
#   pyinstaller mely_backend.spec
#
# Output: dist/mely-backend/mely-backend.exe  (Windows)
#         dist/mely-backend/mely-backend       (macOS/Linux)
#
# The --onedir strategy is used here instead of --onefile because:
#   1. No extraction delay on startup (--onefile extracts to %TEMP% on every run)
#   2. Windows Defender is less likely to flag a directory than a self-extracting exe
#   3. Easier to inspect and debug if something is missing
#
# Tauri bundles the entire dist/mely-backend/ directory as a resource.

import sys
from pathlib import Path

block_cipher = None

# ---------------------------------------------------------------------------
# Hidden imports — FastAPI + uvicorn use a lot of dynamic/plugin imports
# that PyInstaller cannot detect through static analysis.
# ---------------------------------------------------------------------------
hidden_imports = [
    # uvicorn internals
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    # anyio (used by Starlette / FastAPI)
    "anyio",
    "anyio._backends._asyncio",
    "anyio._backends._trio",
    # h11 (HTTP/1.1 parser used by uvicorn)
    "h11",
    "h11._readers",
    "h11._writers",
    "h11._events",
    "h11._abnf",
    "h11._util",
    "h11._connection",
    # pydantic v2 internals
    "pydantic",
    "pydantic.deprecated",
    "pydantic.deprecated.class_validators",
    "pydantic.deprecated.config",
    "pydantic.deprecated.tools",
    "pydantic_core",
    "pydantic_settings",
    # starlette
    "starlette",
    "starlette.routing",
    "starlette.middleware",
    "starlette.middleware.cors",
    "starlette.responses",
    "starlette.staticfiles",
    "starlette.testclient",
    # SQLite (stdlib, but sometimes needs a nudge)
    "sqlite3",
    "_sqlite3",
    # Async
    "asyncio",
    "asyncio.events",
    "asyncio.base_events",
    # email-validator (optional pydantic dependency)
    "email_validator",
    # Our app modules — list explicitly to be safe
    "app",
    "app.main",
    "app.db",
    "app.api",
    "app.api.archive",
    "app.api.characters",
    "app.api.costumes",
    "app.api.datasets",
    "app.api.downloads",
    "app.api.engine",
    "app.api.exports",
    "app.api.generations",
    "app.api.health",
    "app.api.prompt",
    "app.api.tasks",
    "app.api.training",
    "app.api.voice",
    "app.models",
    "app.services",
    "app.services.bootstrap",
    "app.services.downloads",
    "app.services.engine_runtime",
    "app.services.task_queue",
    "app.services.tts_runtime",
    "app.services.training",
    "app.services.voice_service",
]

# ---------------------------------------------------------------------------
# Collect data files
# ---------------------------------------------------------------------------
datas = [
    # Include database migration scripts so bootstrap_application() can find them
    ("migrations", "migrations"),
]

a = Analysis(
    ["entry.py"],
    pathex=[str(Path(".").resolve())],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy packages that are not needed at runtime
        "tkinter",
        "matplotlib",
        "numpy",
        "pandas",
        "scipy",
        "PIL",
        "cv2",
        "torch",
        "tensorflow",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # onedir: binaries go into COLLECT below
    name="mely-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,           # compress binaries (requires UPX installed)
    upx_exclude=[],
    console=True,       # keep console so Tauri can read stdout/stderr
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="mely-backend",  # output directory: dist/mely-backend/
)
