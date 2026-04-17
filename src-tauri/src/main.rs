// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, Runtime, RunEvent};

struct BackendProcess(Mutex<Option<Child>>);

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 8000;
const BACKEND_STARTUP_ATTEMPTS: usize = 60;
const BACKEND_STARTUP_DELAY_MS: u64 = 250;
const BACKEND_HEALTH_PATH: &str = "/api/health";
const BACKEND_READINESS_PATH: &str =
    "/api/llm-runtime/readiness?mode=standard&baseModel=qwen2.5%3A3b&autoFix=false";

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

fn llm_runtime_candidate_paths(resource_dir: &Path) -> [PathBuf; 2] {
    [
        resource_dir.join("llm-runtime"),
        resource_dir.join("resources").join("llm-runtime"),
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

fn resolve_llm_runtime_root_from_resource_dir(resource_dir: &Path) -> PathBuf {
    let candidates = llm_runtime_candidate_paths(resource_dir);
    candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .unwrap_or_else(|| candidates[0].clone())
}

fn backend_socket_addr(port: u16) -> SocketAddr {
    SocketAddr::from((
        BACKEND_HOST
            .parse::<std::net::Ipv4Addr>()
            .expect("BACKEND_HOST must be a valid IPv4 address"),
        port,
    ))
}

fn backend_http_probe_succeeds(addr: SocketAddr, path: &str) -> bool {
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        addr.ip(),
        addr.port(),
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = [0_u8; 256];
    let read = match stream.read(&mut response) {
        Ok(read) if read > 0 => read,
        _ => return false,
    };

    let status_line = String::from_utf8_lossy(&response[..read]);
    status_line.starts_with("HTTP/1.1 200") || status_line.starts_with("HTTP/1.0 200")
}

fn backend_required_api_succeeds(addr: SocketAddr) -> bool {
    backend_http_probe_succeeds(addr, BACKEND_HEALTH_PATH)
        && backend_http_probe_succeeds(addr, BACKEND_READINESS_PATH)
}

fn wait_for_backend_ready(addr: SocketAddr, attempts: usize, delay: Duration) -> bool {
    for attempt in 0..attempts {
        if backend_required_api_succeeds(addr) {
            return true;
        }

        if attempt + 1 < attempts {
            thread::sleep(delay);
        }
    }

    false
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

    let mut command = Command::new(&exe);
    command.env("MELY_BACKEND_PORT", BACKEND_PORT.to_string());

    if let Ok(resource_dir) = app.path().resource_dir() {
        let runtime_root = resolve_llm_runtime_root_from_resource_dir(&resource_dir);
        command.env("MELY_LLM_RUNTIME_RESOURCE_ROOT", runtime_root);
    }

    match command.spawn() {
        Ok(mut child) => {
            let ready = wait_for_backend_ready(
                backend_socket_addr(BACKEND_PORT),
                BACKEND_STARTUP_ATTEMPTS,
                Duration::from_millis(BACKEND_STARTUP_DELAY_MS),
            );

            if ready {
                Some(child)
            } else {
                eprintln!(
                    "[mely] backend sidecar did not expose the required API within {} ms",
                    BACKEND_STARTUP_ATTEMPTS as u64 * BACKEND_STARTUP_DELAY_MS
                );
                let _ = child.kill();
                let _ = child.wait();
                None
            }
        }
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
    use std::{fs, net::TcpListener};
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

    #[test]
    fn resolves_direct_llm_runtime_resource_path() {
        let root = unique_temp_dir("llm-runtime-direct");
        let direct_dir = root.join("llm-runtime");
        fs::create_dir_all(&direct_dir).expect("create direct runtime dir");

        let resolved = resolve_llm_runtime_root_from_resource_dir(&root);

        assert_eq!(resolved, direct_dir);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn falls_back_to_legacy_nested_llm_runtime_resource_path() {
        let root = unique_temp_dir("llm-runtime-legacy");
        let legacy_dir = root.join("resources").join("llm-runtime");
        fs::create_dir_all(&legacy_dir).expect("create legacy runtime dir");

        let resolved = resolve_llm_runtime_root_from_resource_dir(&root);

        assert_eq!(resolved, legacy_dir);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn waits_for_backend_required_api_to_open() {
        let listener = TcpListener::bind(backend_socket_addr(0)).expect("bind ephemeral port");
        let addr = listener.local_addr().expect("read local addr");
        let handle = thread::spawn(move || {
            let responses = [
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
            ];

            for response in responses {
                let (mut socket, _) = listener.accept().expect("accept probe");
                let mut request = [0_u8; 256];
                let _ = socket.read(&mut request);
                socket
                    .write_all(response.as_bytes())
                    .expect("write probe response");
            }
        });

        let ready = wait_for_backend_ready(addr, 5, Duration::from_millis(10));

        assert!(ready);
        handle.join().expect("join probe server");
    }

    #[test]
    fn returns_false_when_backend_required_api_never_opens() {
        let listener = TcpListener::bind(backend_socket_addr(0)).expect("bind ephemeral port");
        let addr = listener.local_addr().expect("read local addr");
        let handle = thread::spawn(move || {
            let responses = [
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            ];

            for response in responses {
                let (mut socket, _) = listener.accept().expect("accept probe");
                let mut request = [0_u8; 256];
                let _ = socket.read(&mut request);
                socket
                    .write_all(response.as_bytes())
                    .expect("write probe response");
            }
        });

        let ready = wait_for_backend_ready(addr, 2, Duration::from_millis(10));

        assert!(!ready);
        handle.join().expect("join probe server");
    }

    #[test]
    fn returns_false_when_readiness_api_is_missing() {
        let listener = TcpListener::bind(backend_socket_addr(0)).expect("bind ephemeral port");
        let addr = listener.local_addr().expect("read local addr");
        let handle = thread::spawn(move || {
            let responses = [
                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            ];

            for response in responses {
                let (mut socket, _) = listener.accept().expect("accept probe");
                let mut request = [0_u8; 512];
                let read = socket.read(&mut request).expect("read probe request");
                let request_text = String::from_utf8_lossy(&request[..read]);
                if response.starts_with("HTTP/1.1 404") {
                    assert!(
                        request_text.starts_with(&format!("GET {BACKEND_READINESS_PATH} HTTP/1.1")),
                        "expected readiness probe, got {request_text}",
                    );
                }
                socket
                    .write_all(response.as_bytes())
                    .expect("write probe response");
            }
        });

        let ready = wait_for_backend_ready(addr, 1, Duration::from_millis(10));

        assert!(!ready);
        handle.join().expect("join probe server");
    }
}
