import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createMockTask, createTaskStream } from "./tasks";

const fetchMock = vi.fn();
const eventMock = vi.fn();
const connectionMock = vi.fn();

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitError(): void {
    this.onerror?.({} as Event);
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  eventMock.mockReset();
  connectionMock.mockReset();
  MockWebSocket.instances = [];
});

test("creates mock task through the local backend endpoint", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      task: {
        id: "task-1",
        name: "mock-success",
        status: "pending",
        progress: 0,
        message: "任务已进入队列",
        error: null,
        createdAt: "2026-03-27T00:00:00+00:00",
        updatedAt: "2026-03-27T00:00:00+00:00",
      },
    }),
  });

  const task = await createMockTask("success");

  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/tasks/mock", {
    body: JSON.stringify({ mode: "success" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: undefined,
  });
  expect(task.status).toBe("pending");
  expect(task.id).toBe("task-1");
});

test("streams task events through websocket and reports connection status", () => {
  const disconnect = createTaskStream(eventMock, connectionMock);

  const ws = MockWebSocket.instances[0];
  expect(ws.url).toBe("ws://127.0.0.1:8000/api/tasks/stream");
  expect(connectionMock).toHaveBeenNthCalledWith(1, "connecting");

  ws.emitOpen();
  expect(connectionMock).toHaveBeenNthCalledWith(2, "connected");

  ws.emitMessage({
    event: "task_updated",
    task: {
      id: "task-2",
      name: "mock-success",
      status: "running",
      progress: 40,
      message: "模拟任务进行中（2/5）",
      error: null,
      createdAt: "2026-03-27T00:00:00+00:00",
      updatedAt: "2026-03-27T00:00:01+00:00",
    },
  });

  expect(eventMock).toHaveBeenCalledTimes(1);
  expect(eventMock).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "task_updated",
      task: expect.objectContaining({
        id: "task-2",
        status: "running",
        progress: 40,
      }),
    }),
  );

  disconnect();
  expect(connectionMock).toHaveBeenLastCalledWith("disconnected");
});

test("reconnects after websocket closes and keeps streaming task events", () => {
  vi.useFakeTimers();
  try {
    const disconnect = createTaskStream(eventMock, connectionMock);

    const firstSocket = MockWebSocket.instances[0];
    firstSocket.emitOpen();
    firstSocket.emitClose();

    expect(connectionMock).toHaveBeenCalledWith("disconnected");

    vi.advanceTimersByTime(500);
    expect(MockWebSocket.instances).toHaveLength(2);

    const secondSocket = MockWebSocket.instances[1];
    secondSocket.emitOpen();
    secondSocket.emitMessage({
      event: "task_updated",
      task: {
        id: "task-3",
        name: "mock-success",
        status: "running",
        progress: 80,
        message: "模拟任务进行中（4/5）",
        error: null,
        createdAt: "2026-03-27T00:00:00+00:00",
        updatedAt: "2026-03-27T00:00:03+00:00",
      },
    });

    expect(eventMock).toHaveBeenCalledTimes(1);
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ id: "task-3", progress: 80 }),
      }),
    );

    disconnect();
  } finally {
    vi.useRealTimers();
  }
});

test("does not reconnect after manual teardown", () => {
  vi.useFakeTimers();
  try {
    const disconnect = createTaskStream(eventMock, connectionMock);

    const socket = MockWebSocket.instances[0];
    socket.emitOpen();
    disconnect();
    socket.emitClose();

    vi.advanceTimersByTime(5_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
