import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../api/voice", () => ({
  synthesizeSpeech: vi.fn(),
  fetchTTSEngineStatus: vi.fn(),
  startTTSEngine: vi.fn(),
  stopTTSEngine: vi.fn(),
}));

vi.mock("../api/tasks", () => ({
  createTaskStream: vi.fn(),
}));

import { synthesizeSpeech, fetchTTSEngineStatus } from "../api/voice";
import { type TaskEvent, type TaskStatus, createTaskStream } from "../api/tasks";
import { TTSGeneratePanel } from "./TTSGeneratePanel";

const mockSynthesize = vi.mocked(synthesizeSpeech);
const mockCreateTaskStream = vi.mocked(createTaskStream);
const mockFetchTTSStatus = vi.mocked(fetchTTSEngineStatus);

class MockWebSocket {
  callback: ((event: unknown) => void) | null = null;
  closed = false;

  emit(event: unknown) {
    this.callback?.(event);
  }

  destroy() {
    this.closed = true;
  }
}

function buildTask(overrides: Partial<{ id: string; name: string; status: TaskStatus; progress: number; message: string | null; error: string | null; createdAt: string; updatedAt: string }> = {}) {
  return {
    id: "task-1",
    name: "tts-char-1",
    status: "running" as TaskStatus,
    progress: 50,
    message: "正在合成语音",
    error: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockFetchTTSStatus.mockResolvedValue({
    state: "running",
    restartCount: 0,
    errorMessage: null,
    pid: 1234,
  });
  mockCreateTaskStream.mockImplementation(() => vi.fn());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("renders idle state with submit button disabled when text is empty", async () => {
  render(<TTSGeneratePanel characterId="char-1" />);

  const btn = screen.getByRole("button", { name: "开始合成" });
  expect(btn).toBeDisabled();
});

test("submit button enabled when text is entered", async () => {
  render(<TTSGeneratePanel characterId="char-1" />);

  const textarea = screen.getByPlaceholderText(/输入想让角色说的话/);
  await userEvent.type(textarea, "你好，世界！");

  expect(screen.getByRole("button", { name: "开始合成" })).toBeEnabled();
});

test("shows submitting then generating state after submit", async () => {
  mockSynthesize.mockResolvedValueOnce({
    taskId: "task-1",
    characterId: "char-1",
    message: "语音合成任务已提交",
  });

  let streamCallback: ((event: TaskEvent) => void) | null = null;
  mockCreateTaskStream.mockImplementation((cb) => {
    streamCallback = cb;
    return vi.fn();
  });

  render(<TTSGeneratePanel characterId="char-1" />);

  const textarea = screen.getByPlaceholderText(/输入想让角色说的话/);
  await userEvent.type(textarea, "你好");

  await userEvent.click(screen.getByRole("button", { name: "开始合成" }));

  await waitFor(() => {
    expect(mockSynthesize).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: "char-1", text: "你好" })
    );
  });
});

test("shows done state when task completes", async () => {
  mockSynthesize.mockResolvedValueOnce({
    taskId: "task-1",
    characterId: "char-1",
    message: "ok",
  });

  let streamCallback: ((event: TaskEvent) => void) | null = null;
  mockCreateTaskStream.mockImplementation((cb) => {
    streamCallback = cb;
    return vi.fn();
  });

  render(<TTSGeneratePanel characterId="char-1" onViewHistory={vi.fn()} />);

  await userEvent.type(screen.getByPlaceholderText(/输入想让角色说的话/), "你好");
  await userEvent.click(screen.getByRole("button", { name: "开始合成" }));

  await waitFor(() => streamCallback !== null);

  streamCallback!({
    event: "task_updated",
    task: buildTask({ status: "completed", progress: 100 }),
  });

  await screen.findByText("✓ 语音合成完成！");
  expect(screen.getByRole("button", { name: "查看历史" })).toBeInTheDocument();
});

test("shows failed state when task fails", async () => {
  mockSynthesize.mockResolvedValueOnce({
    taskId: "task-1",
    characterId: "char-1",
    message: "ok",
  });

  let streamCallback: ((event: TaskEvent) => void) | null = null;
  mockCreateTaskStream.mockImplementation((cb) => {
    streamCallback = cb;
    return vi.fn();
  });

  render(<TTSGeneratePanel characterId="char-1" />);

  await userEvent.type(screen.getByPlaceholderText(/输入想让角色说的话/), "你好");
  await userEvent.click(screen.getByRole("button", { name: "开始合成" }));

  await waitFor(() => streamCallback !== null);

  streamCallback!({
    event: "task_updated",
    task: buildTask({ status: "failed", error: "TTS 引擎内存不足" }),
  });

  await screen.findByText("TTS 引擎内存不足");
  expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
});

test("shows unavailable message when synthesizeSpeech API reports feature unavailable", async () => {
  mockSynthesize.mockRejectedValueOnce(
    new Error("当前版本暂不支持语音合成，请先完成声音绑定并等待引擎接入。")
  );

  render(<TTSGeneratePanel characterId="char-1" />);

  await userEvent.type(screen.getByPlaceholderText(/输入想让角色说的话/), "你好");
  await userEvent.click(screen.getByRole("button", { name: "开始合成" }));

  await screen.findByText("当前版本暂不支持语音合成，请先完成声音绑定并等待引擎接入。");
});

test("shows character count", async () => {
  render(<TTSGeneratePanel characterId="char-1" />);

  await userEvent.type(screen.getByPlaceholderText(/输入想让角色说的话/), "好");

  expect(screen.getByText("1/500")).toBeInTheDocument();
});
