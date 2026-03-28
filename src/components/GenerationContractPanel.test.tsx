import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { GenerationContractPanel } from "./GenerationContractPanel";

const fetchMock = vi.fn();

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

test("renders the contract shell for a ready character and updates mock job progress", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        characterId: "char-1",
        characterName: "星野ミカ",
        canGenerate: true,
        blockingReason: null,
        selectedCostumeId: "costume-1",
        costumes: [{ id: "costume-1", name: "基础造型", costumePrompt: "", isDefault: true }],
        promptSources: {
          dnaPrompt: "pink hair, violet eyes, anime girl",
          triggerWord: "hoshino_mika",
          costumePrompt: "",
        },
        parameterDefaults: {
          width: 1024,
          height: 1024,
          steps: 28,
          sampler: "DPM++ 2M Karras",
          cfgScale: 3.5,
          seed: null,
          loraWeight: 0.85,
        },
        tagOptions: ["封面图", "表情包", "周边", "预告图"],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        job: {
          id: "task-1",
          taskId: "task-1",
          characterId: "char-1",
          costumeId: "costume-1",
          scenePrompt: "契约验证场景：在直播封面中微笑看向镜头",
          status: "pending",
          stage: "queued",
          progress: 0,
          message: "生成任务已进入队列",
          error: null,
          tags: ["封面图"],
          createdAt: "2026-03-28T00:00:00Z",
          updatedAt: "2026-03-28T00:00:00Z",
        },
      }),
    });

  render(<GenerationContractPanel characterId="char-1" characterName="星野ミカ" />);

  await screen.findByText("基础造型");
  expect(screen.getByText("pink hair, violet eyes, anime girl")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "提交契约验证任务" })).toBeEnabled();

  const stream = MockWebSocket.instances[0];
  stream.emitOpen();

  await user.click(screen.getByRole("button", { name: "提交契约验证任务" }));
  await screen.findByText("生成任务已进入队列");

  stream.emitMessage({
    event: "task_updated",
    task: {
      id: "task-1",
      name: "generation-contract-char-1",
      status: "running",
      progress: 55,
      message: "正在准备图像引擎",
      error: null,
      createdAt: "2026-03-28T00:00:00Z",
      updatedAt: "2026-03-28T00:00:01Z",
    },
  });

  await screen.findByText("正在准备图像引擎");
  expect(screen.getByText("55%")).toBeInTheDocument();
});

test("shows a blocked message when the character is not ready", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      characterId: "char-2",
      characterName: "未训练角色",
      canGenerate: false,
      blockingReason: "该角色当前还不能生成，请先完成视觉训练。",
      selectedCostumeId: "costume-2",
      costumes: [{ id: "costume-2", name: "基础造型", costumePrompt: "", isDefault: true }],
      promptSources: { dnaPrompt: "", triggerWord: "", costumePrompt: "" },
      parameterDefaults: {
        width: 1024,
        height: 1024,
        steps: 28,
        sampler: "DPM++ 2M Karras",
        cfgScale: 3.5,
        seed: null,
        loraWeight: 0.85,
      },
      tagOptions: ["封面图", "表情包", "周边", "预告图"],
    }),
  });

  render(<GenerationContractPanel characterId="char-2" characterName="未训练角色" />);

  await screen.findByText("该角色当前还不能生成，请先完成视觉训练。");
  expect(screen.getByRole("button", { name: "提交契约验证任务" })).toBeDisabled();
});
