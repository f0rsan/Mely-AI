import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  createChatSession,
  getChatMessages,
  listChatSessions,
  streamChatMessage,
} from "../api/chat";
import { fetchLLMCatalog } from "../api/llmCatalog";
import { fetchCharacterLLMPreferences } from "../api/llmPreferences";
import { fetchLLMRuntime } from "../api/llmRuntime";
import { ChatPanel } from "./ChatPanel";

vi.mock("../api/chat", () => ({
  createChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  getChatMessages: vi.fn(),
  listChatSessions: vi.fn(),
  streamChatMessage: vi.fn(),
}));

vi.mock("../api/llmCatalog", () => ({
  fetchLLMCatalog: vi.fn(),
  deleteLLMRuntimeModel: vi.fn(),
}));

vi.mock("../api/llmPreferences", () => ({
  fetchCharacterLLMPreferences: vi.fn(),
  updateCharacterLLMPreferences: vi.fn(),
}));

vi.mock("../api/llmRuntime", () => ({
  fetchLLMRuntime: vi.fn(),
  openLLMRuntime: vi.fn(),
}));

function mockFileReader(dataUrl = "data:image/png;base64,ZmFrZS1pbWFnZQ==") {
  class MockFileReader {
    public result: string | ArrayBuffer | null = null;
    public onload: ((ev: ProgressEvent<FileReader>) => unknown) | null = null;
    public onerror: ((ev: ProgressEvent<FileReader>) => unknown) | null = null;

    readAsDataURL() {
      this.result = dataUrl;
      const onload = this.onload;
      onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);
}

beforeEach(() => {
  vi.mocked(fetchLLMCatalog).mockResolvedValue({
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
  });
  vi.mocked(fetchLLMRuntime).mockResolvedValue({
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
      {
        name: "qwen2.5:3b",
        sizeBytes: 2_000_000_000,
        modifiedAt: "2026-04-07T00:00:00Z",
        digest: "sha256:light",
      },
      {
        name: "minicpm-v:8b",
        sizeBytes: 5_000_000_000,
        modifiedAt: "2026-04-07T00:00:00Z",
        digest: "sha256:vision",
      },
    ],
  });
  vi.mocked(fetchCharacterLLMPreferences).mockResolvedValue({
    characterId: "char-1",
    defaultBaseModelName: "qwen2.5:7b-instruct-q4_K_M",
  });
  vi.mocked(listChatSessions).mockResolvedValue([]);
  vi.mocked(createChatSession).mockResolvedValue({
    id: "chat-1",
    characterId: "char-1",
    llmModelId: null,
    baseModelName: "qwen2.5:7b-instruct-q4_K_M",
    createdAt: "2026-04-07T00:00:00Z",
  });
  vi.mocked(getChatMessages).mockResolvedValue([]);
  vi.mocked(streamChatMessage).mockResolvedValue("msg-1");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("聊天基础模型选择器会显示已下载模型（包含多模态）", async () => {
  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  const selector = await screen.findByLabelText("基础模型");
  expect(selector).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "默认对话（qwen2.5:7b-instruct-q4_K_M）" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "轻量对话（qwen2.5:3b）" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "多模态（minicpm-v:8b） · 支持图片" })).toBeInTheDocument();
});

test("未下载的多模态模型不会出现在可选列表", async () => {
  vi.mocked(fetchLLMRuntime).mockResolvedValueOnce({
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
      {
        name: "qwen2.5:3b",
        sizeBytes: 2_000_000_000,
        modifiedAt: "2026-04-07T00:00:00Z",
        digest: "sha256:light",
      },
    ],
  });

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  await screen.findByLabelText("基础模型");
  expect(screen.queryByRole("option", { name: "多模态（minicpm-v:8b） · 支持图片" })).not.toBeInTheDocument();
});

test("无会话时切换基础模型后首次发送会按所选模型创建会话", async () => {
  const user = userEvent.setup();
  vi.mocked(createChatSession).mockResolvedValueOnce({
    id: "chat-2",
    characterId: "char-1",
    llmModelId: null,
    baseModelName: "qwen2.5:3b",
    createdAt: "2026-04-07T00:00:00Z",
  });

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  const selector = await screen.findByLabelText("基础模型");
  await user.selectOptions(selector, "qwen2.5:3b");
  await user.type(screen.getByPlaceholderText("输入消息… (Enter 发送)"), "你好");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(createChatSession).toHaveBeenCalledWith("char-1", null, "qwen2.5:3b");
  });
});

test("打开旧会话后显示会话绑定模型，切换基础模型不会改写旧会话展示", async () => {
  const user = userEvent.setup();
  vi.mocked(listChatSessions).mockResolvedValueOnce([
    {
      id: "12345678-old",
      characterId: "char-1",
      llmModelId: null,
      baseModelName: "qwen2.5:7b-instruct-q4_K_M",
      createdAt: "2026-04-07T00:00:00Z",
    },
  ]);
  vi.mocked(getChatMessages).mockResolvedValue([]);

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  await user.click(await screen.findByText("12345678…"));
  await screen.findByText("当前会话：默认对话（qwen2.5:7b-instruct-q4_K_M）");

  const selector = await screen.findByLabelText("基础模型");
  await user.selectOptions(selector, "qwen2.5:3b");

  expect(screen.getByText("当前会话：默认对话（qwen2.5:7b-instruct-q4_K_M）")).toBeInTheDocument();
  expect(screen.getByText("切换基础模型将用于新的对话，当前对话不会变更。")).toBeInTheDocument();
});

test("选择私有模型时显示私有模型优先提示并隐藏基础模型选择器", async () => {
  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId="private-model-1"
      chatDisabledReason={null}
    />,
  );

  await screen.findByText("当前已选择私有模型，基础模型设置仅用于新的基础对话。");
  expect(screen.queryByLabelText("基础模型")).not.toBeInTheDocument();
});

test("chatDisabledReason 存在时会禁用发送和新建", async () => {
  const user = userEvent.setup();
  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason="语言引擎未启动，请先启动 Ollama。"
    />,
  );

  await screen.findByText("语言引擎未启动，请先启动 Ollama。");

  const newChatButton = screen.getByRole("button", { name: "+ 新建对话" });
  const input = screen.getByPlaceholderText("当前不可发送消息");
  const sendButton = screen.getByRole("button", { name: "发送" });

  expect(newChatButton).toBeDisabled();
  expect(input).toBeDisabled();
  expect(sendButton).toBeDisabled();

  await user.click(newChatButton);
  expect(createChatSession).not.toHaveBeenCalled();
});

test("文本模型会话下不显示图片上传入口", async () => {
  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  await screen.findByLabelText("基础模型");
  expect(screen.queryByRole("button", { name: "上传图片" })).not.toBeInTheDocument();
  expect(screen.getByText("当前选择的是文本模型，暂不支持图片对话。")).toBeInTheDocument();
});

test("多模态模型下显示图片上传入口", async () => {
  vi.mocked(fetchCharacterLLMPreferences).mockResolvedValueOnce({
    characterId: "char-1",
    defaultBaseModelName: "minicpm-v:8b",
  });

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  await screen.findByRole("button", { name: "上传图片" });
  expect(screen.getByText("新对话支持图片提问")).toBeInTheDocument();
});

test("选择图片后显示预览并可移除", async () => {
  const user = userEvent.setup();
  mockFileReader("data:image/png;base64,ZmFrZS1wcmV2aWV3");
  vi.mocked(fetchCharacterLLMPreferences).mockResolvedValueOnce({
    characterId: "char-1",
    defaultBaseModelName: "minicpm-v:8b",
  });

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  const fileInput = await screen.findByTestId("chat-image-upload-input");
  const imageFile = new File(["fake"], "avatar.png", { type: "image/png" });
  await user.upload(fileInput, imageFile);

  await screen.findByTestId("chat-image-preview");
  expect(screen.getByText("avatar.png")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "移除" }));
  expect(screen.queryByTestId("chat-image-preview")).not.toBeInTheDocument();
});

test("发送图文消息时会把图片 base64 传给聊天 API", async () => {
  const user = userEvent.setup();
  mockFileReader("data:image/png;base64,ZmFrZS1zZW5k");
  vi.mocked(fetchCharacterLLMPreferences).mockResolvedValueOnce({
    characterId: "char-1",
    defaultBaseModelName: "minicpm-v:8b",
  });
  vi.mocked(createChatSession).mockResolvedValueOnce({
    id: "chat-vision",
    characterId: "char-1",
    llmModelId: null,
    baseModelName: "minicpm-v:8b",
    createdAt: "2026-04-07T00:00:00Z",
  });

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  const fileInput = await screen.findByTestId("chat-image-upload-input");
  await user.upload(fileInput, new File(["fake"], "avatar.png", { type: "image/png" }));
  await user.type(screen.getByPlaceholderText("输入消息… (Enter 发送)"), "请描述这张图");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(streamChatMessage).toHaveBeenCalledWith(
      "chat-vision",
      "请描述这张图",
      expect.any(Function),
      expect.any(Object),
      ["ZmFrZS1zZW5k"],
    );
  });
});

test("仅上传图片不输入文字时不能发送", async () => {
  const user = userEvent.setup();
  mockFileReader("data:image/png;base64,ZmFrZS1vbmx5LWltYWdl");
  vi.mocked(fetchCharacterLLMPreferences).mockResolvedValueOnce({
    characterId: "char-1",
    defaultBaseModelName: "minicpm-v:8b",
  });

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  const fileInput = await screen.findByTestId("chat-image-upload-input");
  await user.upload(fileInput, new File(["fake"], "avatar.png", { type: "image/png" }));

  const sendButton = screen.getByRole("button", { name: "发送" });
  expect(sendButton).toBeEnabled();
  await user.click(sendButton);

  expect(await screen.findByText("请输入你想让模型回答的问题。")).toBeInTheDocument();
  expect(streamChatMessage).not.toHaveBeenCalled();
});

test("发送失败时保留已选图片，发送成功后清空附件", async () => {
  const user = userEvent.setup();
  mockFileReader("data:image/png;base64,ZmFrZS1yZXRyeQ==");
  vi.mocked(fetchCharacterLLMPreferences).mockResolvedValueOnce({
    characterId: "char-1",
    defaultBaseModelName: "minicpm-v:8b",
  });
  vi.mocked(createChatSession).mockResolvedValueOnce({
    id: "chat-vision-retry",
    characterId: "char-1",
    llmModelId: null,
    baseModelName: "minicpm-v:8b",
    createdAt: "2026-04-07T00:00:00Z",
  });
  vi.mocked(streamChatMessage)
    .mockRejectedValueOnce(new Error("发送失败"))
    .mockResolvedValueOnce("msg-2");

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  const fileInput = await screen.findByTestId("chat-image-upload-input");
  await user.upload(fileInput, new File(["fake"], "avatar.png", { type: "image/png" }));
  await user.type(screen.getByPlaceholderText("输入消息… (Enter 发送)"), "第一次发送");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await screen.findByText("发送失败");
  expect(screen.getByTestId("chat-image-preview")).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("输入消息… (Enter 发送)"), "第二次发送");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(streamChatMessage).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(screen.queryByTestId("chat-image-preview")).not.toBeInTheDocument();
  });
});

test("旧文本会话在选择多模态后仍不显示上传入口，并提示仅影响新对话", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchCharacterLLMPreferences).mockResolvedValueOnce({
    characterId: "char-1",
    defaultBaseModelName: "minicpm-v:8b",
  });
  vi.mocked(listChatSessions).mockResolvedValueOnce([
    {
      id: "text-chat-1",
      characterId: "char-1",
      llmModelId: null,
      baseModelName: "qwen2.5:7b-instruct-q4_K_M",
      createdAt: "2026-04-07T00:00:00Z",
    },
  ]);
  vi.mocked(getChatMessages).mockResolvedValue([]);

  render(
    <ChatPanel
      characterId="char-1"
      characterName="角色A"
      llmModelId={null}
      chatDisabledReason={null}
    />,
  );

  await user.click(await screen.findByText("text-cha…"));
  expect(screen.queryByRole("button", { name: "上传图片" })).not.toBeInTheDocument();
  expect(screen.getByText("图片能力将用于新的对话，当前会话仍使用原模型。")).toBeInTheDocument();
});
