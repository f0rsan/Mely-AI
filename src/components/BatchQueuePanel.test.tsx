import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { BatchQueuePanel } from "./BatchQueuePanel";

const fetchMock = vi.fn();

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }
  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

function buildBatchResponse(scenePrompts: string[]) {
  return {
    batchId: "batch-test",
    total: scenePrompts.length,
    jobs: scenePrompts.map((sp, i) => ({
      taskId: `task-${i + 1}`,
      scenePrompt: sp,
      status: "pending",
      progress: 0,
      message: "批量生成任务已进入队列",
      error: null,
      createdAt: "2026-03-31T00:00:00Z",
      updatedAt: "2026-03-31T00:00:00Z",
    })),
  };
}

const defaultParams = {
  width: 1024,
  height: 1024,
  steps: 28,
  sampler: "DPM++ 2M Karras",
  cfgScale: 3.5,
  seed: null,
  loraWeight: 0.85,
  tags: [],
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  MockWebSocket.instances = [];
});

test("renders textarea and submit button", () => {
  render(
    <BatchQueuePanel
      characterId="char-1"
      costumeId="costume-1"
      params={defaultParams}
    />,
  );

  expect(screen.getByPlaceholderText(/每行输入一个场景描述/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "提交批量生成" })).toBeInTheDocument();
});

test("submit button is disabled with empty input", () => {
  render(
    <BatchQueuePanel
      characterId="char-1"
      costumeId="costume-1"
      params={defaultParams}
    />,
  );

  expect(screen.getByRole("button", { name: "提交批量生成" })).toBeDisabled();
});

test("submit button becomes enabled after typing scenes", async () => {
  const user = userEvent.setup();

  render(
    <BatchQueuePanel
      characterId="char-1"
      costumeId="costume-1"
      params={defaultParams}
    />,
  );

  await user.type(screen.getByPlaceholderText(/每行输入一个场景描述/), "在咖啡馆");
  expect(screen.getByRole("button", { name: "提交批量生成" })).toBeEnabled();
});

test("shows job list after successful submit", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildBatchResponse(["在咖啡馆", "在海边"]),
  });

  render(
    <BatchQueuePanel
      characterId="char-1"
      costumeId="costume-1"
      params={defaultParams}
    />,
  );

  await user.type(
    screen.getByPlaceholderText(/每行输入一个场景描述/),
    "在咖啡馆{Enter}在海边",
  );
  await user.click(screen.getByRole("button", { name: "提交批量生成" }));

  const list = await screen.findByRole("list", { name: "批量任务队列" });
  expect(within(list).getByText("在咖啡馆")).toBeInTheDocument();
  expect(within(list).getByText("在海边")).toBeInTheDocument();
});

test("updates job status via WebSocket task events", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildBatchResponse(["在咖啡馆"]),
  });

  render(
    <BatchQueuePanel
      characterId="char-1"
      costumeId="costume-1"
      params={defaultParams}
    />,
  );

  await user.type(screen.getByPlaceholderText(/每行输入一个场景描述/), "在咖啡馆");
  await user.click(screen.getByRole("button", { name: "提交批量生成" }));

  await screen.findByRole("list", { name: "批量任务队列" });

  const ws = MockWebSocket.instances[0];
  ws.emitOpen();
  ws.emitMessage({
    event: "task_updated",
    task: {
      id: "task-1",
      name: "batch",
      status: "running",
      progress: 60,
      message: "正在准备图像引擎",
      error: null,
      createdAt: "2026-03-31T00:00:00Z",
      updatedAt: "2026-03-31T00:00:01Z",
    },
  });

  await screen.findByText("生成中");
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
});

test("shows 全部完成 after all jobs complete", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildBatchResponse(["在咖啡馆"]),
  });

  render(
    <BatchQueuePanel
      characterId="char-1"
      costumeId="costume-1"
      params={defaultParams}
    />,
  );

  await user.type(screen.getByPlaceholderText(/每行输入一个场景描述/), "在咖啡馆");
  await user.click(screen.getByRole("button", { name: "提交批量生成" }));

  await screen.findByRole("list", { name: "批量任务队列" });

  const ws = MockWebSocket.instances[0];
  ws.emitOpen();
  ws.emitMessage({
    event: "task_updated",
    task: {
      id: "task-1",
      name: "batch",
      status: "completed",
      progress: 100,
      message: "任务已完成",
      error: null,
      createdAt: "2026-03-31T00:00:00Z",
      updatedAt: "2026-03-31T00:00:02Z",
    },
  });

  await screen.findByText(/全部完成/);
  expect(screen.getByRole("button", { name: "重新开始" })).toBeInTheDocument();
});

test("shows error message on submit failure", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ detail: "该角色当前无法生成图像。" }),
  });

  render(
    <BatchQueuePanel
      characterId="char-1"
      costumeId="costume-1"
      params={defaultParams}
    />,
  );

  await user.type(screen.getByPlaceholderText(/每行输入一个场景描述/), "在咖啡馆");
  await user.click(screen.getByRole("button", { name: "提交批量生成" }));

  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("该角色当前无法生成图像。");
});

test("scene count indicator shows correct number", async () => {
  const user = userEvent.setup();

  render(
    <BatchQueuePanel
      characterId="char-1"
      costumeId="costume-1"
      params={defaultParams}
    />,
  );

  await user.type(
    screen.getByPlaceholderText(/每行输入一个场景描述/),
    "场景A{Enter}场景B{Enter}场景C",
  );

  expect(screen.getByText("3 个场景已输入")).toBeInTheDocument();
});
