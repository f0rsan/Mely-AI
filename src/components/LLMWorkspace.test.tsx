import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { fetchLLMRuntime, openLLMRuntime } from "../api/llmRuntime";
import { LLMWorkspace } from "./LLMWorkspace";

const chatPanelSpy = vi.fn();

vi.mock("../api/llmRuntime", () => ({
  fetchLLMRuntime: vi.fn(),
  openLLMRuntime: vi.fn(),
}));

vi.mock("./LLMDatasetPanel", () => ({
  LLMDatasetPanel: () => <div>llm-datasets-panel</div>,
}));

vi.mock("./LLMTrainingPanel", () => ({
  LLMTrainingPanel: () => <div>llm-training-panel</div>,
}));

vi.mock("./LLMModelPanel", () => ({
  LLMModelPanel: () => <div>llm-model-panel</div>,
}));

vi.mock("./ModelLibraryPanel", () => ({
  ModelLibraryPanel: () => <div>llm-library-panel</div>,
}));

vi.mock("./ChatPanel", () => ({
  ChatPanel: (props: unknown) => {
    chatPanelSpy(props);
    return <div>chat-panel-mock</div>;
  },
}));

function buildRuntime(overrides: Record<string, unknown> = {}) {
  return {
    installed: true,
    running: true,
    version: "0.6.0",
    minimumVersion: "0.3.10",
    platform: "darwin-arm64",
    models: [
      {
        name: "qwen2.5:7b-instruct-q4_K_M",
        sizeBytes: 4_500_000_000,
        modifiedAt: "2026-04-07T00:00:00Z",
        digest: "sha256:demo",
      },
    ],
    hint: null,
    ...overrides,
  };
}

beforeEach(() => {
  chatPanelSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("shows not installed state", async () => {
  vi.mocked(fetchLLMRuntime).mockResolvedValueOnce(
    buildRuntime({
      installed: false,
      running: false,
      version: null,
      models: [],
      hint: "未检测到语言引擎，请先安装 Ollama。",
    }),
  );

  render(<LLMWorkspace characterId="char-1" characterName="角色A" />);

  await screen.findByText("未检测到语言引擎");
  expect(screen.getByText("请先安装 Ollama 后再返回此页面。")).toBeInTheDocument();
});

test("opens runtime when user clicks start engine", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchLLMRuntime)
    .mockResolvedValueOnce(
      buildRuntime({
        installed: true,
        running: false,
        version: null,
        models: [],
        hint: "语言引擎未启动，请点击启动按钮后重试。",
      }),
    )
    .mockResolvedValueOnce(buildRuntime());
  vi.mocked(openLLMRuntime).mockResolvedValueOnce(undefined);

  render(<LLMWorkspace characterId="char-1" characterName="角色A" />);

  await screen.findByText("语言引擎未启动");
  await user.click(screen.getByRole("button", { name: "启动引擎" }));

  await waitFor(() => {
    expect(openLLMRuntime).toHaveBeenCalledTimes(1);
    expect(fetchLLMRuntime).toHaveBeenCalledTimes(2);
  });
});

test("rechecks runtime when user clicks refresh", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchLLMRuntime)
    .mockResolvedValueOnce(
      buildRuntime({
        installed: true,
        running: false,
        version: null,
        models: [],
        hint: "语言引擎未启动，请点击启动按钮后重试。",
      }),
    )
    .mockResolvedValueOnce(buildRuntime());

  render(<LLMWorkspace characterId="char-1" characterName="角色A" />);

  await screen.findByText("语言引擎未启动");
  await user.click(screen.getByRole("button", { name: "重新检测" }));

  await waitFor(() => {
    expect(fetchLLMRuntime).toHaveBeenCalledTimes(2);
  });
  await screen.findByText("语言引擎已就绪");
});

test("passes disabled reason to chat panel when runtime is not running", async () => {
  vi.mocked(fetchLLMRuntime).mockResolvedValueOnce(
    buildRuntime({
      installed: true,
      running: false,
      version: null,
      models: [],
      hint: "语言引擎未启动，请点击启动按钮后重试。",
    }),
  );

  render(
    <LLMWorkspace
      characterId="char-1"
      characterName="角色A"
      initialSubTab="chat"
    />,
  );

  await screen.findByText("语言引擎未启动");

  await waitFor(() => {
    expect(chatPanelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatDisabledReason: "语言引擎未启动，请先启动语言引擎。",
      }),
    );
  });
});
