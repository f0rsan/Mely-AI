// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, Runtime, RunEvent};

struct BackendProcess(Mutex<Option<Child>>);

fn backend_executable_name() -> &'static str {
    if cfg!(windows) {
        "mely-backend.exe"
    } else {
        "mely-backend"
    }
}

fn backend_candidate_paths(resource_dir: &Path) -> [PathBuf; 2] {
    let exe_name = backend_executable_name();
    [
        resource_dir.join("mely-backend").join(exe_name),
        resource_dir
            .join("resources")
            .join("mely-backend")
            .join(exe_name),
    ]
}

fn resolve_backend_exe_from_resource_dir(resource_dir: &Path) -> PathBuf {
    let candidates = backend_candidate_paths(resource_dir);
    candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .unwrap_or_else(|| candidates[0].clone())
}

/// Resolve the path to the mely-backend executable.
///
/// - In development (`cargo tauri dev`): the Python backend is started by
///   `npm run dev:stack` (via `concurrently`), so we skip sidecar launch.
/// - In production (installed app): the backend lives in the bundled
///   `mely-backend/` resource directory.
fn backend_exe_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    // In development, skip — the dev:stack script already started uvicorn.
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return None;
    }

    #[cfg(not(debug_assertions))]
    {
        let resource_path = match app.path().resource_dir() {
            Ok(path) => path,
            Err(error) => {
                eprintln!("[mely] failed to resolve resource dir: {error}");
                return None;
            }
        };

        Some(resolve_backend_exe_from_resource_dir(&resource_path))
    }
}

fn spawn_backend<R: Runtime>(app: &AppHandle<R>) -> Option<Child> {
    let exe = backend_exe_path(app)?;
    if !exe.exists() {
        eprintln!("[mely] backend executable not found at {}", exe.display());
        return None;
    }

    match Command::new(&exe).env("MELY_BACKEND_PORT", "8000").spawn() {
        Ok(child) => Some(child),
        Err(error) => {
            eprintln!("[mely] failed to start backend sidecar: {error}");
            None
        }
    }
}

fn stop_backend(process: &BackendProcess) {
    let mut guard = process.0.lock().expect("backend process mutex poisoned");
    if let Some(child) = guard.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *guard = None;
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            if let Some(child) = spawn_backend(app.handle()) {
                let backend_process = app.state::<BackendProcess>();
                let mut guard = backend_process
                    .0
                    .lock()
                    .expect("backend process mutex poisoned");
                *guard = Some(child);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Mely AI");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            let backend_process = app_handle.state::<BackendProcess>();
            stop_backend(backend_process.inner());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("mely-{name}-{suffix}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn resolves_direct_resource_bundle_path() {
        let root = unique_temp_dir("direct");
        let direct_dir = root.join("mely-backend");
        fs::create_dir_all(&direct_dir).expect("create direct dir");
        let direct_exe = direct_dir.join(backend_executable_name());
        fs::write(&direct_exe, b"test").expect("write executable");

        let resolved = resolve_backend_exe_from_resource_dir(&root);

        assert_eq!(resolved, direct_exe);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn falls_back_to_legacy_nested_resource_path() {
        let root = unique_temp_dir("legacy");
        let legacy_dir = root.join("resources").join("mely-backend");
        fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        let legacy_exe = legacy_dir.join(backend_executable_name());
        fs::write(&legacy_exe, b"test").expect("write executable");

        let resolved = resolve_backend_exe_from_resource_dir(&root);

        assert_eq!(resolved, legacy_exe);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }
}
