const API_BASE_URL = "http://127.0.0.1:8000";

export type EngineState =
  | "stopped"
  | "starting"
  | "running"
  | "crashed"
  | "restarting"
  | "failed";

export type EngineStatus = {
  state: EngineState;
  restartCount: number;
  errorMessage: string | null;
  pid: number | null;
};

export type EngineStartResponse = {
  status: EngineStatus;
  message: string;
};

export type EngineStopResponse = {
  status: EngineStatus;
  message: string;
};

function isEngineStatus(value: unknown): value is EngineStatus {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["state"] === "string" &&
    typeof v["restartCount"] === "number" &&
    ("errorMessage" in v ? v["errorMessage"] === null || typeof v["errorMessage"] === "string" : true) &&
    ("pid" in v ? v["pid"] === null || typeof v["pid"] === "number" : true)
  );
}

function isEngineStartResponse(value: unknown): value is EngineStartResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isEngineStatus(v["status"]) && typeof v["message"] === "string";
}

function isEngineStopResponse(value: unknown): value is EngineStopResponse {
  return isEngineStartResponse(value);
}

function readBackendDetail(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null) {
    const detail = (payload as Record<string, unknown>)["detail"];
    if (typeof detail === "string") return detail;
  }
  return null;
}

export async function fetchEngineStatus(
  signal?: AbortSignal
): Promise<EngineStatus> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/engine/status`, { signal });
  } catch {
    throw new Error("ENGINE_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("ENGINE_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    const detail = readBackendDetail(payload);
    throw new Error(detail ?? "ENGINE_SERVICE_UNAVAILABLE");
  }

  if (!isEngineStatus(payload)) {
    throw new Error("ENGINE_INVALID_RESPONSE");
  }

  return payload;
}

export async function startEngine(
  signal?: AbortSignal
): Promise<EngineStartResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/engine/start`, {
      method: "POST",
      signal,
    });
  } catch {
    throw new Error("ENGINE_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("ENGINE_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    const detail = readBackendDetail(payload);
    throw new Error(detail ?? "ENGINE_START_FAILED");
  }

  if (!isEngineStartResponse(payload)) {
    throw new Error("ENGINE_INVALID_RESPONSE");
  }

  return payload;
}

export async function stopEngine(
  signal?: AbortSignal
): Promise<EngineStopResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/engine/stop`, {
      method: "POST",
      signal,
    });
  } catch {
    throw new Error("ENGINE_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("ENGINE_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    const detail = readBackendDetail(payload);
    throw new Error(detail ?? "ENGINE_STOP_FAILED");
  }

  if (!isEngineStopResponse(payload)) {
    throw new Error("ENGINE_INVALID_RESPONSE");
  }

  return payload;
}
