import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import App from "./App";

const fetchMock = vi.fn();

type CharacterItem = {
  id: string;
  name: string;
  createdAt: string;
  fingerprint?: string | null;
};

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

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

function buildCharactersResponse(items: CharacterItem[]) {
  return {
    items,
    total: items.length,
  };
}

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

test("shows an empty state with create entry when no characters exist", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildCharactersResponse([]),
  });

  render(<App />);

  expect(screen.getByText("正在加载角色库...")).toBeInTheDocument();
  await screen.findByText("还没有角色");
  expect(screen.getByRole("button", { name: "创建你的第一个角色" })).toBeInTheDocument();
  expect(screen.getByText("任务队列验证")).toBeInTheDocument();
});

test("renders character cards in a grid when the API returns data", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () =>
      buildCharactersResponse([
        {
          id: "char-1",
          name: "星野ミカ",
          createdAt: "2026-03-26T09:00:00Z",
          fingerprint: "fp-001",
        },
        {
          id: "char-2",
          name: "黑渊",
          createdAt: "2026-03-25T09:00:00Z",
          fingerprint: null,
        },
      ]),
  });

  render(<App />);

  await screen.findByRole("button", { name: "打开角色 星野ミカ" });
  expect(screen.getByRole("button", { name: "打开角色 黑渊" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建新角色入口" })).toBeInTheDocument();
});

test("opens the detail shell when clicking a character card and allows returning", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () =>
      buildCharactersResponse([
        {
          id: "char-1",
          name: "星野ミカ",
          createdAt: "2026-03-26T09:00:00Z",
          fingerprint: "fp-001",
        },
      ]),
  });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("角色详情（空壳）");
  expect(screen.getByText("星野ミカ")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "返回角色库" }));
  await screen.findByRole("button", { name: "打开角色 星野ミカ" });
});

test("shows a retry flow in Chinese when loading the character list fails", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockRejectedValueOnce(new Error("network down"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildCharactersResponse([]),
    });

  render(<App />);

  await screen.findByText("角色列表加载失败，请重试");
  await user.click(screen.getByRole("button", { name: "重试加载" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  await screen.findByText("还没有角色");
});

test("shows streamed progress updates after starting a mock task", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
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

  render(<App />);

  await screen.findByText("任务队列验证");

  const stream = MockWebSocket.instances[0];
  stream.emitOpen();

  await user.click(screen.getByRole("button", { name: "启动成功模拟任务" }));

  await screen.findByText("mock-success");
  expect(screen.getByText("排队中")).toBeInTheDocument();

  stream.emitMessage({
    event: "task_updated",
    task: {
      id: "task-1",
      name: "mock-success",
      status: "running",
      progress: 60,
      message: "模拟任务进行中（3/5）",
      error: null,
      createdAt: "2026-03-27T00:00:00+00:00",
      updatedAt: "2026-03-27T00:00:01+00:00",
    },
  });

  await screen.findByText("运行中");
  expect(screen.getByText("60%")).toBeInTheDocument();
});
