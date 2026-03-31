/**
 * Integration tests for GenerationWorkbenchPage tab wiring:
 * - Tab switching between single / batch / history
 * - onRegenerate from history switches back to single tab with pre-filled params
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { GenerationWorkbenchPage } from "./GenerationWorkbenchPage";

const fetchMock = vi.fn();

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  constructor(url: string) { this.url = url; MockWebSocket.instances.push(this); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.({} as CloseEvent); }
  emitOpen() { this.readyState = MockWebSocket.OPEN; this.onopen?.({} as Event); }
}

function buildContract() {
  return {
    characterId: "char-1",
    characterName: "星野ミカ",
    canGenerate: true,
    blockingReason: null,
    selectedCostumeId: "costume-1",
    costumes: [{ id: "costume-1", name: "基础造型", costumePrompt: "", isDefault: true }],
    promptSources: { dnaPrompt: "pink hair", triggerWord: "hoshino_mika", costumePrompt: "" },
    parameterDefaults: { width: 1024, height: 1024, steps: 28, sampler: "DPM++ 2M Karras", cfgScale: 3.5, seed: null, loraWeight: 0.85 },
    tagOptions: ["封面图", "表情包", "周边", "预告图"],
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

function buildArchiveRecord() {
  return {
    id: "gen-1",
    characterId: "char-1",
    costumeId: "costume-1",
    outputPath: "/tmp/.mely/characters/char-1/generations/gen-1.png",
    paramsSnapshot: {
      assembledPrompt: "hoshino_mika, pink hair, 在咖啡馆",
      negativePrompt: "",
      width: 512,
      height: 512,
      steps: 20,
      sampler: "Euler a",
      cfgScale: 7.0,
      seed: 99,
      loraWeight: 0.9,
    },
    tags: ["封面图"],
    createdAt: "2026-03-31T00:00:00Z",
  };
}

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

test("tab bar renders three tabs after contract loads", async () => {
  fetchMock.mockImplementation(
    routedFetch({
      "/engine/status": () => ({ state: "running", restartCount: 0, errorMessage: null, pid: null }),
      "/generation-workbench": () => buildContract(),
      "/prompt/assemble": () => buildAssembled(),
    }),
  );

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");

  const tablist = screen.getByRole("tablist");
  expect(within(tablist).getByRole("tab", { name: "单张生成" })).toBeInTheDocument();
  expect(within(tablist).getByRole("tab", { name: "批量生成" })).toBeInTheDocument();
  expect(within(tablist).getByRole("tab", { name: "历史记录" })).toBeInTheDocument();
});

test("single tab is selected by default", async () => {
  fetchMock.mockImplementation(
    routedFetch({
      "/engine/status": () => ({ state: "running", restartCount: 0, errorMessage: null, pid: null }),
      "/generation-workbench": () => buildContract(),
      "/prompt/assemble": () => buildAssembled(),
    }),
  );

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");

  const singleTab = screen.getByRole("tab", { name: "单张生成" });
  expect(singleTab).toHaveAttribute("aria-selected", "true");
});

test("switching to 批量生成 tab shows batch textarea", async () => {
  const user = userEvent.setup();

  fetchMock.mockImplementation(
    routedFetch({
      "/engine/status": () => ({ state: "running", restartCount: 0, errorMessage: null, pid: null }),
      "/generation-workbench": () => buildContract(),
      "/prompt/assemble": () => buildAssembled(),
    }),
  );

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");
  await user.click(screen.getByRole("tab", { name: "批量生成" }));

  expect(screen.getByPlaceholderText(/每行输入一个场景描述/)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/在直播封面/)).not.toBeInTheDocument();
});

test("switching to 历史记录 tab shows gallery loading state", async () => {
  const user = userEvent.setup();

  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/engine/status")) {
      return Promise.resolve({ ok: true, json: async () => ({ state: "running", restartCount: 0, errorMessage: null, pid: null }) });
    }
    if (url.includes("/generation-workbench")) {
      return Promise.resolve({ ok: true, json: async () => buildContract() });
    }
    if (url.includes("/prompt/assemble")) {
      return Promise.resolve({ ok: true, json: async () => buildAssembled() });
    }
    // Gallery fetch — keep pending until we check loading state.
    if (url.includes("/generations")) {
      return new Promise(() => {});
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");
  await user.click(screen.getByRole("tab", { name: "历史记录" }));

  expect(screen.getByText("正在加载历史记录…")).toBeInTheDocument();
});

test("onRegenerate from history switches to single tab with params", async () => {
  const user = userEvent.setup();

  fetchMock.mockImplementation((url: string) => {
    if (url.includes("/engine/status")) {
      return Promise.resolve({ ok: true, json: async () => ({ state: "running", restartCount: 0, errorMessage: null, pid: null }) });
    }
    if (url.includes("/generation-workbench")) {
      return Promise.resolve({ ok: true, json: async () => buildContract() });
    }
    if (url.includes("/prompt/assemble")) {
      return Promise.resolve({ ok: true, json: async () => buildAssembled() });
    }
    if (url.includes("/generations")) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [buildArchiveRecord()] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });

  render(<GenerationWorkbenchPage characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");

  // Switch to history tab.
  await user.click(screen.getByRole("tab", { name: "历史记录" }));
  await screen.findByRole("list", { name: "生成历史缩略图" });

  // Open detail modal.
  await user.click(screen.getByRole("button", { name: /查看生成记录 gen-1/ }));
  expect(screen.getByRole("dialog", { name: "生成详情" })).toBeInTheDocument();

  // Click regenerate button.
  await user.click(screen.getByRole("button", { name: "用此参数重新生成" }));

  // Should switch back to single tab.
  expect(screen.getByRole("tab", { name: "单张生成" })).toHaveAttribute("aria-selected", "true");
  // Workbench (prompt panel) should be visible again.
  expect(screen.getByPlaceholderText(/在直播封面/)).toBeInTheDocument();
  // Modal should be gone.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
