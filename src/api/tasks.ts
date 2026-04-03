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

export type TaskStreamOptions = {
  reconnect?: {
    enabled?: boolean;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    maxAttempts?: number;
  };
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_WS_BASE_URL = "ws://127.0.0.1:8000";
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;
const DEFAULT_RECONNECT_BACKOFF_FACTOR = 2;

type ResolvedReconnectConfig = {
  enabled: boolean;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  maxAttempts: number | null;
};

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

function resolveReconnectConfig(options?: TaskStreamOptions): ResolvedReconnectConfig {
  const reconnectOptions = options?.reconnect;
  const initialDelayMs = Math.max(
    0,
    reconnectOptions?.initialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS,
  );
  const maxDelayMs = Math.max(
    initialDelayMs,
    reconnectOptions?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
  );
  const backoffFactor = Math.max(
    1,
    reconnectOptions?.backoffFactor ?? DEFAULT_RECONNECT_BACKOFF_FACTOR,
  );
  const rawMaxAttempts = reconnectOptions?.maxAttempts;
  const maxAttempts =
    rawMaxAttempts === undefined ? null : Math.max(0, Math.floor(rawMaxAttempts));

  return {
    enabled: reconnectOptions?.enabled ?? true,
    initialDelayMs,
    maxDelayMs,
    backoffFactor,
    maxAttempts,
  };
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
  options?: TaskStreamOptions,
): () => void {
  if (typeof WebSocket === "undefined") {
    onConnectionChange?.("disconnected");
    return () => {};
  }

  const reconnectConfig = resolveReconnectConfig(options);
  let disposed = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSocket: WebSocket | null = null;
  let connectionState: TaskConnectionState | null = null;

  const emitConnectionState = (state: TaskConnectionState) => {
    if (connectionState === state) {
      return;
    }
    connectionState = state;
    onConnectionChange?.(state);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const teardownSocket = (socket: WebSocket | null) => {
    if (socket === null) {
      return;
    }

    socket.onopen = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.onmessage = null;
  };

  const scheduleReconnect = () => {
    if (!reconnectConfig.enabled || disposed) {
      return;
    }

    if (
      reconnectConfig.maxAttempts !== null &&
      reconnectAttempts >= reconnectConfig.maxAttempts
    ) {
      return;
    }

    const delay = Math.min(
      reconnectConfig.initialDelayMs * reconnectConfig.backoffFactor ** reconnectAttempts,
      reconnectConfig.maxDelayMs,
    );
    reconnectAttempts += 1;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed) {
      return;
    }

    emitConnectionState("connecting");
    const socket = new WebSocket(resolveTaskStreamUrl());
    activeSocket = socket;

    socket.onopen = () => {
      if (disposed || activeSocket !== socket) {
        return;
      }
      reconnectAttempts = 0;
      emitConnectionState("connected");
    };

    socket.onerror = () => {
      if (disposed || activeSocket !== socket) {
        return;
      }
      emitConnectionState("disconnected");
    };

    socket.onclose = () => {
      if (activeSocket !== socket) {
        return;
      }

      activeSocket = null;
      teardownSocket(socket);
      emitConnectionState("disconnected");
      scheduleReconnect();
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
  };

  connect();

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearReconnectTimer();

    const socket = activeSocket;
    activeSocket = null;
    teardownSocket(socket);

    if (
      socket &&
      (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
    ) {
      socket.close();
    }

    emitConnectionState("disconnected");
  };
}
