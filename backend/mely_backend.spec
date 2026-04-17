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

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

block_cipher = None
project_root = Path(SPECPATH).resolve()

# ---------------------------------------------------------------------------
# Hidden imports — keep this list focused on modules that are pulled in
# dynamically at runtime and therefore escape static analysis.
# ---------------------------------------------------------------------------
hidden_imports = [
    # uvicorn internals
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    # anyio (used by Starlette / FastAPI)
    "anyio._backends._asyncio",
    # pydantic v2 internals
    "pydantic_core",
    "pydantic_settings",
    # FastAPI file uploads
    "multipart",
    "python_multipart",
    # Delayed Pillow import is used by reportlab and visual dataset scoring
    "PIL",
    "PIL.Image",
]

# ---------------------------------------------------------------------------
# Collect data files
# ---------------------------------------------------------------------------
datas = [
    # Include database migration scripts so bootstrap_application() can find them
    (str(project_root / "migrations"), "migrations"),
    *collect_data_files("reportlab"),
]

a = Analysis(
    ["entry.py"],
    pathex=[str(project_root)],
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
        "mypy",
        "numpy",
        "pandas",
        "scipy",
        "cv2",
        "torch",
        "torchvision",
        "torchao",
        "unsloth",
        "unsloth_zoo",
        "datasets",
        "transformers",
        "trl",
        "bitsandbytes",
        "xformers",
        "peft",
        "diffusers",
        "triton",
        "triton_windows",
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
