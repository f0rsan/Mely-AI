# PyInstaller entry point for the Mely AI backend sidecar.
#
# MUST be the very first code that runs before any other imports.
# multiprocessing.freeze_support() is required on Windows to prevent
# infinite subprocess spawning when packaged with --onefile.

import multiprocessing
import sys
import os

if __name__ == "__main__":
    multiprocessing.freeze_support()

    # When frozen by PyInstaller (--onefile), the executable extracts itself
    # to a temp directory. We need to add that directory to sys.path so that
    # our app package can be found at runtime.
    if getattr(sys, "frozen", False):
        bundle_dir = sys._MEIPASS  # type: ignore[attr-defined]
        sys.path.insert(0, bundle_dir)

    import uvicorn

    # Read port from environment variable so Tauri can pass a dynamic port
    # (avoids conflicts if the user already has something on 8000).
    port = int(os.environ.get("MELY_BACKEND_PORT", "8000"))

    uvicorn.run(
        "app.main:app",
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
