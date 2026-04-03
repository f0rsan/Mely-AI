// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

/// Resolve the path to the mely-backend executable.
///
/// - In development (`cargo tauri dev`): the Python backend is started by
///   `npm run dev:stack` (via `concurrently`), so we skip sidecar launch.
/// - In production (installed app): the backend lives in the bundled
///   `resources/mely-backend/` directory.
fn backend_exe_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    // In development, skip — the dev:stack script already started uvicorn.
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return None;
    }

    #[cfg(not(debug_assertions))]
    {
        let resource_path = app
            .path()
            .resource_dir()
            .expect("could not resolve resource dir");

        let exe_name = if cfg!(windows) {
            "mely-backend.exe"
        } else {
            "mely-backend"
        };

        Some(resource_path.join("resources").join("mely-backend").join(exe_name))
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Some(exe) = backend_exe_path(app.handle()) {
                if exe.exists() {
                    // Pick a port — 8000 is the default.
                    // If we later implement dynamic port selection we can pass it here.
                    let port = "8000";
                    std::process::Command::new(&exe)
                        .env("MELY_BACKEND_PORT", port)
                        // Inherit stdout/stderr so the Tauri log can capture them.
                        .spawn()
                        .unwrap_or_else(|e| {
                            eprintln!("[mely] failed to start backend sidecar: {e}");
                            // Non-fatal: the frontend will show a connection-error state.
                            panic!("backend sidecar failed");
                        });
                } else {
                    eprintln!(
                        "[mely] backend executable not found at {}",
                        exe.display()
                    );
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Mely AI");
}
