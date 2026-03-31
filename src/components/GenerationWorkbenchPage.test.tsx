import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { GenerationWorkbenchPage } from "./GenerationWorkbenchPage";

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildContract(overrides: Record<string, unknown> = {}) {
  return {
    characterId: "char-1",
    characterName: "星野ミカ",
    canGenerate: true,
    blockingReason: null,
    selectedCostumeId: "costume-1",
    costumes: [{ id: "costume-1", name: "基础造型", costumePrompt: "", isDefault: true }],
    promptSources: { dnaPrompt: "pink hair, violet eyes", triggerWord: "hoshino_mika", costumePrompt: "" },
    parameterDefaults: { width: 1024, height: 1024, steps: 28, sampler: "DPM++ 2M Karras", cfgScale: 3.5, seed: null, loraWeight: 0.85 },
    tagOptions: ["封面图", "表情包", "周边", "预告图"],
    ...overrides,
  };
}

function buildAssembled() {
  return {
    assembled: "hoshino_mika, pink hair, 在咖啡馆",
    tokenCount: 5,
    wasOverridden: false,
    components: [
      { source: "trigger_word", label: "LoRA 触发词", content: "hoshino_mika", active: true },
      { source: "dna_prompt", label: "角色 DNA", content: "pink hair", active: true },
      { source: "costume_prompt", label: "造型词", content: "", active: false },
      { source: "scene_prompt", label: "场景描述", content: "在咖啡馆", active: true },
    ],
  };
}

function buildJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1", taskId: "task-1", characterId: "char-1", costumeId: "costume-1",
    scenePrompt: "在咖啡馆", status: "pending", stage: "queued", progress: 0,
    message: "生成任务已进入队列", error: null, tags: [],
    createdAt: "2026-03-31T00:00:00Z", updatedAt: "2026-03-31T00:00:00Z",
    ...overrides,
  };
}

function buildEngineStatus(state = "stopped") {
  return { state, restartCount: 0, errorMessage: null, pid: null };
}

/** Route fetch calls by URL substring. */
function routedFetch(routes: Record<string, () => unknown>) {
  return (url: string) => {
    for (const [key, factory] of Object.entries(routes)) {
      if (url.includes(key)) {
        return Promise.resolve({ ok: true, json: async () => factory() });
      }
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("renders loading state initially", () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText("正在加载生成工作台…")).toBeInTheDocument();
});

test("renders costume selector and prompt panel after contract loads", async () => {
  fetchMock.mockImplementation(
    routedFetch({
      "/engine/status": () => buildEngineStatus("stopped"),
      "/generation-workbench": () => buildContract(),
      "/prompt/assemble": () => buildAssembled(),
    })
  );

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");
  expect(screen.getByPlaceholderText(/在直播封面/)).toBeInTheDocument();
});

test("shows blocking message when character cannot generate", async () => {
  fetchMock.mockImplementation(
    routedFetch({
      "/engine/status": () => buildEngineStatus(),
      "/generation-workbench": () =>
        buildContract({ canGenerate: false, blockingReason: "该角色当前还不能生成，请先完成视觉训练。" }),
    })
  );

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("该角色当前还不能生成，请先完成视觉训练。");
  // When canGenerate=false the generate button shows a disabled message.
  expect(screen.getByText(/无法生成/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /无法生成/ })).toBeDisabled();
});

test("shows error message when contract fails to load", async () => {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/engine/status")) {
      return Promise.resolve({ ok: true, json: async () => buildEngineStatus() });
    }
    return Promise.reject(new Error("GENERATION_CONTRACT_UNAVAILABLE"));
  });

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("生成工作台加载失败，请稍后重试。");
});

test("submit button becomes enabled after prompt is confirmed", async () => {
  const user = userEvent.setup();

  fetchMock.mockImplementation(
    routedFetch({
      "/engine/status": () => buildEngineStatus("running"),
      "/generation-workbench": () => buildContract(),
      "/prompt/assemble": () => buildAssembled(),
    })
  );

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");
  await user.type(screen.getByPlaceholderText(/在直播封面/), "在咖啡馆");
  await screen.findByText(/组装结果/);
  await user.click(screen.getByRole("button", { name: "使用此 Prompt" }));

  expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();
});

test("submits generation job and shows progress via WebSocket", async () => {
  const user = userEvent.setup();

  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/generations/mock") && opts?.method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ job: buildJob() }) });
    }
    if (url.includes("/engine/status")) {
      return Promise.resolve({ ok: true, json: async () => buildEngineStatus("running") });
    }
    if (url.includes("/generation-workbench")) {
      return Promise.resolve({ ok: true, json: async () => buildContract() });
    }
    return Promise.resolve({ ok: true, json: async () => buildAssembled() });
  });

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");
  await user.type(screen.getByPlaceholderText(/在直播封面/), "在咖啡馆");
  await screen.findByText(/组装结果/);
  await user.click(screen.getByRole("button", { name: "使用此 Prompt" }));

  const ws = MockWebSocket.instances[0];
  ws.emitOpen();

  await user.click(screen.getByRole("button", { name: "开始生成" }));

  ws.emitMessage({
    event: "task_updated",
    task: { id: "task-1", name: "gen", status: "running", progress: 55, message: "正在准备图像引擎", error: null, createdAt: "2026-03-31T00:00:00Z", updatedAt: "2026-03-31T00:00:01Z" },
  });

  await screen.findByText("正在准备图像引擎");
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
});

test("shows 再来一张 button after generation completes", async () => {
  const user = userEvent.setup();

  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/generations/mock") && opts?.method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ job: buildJob() }) });
    }
    if (url.includes("/engine/status")) {
      return Promise.resolve({ ok: true, json: async () => buildEngineStatus("running") });
    }
    if (url.includes("/generation-workbench")) {
      return Promise.resolve({ ok: true, json: async () => buildContract() });
    }
    return Promise.resolve({ ok: true, json: async () => buildAssembled() });
  });

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");
  await user.type(screen.getByPlaceholderText(/在直播封面/), "在咖啡馆");
  await screen.findByText(/组装结果/);
  await user.click(screen.getByRole("button", { name: "使用此 Prompt" }));

  const ws = MockWebSocket.instances[0];
  ws.emitOpen();
  await user.click(screen.getByRole("button", { name: "开始生成" }));

  ws.emitMessage({
    event: "task_updated",
    task: { id: "task-1", name: "gen", status: "completed", progress: 100, message: "任务已完成", error: null, createdAt: "2026-03-31T00:00:00Z", updatedAt: "2026-03-31T00:00:02Z" },
  });

  await screen.findByText("生成完成");
  expect(screen.getByRole("button", { name: "再来一张" })).toBeInTheDocument();
});
