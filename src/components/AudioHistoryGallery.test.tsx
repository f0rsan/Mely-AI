import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../api/archive", () => ({
  fetchGenerationArchives: vi.fn(),
}));

import { fetchGenerationArchives } from "../api/archive";
import { AudioHistoryGallery } from "./AudioHistoryGallery";

const mockFetchArchives = vi.mocked(fetchGenerationArchives);

function buildAudioRecord(id: string, text: string, createdAt = "2026-04-01T12:00:00Z") {
  return {
    id,
    characterId: "char-1",
    costumeId: "cos-1",
    outputPath: `/tmp/${id}.wav`,
    paramsSnapshot: {
      text,
      language: "zh",
      speed: 1.0,
      ttsEngine: "f5-tts",
      sampleRate: 24000,
    },
    tags: [],
    createdAt,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("shows loading state initially", async () => {
  mockFetchArchives.mockReturnValue(new Promise(() => {})); // never resolves

  render(<AudioHistoryGallery characterId="char-1" />);

  expect(screen.getByRole("status")).toHaveTextContent("正在加载");
});

test("renders audio records as list with play button", async () => {
  mockFetchArchives.mockResolvedValueOnce({
    items: [
      buildAudioRecord("gen-1", "你好，世界！"),
      buildAudioRecord("gen-2", "很高兴认识你"),
    ],
  });

  render(<AudioHistoryGallery characterId="char-1" />);

  await screen.findByText("你好，世界！");
  expect(screen.getByText("很高兴认识你")).toBeInTheDocument();

  const playButtons = screen.getAllByTitle("播放");
  expect(playButtons).toHaveLength(2);
});

test("shows empty state when no audio records", async () => {
  mockFetchArchives.mockResolvedValueOnce({ items: [] });

  render(<AudioHistoryGallery characterId="char-1" />);

  await screen.findByText(/还没有语音合成记录/);
});

test("shows error state on fetch failure", async () => {
  mockFetchArchives.mockRejectedValueOnce(new Error("network error"));

  render(<AudioHistoryGallery characterId="char-1" />);

  await screen.findByText("历史记录加载失败，请稍后重试。");
});

test("filters out non-audio records (no ttsEngine field)", async () => {
  mockFetchArchives.mockResolvedValueOnce({
    items: [
      buildAudioRecord("gen-1", "语音记录"),
      {
        id: "gen-img",
        characterId: "char-1",
        costumeId: "cos-1",
        outputPath: "/tmp/gen-img.png",
        paramsSnapshot: { assembledPrompt: "a cat", width: 1024, height: 1024 },
        tags: [],
        createdAt: "2026-04-01T12:00:00Z",
      },
    ],
  });

  render(<AudioHistoryGallery characterId="char-1" />);

  await screen.findByText("语音记录");
  // Image record should not appear (no ttsEngine field)
  expect(screen.queryByText("a cat")).not.toBeInTheDocument();
});

test("shows download link for each record", async () => {
  mockFetchArchives.mockResolvedValueOnce({
    items: [buildAudioRecord("gen-1", "下载测试")],
  });

  render(<AudioHistoryGallery characterId="char-1" />);

  await screen.findByText("下载测试");

  const downloadLink = screen.getByRole("link", { name: "下载" });
  expect(downloadLink).toHaveAttribute("download");
  expect(downloadLink.getAttribute("href")).toContain("gen-1/audio");
});
