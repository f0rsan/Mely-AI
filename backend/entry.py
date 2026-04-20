# PyInstaller entry point for the Mely AI backend sidecar.
#
# MUST be the very first code that runs before any other imports.
# multiprocessing.freeze_support() is required on Windows to prevent
# infinite subprocess spawning when packaged with --onefile.

import multiprocessing
import os
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()

    # When frozen by PyInstaller, keep the bundle root on sys.path so imports
    # continue to resolve when the app is launched outside the source tree.
    if getattr(sys, "frozen", False):
        bundle_dir = sys._MEIPASS  # type: ignore[attr-defined]
        sys.path.insert(0, bundle_dir)

    from app.main import app
    import uvicorn

    # Read port from environment variable so Tauri can pass a dynamic port
    # (avoids conflicts if the user already has something on 8000).
    port = int(os.environ.get("MELY_BACKEND_PORT", "8000"))
    build_version = os.environ.get("MELY_DESKTOP_BUILD_VERSION", "")
    backend_executable = os.environ.get("MELY_BACKEND_EXECUTABLE", "")
    runtime_resource_root = os.environ.get("MELY_LLM_RUNTIME_RESOURCE_ROOT", "")
    summary_path = os.environ.get("MELY_WINDOWS_BUILD_SUMMARY_PATH", "")
    print(
        "[mely] startup "
        f"build_version={build_version or 'unknown'} "
        f"backend={backend_executable or 'unknown'} "
        f"runtime_root={runtime_resource_root or 'unknown'} "
        f"summary={summary_path or 'N/A'}",
        flush=True,
    )

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        # workers=1 is mandatory in a frozen app — multiprocessing workers
        # will not work correctly inside a PyInstaller bundle.
        workers=1,
        # Disable reload in production; it spawns extra processes.
        reload=False,
        # Log to stdout so Tauri can capture it.
        log_level="info",
    )
