import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  fetchLLMCatalog,
  deleteLLMRuntimeModel,
  type LLMCatalogResponse,
} from "../api/llmCatalog";
import { fetchCharacterLLMPreferences, updateCharacterLLMPreferences } from "../api/llmPreferences";
import { pullLLMModel } from "../api/llmPull";
import type { LLMRuntimeStatus } from "../api/llmRuntime";
import { ModelLibraryPanel } from "./ModelLibraryPanel";

vi.mock("../api/llmCatalog", () => ({
  fetchLLMCatalog: vi.fn(),
  deleteLLMRuntimeModel: vi.fn(),
}));

vi.mock("../api/llmPull", () => ({
  pullLLMModel: vi.fn(),
}));

vi.mock("../api/llmPreferences", () => ({
  fetchCharacterLLMPreferences: vi.fn(),
  updateCharacterLLMPreferences: vi.fn(),
}));

const defaultRuntime: LLMRuntimeStatus = {
  installed: true,
  running: true,
  version: "0.6.0",
  minimumVersion: "0.3.10",
  platform: "darwin-arm64",
  hint: null,
  models: [
    {
      name: "qwen2.5:7b-instruct-q4_K_M",
      sizeBytes: 4_500_000_000,
      modifiedAt: "2026-04-07T00:00:00Z",
      digest: "sha256:default",
    },
  ],
};

const catalog: LLMCatalogResponse = {
  items: [
    {
      id: "default-chat",
      modelName: "qwen2.5:7b-instruct-q4_K_M",
      displayName: "默认对话",
      kind: "text",
      tier: "default",
      sizeLabel: "约 4.5 GB",
      recommended: true,
      visionCapable: false,
      minOllamaVersion: null,
      memoryHint: "M1 16GB / RTX 3070 8GB 可用",
    },
    {
      id: "light-chat",
      modelName: "qwen2.5:3b",
      displayName: "轻量对话",
      kind: "text",
      tier: "light",
      sizeLabel: "约 2 GB",
      recommended: false,
      visionCapable: false,
      minOllamaVersion: null,
      memoryHint: "更快，质量较弱",
    },
    {
      id: "vision-chat",
      modelName: "minicpm-v:8b",
      displayName: "多模态",
      kind: "vision",
      tier: "vision",
      sizeLabel: "约 5 GB",
      recommended: false,
      visionCapable: true,
      minOllamaVersion: "0.3.10",
      memoryHint: "按需下载",
    },
  ],
};

beforeEach(() => {
  vi.mocked(fetchLLMCatalog).mockResolvedValue(catalog);
  vi.mocked(fetchCharacterLLMPreferences).mockResolvedValue({
    characterId: "char-1",
    defaultBaseModelName: "qwen2.5:7b-instruct-q4_K_M",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("renders catalog cards and runtime status badges", async () => {
  render(
    <ModelLibraryPanel
      characterId="char-1"
      runtimeStatus={defaultRuntime}
      onRefreshRuntime={() => Promise.resolve()}
    />,
  );

  await screen.findByText("默认对话");
  expect(screen.getByText("轻量对话")).toBeInTheDocument();
  expect(screen.getByTestId("model-card-vision-chat")).toBeInTheDocument();
  expect(screen.getByText("已就绪")).toBeInTheDocument();
  expect(screen.getAllByText("未下载").length).toBeGreaterThan(0);
  expect(screen.getByText("当前默认")).toBeInTheDocument();
});

test("shows download progress during pull", async () => {
  const user = userEvent.setup();
  let resolvePull: (() => void) | null = null;
  vi.mocked(pullLLMModel).mockImplementation(async (_modelName, onEvent) => {
    onEvent({ status: "pulling manifest", phase: "正在获取模型信息" });
    onEvent({
      status: "downloading",
      phase: "正在下载",
      percent: 42,
      total: 2_000_000_000,
      completed: 840_000_000,
    });
    await new Promise<void>((resolve) => {
      resolvePull = () => {
        onEvent({ status: "done", phase: "下载完成" });
        resolve();
      };
    });
  });

  render(
    <ModelLibraryPanel
      characterId="char-1"
      runtimeStatus={defaultRuntime}
      onRefreshRuntime={() => Promise.resolve()}
    />,
  );

  const lightCard = await screen.findByTestId("model-card-light-chat");
  await user.click(within(lightCard).getByRole("button", { name: "下载" }));

  await screen.findByText("下载中 42%");
  expect(screen.getByText("正在下载")).toBeInTheDocument();
  expect(screen.getByText("已下载 801 MB / 1.86 GB")).toBeInTheDocument();

  (resolvePull as (() => void) | null)?.();
});

test("sets selected model as character default", async () => {
  const user = userEvent.setup();
  const runtimeWithLightModel: LLMRuntimeStatus = {
    ...defaultRuntime,
    models: [
      ...defaultRuntime.models,
      {
        name: "qwen2.5:3b",
        sizeBytes: 2_000_000_000,
        modifiedAt: "2026-04-07T00:00:00Z",
        digest: "sha256:light",
      },
    ],
  };
  vi.mocked(updateCharacterLLMPreferences).mockResolvedValue({
    characterId: "char-1",
    defaultBaseModelName: "qwen2.5:3b",
  });

  render(
    <ModelLibraryPanel
      characterId="char-1"
      runtimeStatus={runtimeWithLightModel}
      onRefreshRuntime={() => Promise.resolve()}
    />,
  );

  const lightCard = await screen.findByTestId("model-card-light-chat");
  await user.click(within(lightCard).getByRole("button", { name: "设为默认" }));

  await waitFor(() => {
    expect(updateCharacterLLMPreferences).toHaveBeenCalledWith("char-1", {
      defaultBaseModelName: "qwen2.5:3b",
    });
  });
  expect(within(lightCard).getByText("当前默认")).toBeInTheDocument();
});

test("deletes installed model", async () => {
  const user = userEvent.setup();
  const runtimeWithLightModel: LLMRuntimeStatus = {
    ...defaultRuntime,
    models: [
      ...defaultRuntime.models,
      {
        name: "qwen2.5:3b",
        sizeBytes: 2_000_000_000,
        modifiedAt: "2026-04-07T00:00:00Z",
        digest: "sha256:light",
      },
    ],
  };
  vi.mocked(deleteLLMRuntimeModel).mockResolvedValue();

  render(
    <ModelLibraryPanel
      characterId="char-1"
      runtimeStatus={runtimeWithLightModel}
      onRefreshRuntime={() => Promise.resolve()}
    />,
  );

  const lightCard = await screen.findByTestId("model-card-light-chat");
  await user.click(within(lightCard).getByRole("button", { name: "删除" }));

  await waitFor(() => {
    expect(deleteLLMRuntimeModel).toHaveBeenCalledWith("qwen2.5:3b");
  });
});
