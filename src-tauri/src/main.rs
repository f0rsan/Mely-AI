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
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, RunEvent};

struct BackendProcess(Mutex<Option<Child>>);

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 8000;
const BACKEND_STARTUP_ATTEMPTS: usize = 60;
const BACKEND_STARTUP_DELAY_MS: u64 = 250;
const BACKEND_HEALTH_PATH: &str = "/api/health";
const BACKEND_READINESS_PATH: &str =
    "/api/llm-runtime/readiness?mode=standard&baseModel=qwen2.5%3A3b&autoFix=false";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExistingBackendState {
    Clear,
    MelyBackend,
    OtherService,
}

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
        resource_dir
            .join("resources")
            .join("mely-backend")
            .join(exe_name),
        resource_dir.join("mely-backend").join(exe_name),
    ]
}

fn llm_runtime_candidate_paths(resource_dir: &Path) -> [PathBuf; 2] {
    [
        resource_dir.join("resources").join("llm-runtime"),
        resource_dir.join("llm-runtime"),
    ]
}

fn build_summary_candidate_paths(resource_dir: &Path) -> [PathBuf; 2] {
    [
        resource_dir
            .join("resources")
            .join("windows-training-release-artifacts.txt"),
        resource_dir.join("windows-training-release-artifacts.txt"),
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

fn resolve_build_summary_path_from_resource_dir(resource_dir: &Path) -> Option<PathBuf> {
    let candidates = build_summary_candidate_paths(resource_dir);
    candidates.iter().find(|path| path.exists()).cloned()
}

fn backend_socket_addr(port: u16) -> SocketAddr {
    SocketAddr::from((
        BACKEND_HOST
            .parse::<std::net::Ipv4Addr>()
            .expect("BACKEND_HOST must be a valid IPv4 address"),
        port,
    ))
}

fn backend_http_response(addr: SocketAddr, path: &str) -> Option<String> {
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
        Ok(stream) => stream,
        Err(_) => return None,
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        addr.ip(),
        addr.port(),
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return None;
    }

    let mut response = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 512];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&buffer[..read]),
            Err(_) => return None,
        }
    }

    if response.is_empty() {
        return None;
    }

    Some(String::from_utf8_lossy(&response).into_owned())
}

fn backend_http_probe_succeeds(addr: SocketAddr, path: &str) -> bool {
    let Some(response) = backend_http_response(addr, path) else {
        return false;
    };
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn backend_response_body(response: &str) -> Option<&str> {
    response.split_once("\r\n\r\n").map(|(_, body)| body)
}

fn health_response_identifies_mely_backend(response: &str) -> bool {
    if !(response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")) {
        return false;
    }

    let Some(body) = backend_response_body(response) else {
        return false;
    };
    let Ok(payload) = serde_json::from_str::<Value>(body) else {
        return false;
    };

    payload
        .get("app")
        .and_then(Value::as_str)
        .map(|app| app == "mely-backend")
        .unwrap_or(false)
}

fn detect_existing_backend_state(addr: SocketAddr) -> ExistingBackendState {
    let Some(response) = backend_http_response(addr, BACKEND_HEALTH_PATH) else {
        return ExistingBackendState::Clear;
    };

    if health_response_identifies_mely_backend(&response) {
        ExistingBackendState::MelyBackend
    } else {
        ExistingBackendState::OtherService
    }
}

fn wait_for_backend_port_to_clear(addr: SocketAddr, attempts: usize, delay: Duration) -> bool {
    for attempt in 0..attempts {
        if matches!(detect_existing_backend_state(addr), ExistingBackendState::Clear) {
            return true;
        }

        if attempt + 1 < attempts {
            thread::sleep(delay);
        }
    }

    false
}

#[cfg(windows)]
fn terminate_existing_backend_processes() -> bool {
    match Command::new("taskkill")
        .args(["/IM", backend_executable_name(), "/F", "/T"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn terminate_existing_backend_processes() -> bool {
    false
}

fn ensure_backend_port_available(addr: SocketAddr) -> bool {
    match detect_existing_backend_state(addr) {
        ExistingBackendState::Clear => true,
        ExistingBackendState::MelyBackend => {
            eprintln!(
                "[mely] detected an existing mely-backend on port {}; attempting cleanup",
                addr.port()
            );
            let _ = terminate_existing_backend_processes();
            wait_for_backend_port_to_clear(
                addr,
                BACKEND_STARTUP_ATTEMPTS,
                Duration::from_millis(BACKEND_STARTUP_DELAY_MS),
            )
        }
        ExistingBackendState::OtherService => {
            eprintln!(
                "[mely] backend port {} is occupied by another process; startup aborted",
                addr.port()
            );
            false
        }
    }
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

fn spawn_backend<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Child>, String> {
    let Some(exe) = backend_exe_path(app) else {
        return Ok(None);
    };
    if !exe.exists() {
        return Err(format!(
            "backend executable not found at {}",
            exe.display()
        ));
    }

    let addr = backend_socket_addr(BACKEND_PORT);
    if !ensure_backend_port_available(addr) {
        return Err(format!(
            "backend port {} could not be prepared for launch",
            BACKEND_PORT
        ));
    }

    let mut command = Command::new(&exe);
    let desktop_build_version = app.package_info().version.to_string();
    command.env("MELY_BACKEND_PORT", BACKEND_PORT.to_string());
    command.env("MELY_DESKTOP_BUILD_VERSION", desktop_build_version.clone());
    command.env("MELY_BACKEND_EXECUTABLE", &exe);

    if let Ok(resource_dir) = app.path().resource_dir() {
        let runtime_root = resolve_llm_runtime_root_from_resource_dir(&resource_dir);
        command.env("MELY_LLM_RUNTIME_RESOURCE_ROOT", &runtime_root);
        if let Some(summary_path) = resolve_build_summary_path_from_resource_dir(&resource_dir) {
            command.env("MELY_WINDOWS_BUILD_SUMMARY_PATH", summary_path);
        }
        eprintln!(
            "[mely] launching backend sidecar: build_version={} backend={} runtime_root={}",
            desktop_build_version,
            exe.display(),
            runtime_root.display(),
        );
    } else {
        eprintln!(
            "[mely] launching backend sidecar: build_version={} backend={}",
            desktop_build_version,
            exe.display(),
        );
    }

    match command.spawn() {
        Ok(mut child) => {
            let ready = wait_for_backend_ready(
                addr,
                BACKEND_STARTUP_ATTEMPTS,
                Duration::from_millis(BACKEND_STARTUP_DELAY_MS),
            );

            if ready {
                Ok(Some(child))
            } else {
                let message = format!(
                    "backend sidecar did not expose the required API within {} ms",
                    BACKEND_STARTUP_ATTEMPTS as u64 * BACKEND_STARTUP_DELAY_MS
                );
                eprintln!("[mely] {message}");
                let _ = child.kill();
                let _ = child.wait();
                Err(message)
            }
        }
        Err(error) => {
            Err(format!("failed to start backend sidecar: {error}"))
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
            match spawn_backend(app.handle()) {
                Ok(Some(child)) => {
                    let backend_process = app.state::<BackendProcess>();
                    let mut guard = backend_process
                        .0
                        .lock()
                        .expect("backend process mutex poisoned");
                    *guard = Some(child);
                }
                Ok(None) => {}
                Err(message) => {
                    return Err(std::io::Error::other(message).into());
                }
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
    fn resolves_nested_resource_bundle_path() {
        let root = unique_temp_dir("nested");
        let nested_dir = root.join("resources").join("mely-backend");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        let nested_exe = nested_dir.join(backend_executable_name());
        fs::write(&nested_exe, b"test").expect("write executable");

        let resolved = resolve_backend_exe_from_resource_dir(&root);

        assert_eq!(resolved, nested_exe);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn falls_back_to_direct_resource_bundle_path() {
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
    fn prefers_nested_resource_bundle_when_both_paths_exist() {
        let root = unique_temp_dir("both-backend-paths");
        let direct_dir = root.join("mely-backend");
        let nested_dir = root.join("resources").join("mely-backend");
        fs::create_dir_all(&direct_dir).expect("create direct dir");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        let direct_exe = direct_dir.join(backend_executable_name());
        let nested_exe = nested_dir.join(backend_executable_name());
        fs::write(&direct_exe, b"direct").expect("write direct executable");
        fs::write(&nested_exe, b"nested").expect("write nested executable");

        let resolved = resolve_backend_exe_from_resource_dir(&root);

        assert_eq!(resolved, nested_exe);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn resolves_nested_llm_runtime_resource_path() {
        let root = unique_temp_dir("llm-runtime-nested");
        let nested_dir = root.join("resources").join("llm-runtime");
        fs::create_dir_all(&nested_dir).expect("create nested runtime dir");

        let resolved = resolve_llm_runtime_root_from_resource_dir(&root);

        assert_eq!(resolved, nested_dir);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn falls_back_to_direct_llm_runtime_resource_path() {
        let root = unique_temp_dir("llm-runtime-direct");
        let direct_dir = root.join("llm-runtime");
        fs::create_dir_all(&direct_dir).expect("create direct runtime dir");

        let resolved = resolve_llm_runtime_root_from_resource_dir(&root);

        assert_eq!(resolved, direct_dir);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn prefers_nested_llm_runtime_resource_when_both_paths_exist() {
        let root = unique_temp_dir("llm-runtime-both-paths");
        let direct_dir = root.join("llm-runtime");
        let nested_dir = root.join("resources").join("llm-runtime");
        fs::create_dir_all(&direct_dir).expect("create direct runtime dir");
        fs::create_dir_all(&nested_dir).expect("create nested runtime dir");

        let resolved = resolve_llm_runtime_root_from_resource_dir(&root);

        assert_eq!(resolved, nested_dir);
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn resolves_nested_build_summary_path() {
        let root = unique_temp_dir("build-summary-nested");
        let nested_path = root
            .join("resources")
            .join("windows-training-release-artifacts.txt");
        fs::create_dir_all(nested_path.parent().expect("nested parent")).expect("create nested path");
        fs::write(&nested_path, b"summary").expect("write nested summary");

        let resolved = resolve_build_summary_path_from_resource_dir(&root);

        assert_eq!(resolved, Some(nested_path));
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn resolves_direct_build_summary_path_when_nested_missing() {
        let root = unique_temp_dir("build-summary-direct");
        let direct_path = root.join("windows-training-release-artifacts.txt");
        fs::write(&direct_path, b"summary").expect("write direct summary");

        let resolved = resolve_build_summary_path_from_resource_dir(&root);

        assert_eq!(resolved, Some(direct_path));
        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn prefers_nested_build_summary_path_when_both_exist() {
        let root = unique_temp_dir("build-summary-both");
        let nested_path = root
            .join("resources")
            .join("windows-training-release-artifacts.txt");
        let direct_path = root.join("windows-training-release-artifacts.txt");
        fs::create_dir_all(nested_path.parent().expect("nested parent")).expect("create nested path");
        fs::write(&nested_path, b"nested").expect("write nested summary");
        fs::write(&direct_path, b"direct").expect("write direct summary");

        let resolved = resolve_build_summary_path_from_resource_dir(&root);

        assert_eq!(resolved, Some(nested_path));
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

    #[test]
    fn health_response_identifies_mely_backend_payload() {
        let response = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Content-Type: application/json\r\n",
            "Connection: close\r\n\r\n",
            "{\"status\":\"ok\",\"app\":\"mely-backend\"}"
        );

        assert!(health_response_identifies_mely_backend(response));
    }

    #[test]
    fn health_response_rejects_other_service_payload() {
        let response = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Content-Type: application/json\r\n",
            "Connection: close\r\n\r\n",
            "{\"status\":\"ok\",\"app\":\"other-service\"}"
        );

        assert!(!health_response_identifies_mely_backend(response));
    }

    #[test]
    fn detects_existing_mely_backend_from_health_probe() {
        let listener = TcpListener::bind(backend_socket_addr(0)).expect("bind ephemeral port");
        let addr = listener.local_addr().expect("read local addr");
        let handle = thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept probe");
            let mut request = [0_u8; 256];
            let _ = socket.read(&mut request);
            socket
                .write_all(
                    concat!(
                        "HTTP/1.1 200 OK\r\n",
                        "Content-Type: application/json\r\n",
                        "Connection: close\r\n\r\n",
                        "{\"status\":\"ok\",\"app\":\"mely-backend\"}"
                    )
                    .as_bytes(),
                )
                .expect("write probe response");
        });

        let state = detect_existing_backend_state(addr);

        assert_eq!(state, ExistingBackendState::MelyBackend);
        handle.join().expect("join probe server");
    }

    #[test]
    fn detects_other_service_from_health_probe() {
        let listener = TcpListener::bind(backend_socket_addr(0)).expect("bind ephemeral port");
        let addr = listener.local_addr().expect("read local addr");
        let handle = thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept probe");
            let mut request = [0_u8; 256];
            let _ = socket.read(&mut request);
            socket
                .write_all(
                    concat!(
                        "HTTP/1.1 200 OK\r\n",
                        "Content-Type: application/json\r\n",
                        "Connection: close\r\n\r\n",
                        "{\"status\":\"ok\",\"app\":\"other-service\"}"
                    )
                    .as_bytes(),
                )
                .expect("write probe response");
        });

        let state = detect_existing_backend_state(addr);

        assert_eq!(state, ExistingBackendState::OtherService);
        handle.join().expect("join probe server");
    }
}
