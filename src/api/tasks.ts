export type TaskStatus = "pending" | "running" | "completed" | "failed";

export type TaskSnapshot = {
  id: string;
  name: string;
  status: TaskStatus;
  progress: number;
  message?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskEvent = {
  event: "task_updated";
  task: TaskSnapshot;
};

export type TaskConnectionState = "connecting" | "connected" | "disconnected";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_WS_BASE_URL = "ws://127.0.0.1:8000";

type MockTaskMode = "success" | "failure";

function resolveTaskCreateUrl(): string {
  return `${DEFAULT_API_BASE_URL}/api/tasks/mock`;
}

function resolveTaskStreamUrl(): string {
  return `${DEFAULT_WS_BASE_URL}/api/tasks/stream`;
}

function isTaskSnapshot(value: unknown): value is TaskSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<TaskSnapshot>;
  const isValidStatus =
    candidate.status === "pending" ||
    candidate.status === "running" ||
    candidate.status === "completed" ||
    candidate.status === "failed";

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    isValidStatus &&
    typeof candidate.progress === "number" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isTaskCreateResponse(value: unknown): value is { task: TaskSnapshot } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { task?: unknown };
  return isTaskSnapshot(candidate.task);
}

function isTaskEvent(value: unknown): value is TaskEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<TaskEvent>;
  return candidate.event === "task_updated" && isTaskSnapshot(candidate.task);
}

export async function createMockTask(
  mode: MockTaskMode,
  signal?: AbortSignal,
): Promise<TaskSnapshot> {
  let response: Response;
  try {
    response = await fetch(resolveTaskCreateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
      signal,
    });
  } catch {
    throw new Error("TASK_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("INVALID_TASK_RESPONSE");
  }

  if (!isTaskCreateResponse(payload)) {
    throw new Error("INVALID_TASK_RESPONSE");
  }

  if (!response.ok) {
    throw new Error("TASK_REQUEST_FAILED");
  }

  return payload.task;
}

export function createTaskStream(
  onEvent: (event: TaskEvent) => void,
  onConnectionChange?: (state: TaskConnectionState) => void,
): () => void {
  if (typeof WebSocket === "undefined") {
    onConnectionChange?.("disconnected");
    return () => {};
  }

  onConnectionChange?.("connecting");
  const socket = new WebSocket(resolveTaskStreamUrl());

  socket.onopen = () => {
    onConnectionChange?.("connected");
  };

  socket.onerror = () => {
    onConnectionChange?.("disconnected");
  };

  socket.onclose = () => {
    onConnectionChange?.("disconnected");
  };

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (isTaskEvent(payload)) {
        onEvent(payload);
      }
    } catch {
      // Ignore malformed websocket payloads.
    }
  };

  return () => {
    socket.onopen = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.onmessage = null;

    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close();
    }

    onConnectionChange?.("disconnected");
  };
}
