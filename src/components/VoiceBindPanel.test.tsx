import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../api/voice", () => ({
  fetchVoiceStatus: vi.fn(),
  uploadReferenceAudio: vi.fn(),
  extractVoiceprint: vi.fn(),
  fetchTTSEngineStatus: vi.fn(),
  startTTSEngine: vi.fn(),
  stopTTSEngine: vi.fn(),
}));

import {
  extractVoiceprint,
  fetchTTSEngineStatus,
  fetchVoiceStatus,
  uploadReferenceAudio,
} from "../api/voice";
import { VoiceBindPanel } from "./VoiceBindPanel";

const mockFetchVoiceStatus = vi.mocked(fetchVoiceStatus);
const mockUploadReferenceAudio = vi.mocked(uploadReferenceAudio);
const mockExtractVoiceprint = vi.mocked(extractVoiceprint);
const mockFetchTTSEngineStatus = vi.mocked(fetchTTSEngineStatus);

function buildStatus(overrides = {}) {
  return {
    characterId: "char-1",
    hasReference: false,
    status: "unbound" as const,
    referenceAudioPath: null,
    durationSeconds: null,
    ttsEngine: null,
    boundAt: null,
    ...overrides,
  };
}

function buildTTSStatus(state = "stopped") {
  return { state, restartCount: 0, errorMessage: null, pid: null };
}

beforeEach(() => {
  mockFetchTTSEngineStatus.mockResolvedValue(buildTTSStatus() as any);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("shows loading state initially then unbound after fetch", async () => {
  mockFetchVoiceStatus.mockResolvedValueOnce(buildStatus());

  render(<VoiceBindPanel characterId="char-1" />);

  // Should quickly resolve to unbound
  await screen.findByText("拖拽或点击上传参考音频");
});

test("shows bound state when voice is already bound", async () => {
  mockFetchVoiceStatus.mockResolvedValueOnce(
    buildStatus({
      status: "bound",
      hasReference: true,
      boundAt: "2026-04-01T00:00:00.000Z",
    })
  );

  render(<VoiceBindPanel characterId="char-1" />);

  await screen.findByText("✓ 声音绑定成功");
  expect(screen.getByRole("button", { name: "重新绑定" })).toBeInTheDocument();
});

test("shows format/duration hint in upload area", async () => {
  mockFetchVoiceStatus.mockResolvedValueOnce(buildStatus());

  render(<VoiceBindPanel characterId="char-1" />);

  await screen.findByText(/WAV、MP3、FLAC/);
  expect(screen.getByText(/3–30 秒/)).toBeInTheDocument();
});

test("clicking retry after error resets to unbound", async () => {
  mockFetchVoiceStatus.mockResolvedValueOnce(buildStatus());
  mockUploadReferenceAudio.mockRejectedValueOnce(new Error("上传失败，请重试"));
  mockExtractVoiceprint.mockResolvedValue({
    taskId: "t1",
    characterId: "char-1",
    message: "ok",
  });

  const { container } = render(<VoiceBindPanel characterId="char-1" />);

  await screen.findByText("拖拽或点击上传参考音频");

  // Simulate file upload via the hidden file input
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array(100)], "voice.wav", { type: "audio/wav" });
  await userEvent.upload(input, file);

  await screen.findByText("上传失败，请重试");

  const retryBtn = screen.getByRole("button", { name: "重试" });
  await userEvent.click(retryBtn);

  await screen.findByText("拖拽或点击上传参考音频");
});

test("successful upload triggers extracting state", async () => {
  mockFetchVoiceStatus.mockResolvedValueOnce(buildStatus());
  mockUploadReferenceAudio.mockResolvedValueOnce({
    characterId: "char-1",
    referenceAudioPath: "/tmp/ref.wav",
    durationSeconds: 10,
    audioFormat: "wav",
    status: "extracting",
    message: "ok",
  });
  mockExtractVoiceprint.mockResolvedValueOnce({
    taskId: "t1",
    characterId: "char-1",
    message: "ok",
  });
  // Poll returns extracting then bound
  mockFetchVoiceStatus
    .mockResolvedValueOnce(buildStatus({ status: "extracting" }))
    .mockResolvedValueOnce(
      buildStatus({ status: "bound", boundAt: "2026-04-01T00:00:00.000Z" })
    );

  const { container } = render(<VoiceBindPanel characterId="char-1" />);
  await screen.findByText("拖拽或点击上传参考音频");

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array(100)], "voice.wav", { type: "audio/wav" });
  await userEvent.upload(input, file);

  await waitFor(() => {
    expect(
      screen.queryByText("声纹提取中，请稍候…") ||
        screen.queryByText("✓ 声音绑定成功")
    ).toBeTruthy();
  });
});
