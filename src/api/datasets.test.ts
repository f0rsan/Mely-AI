import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  DatasetApiError,
  fetchCharacterDatasetReport,
  importCharacterDataset,
} from "./datasets";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function buildReport() {
  return {
    characterId: "char-1",
    totalImages: 2,
    qualifiedImages: 1,
    problemImages: 1,
    qualityScore: 62,
    angleDistribution: { front: 1, side: 1, back: 0, closeup: 0 },
    problemItems: [
      { imageId: "img-2", name: "side.png", angleBucket: "side", issues: ["分辨率偏低（短边低于 768）"] },
    ],
    recommendedTrainingMode: {
      mode: "light",
      reason: "当前数据量或覆盖度偏保守，建议先用轻量模式验证方向。",
      suggestedSteps: 900,
      suggestedRank: 8,
      minRecommendedImages: 10,
      strategyDefaultModel: "flux-schnell",
      runtimeModelHintOn8GB: "sdxl",
    },
    recommendations: ["当前图片数量偏少，建议补充到 10 张以上再训练。"],
    images: [
      {
        imageId: "img-1",
        name: "front.png",
        relativePath: "characters/char-1/training_data/001-front.png",
        imageFormat: "png",
        width: 1024,
        height: 1024,
        fileSize: 120000,
        angleBucket: "front",
        qualityStatus: "qualified",
        issues: [],
      },
    ],
    updatedAt: "2026-03-27T00:00:00Z",
  };
}

test("uploads files to dataset import endpoint", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildReport(),
  });

  const file = new File([Uint8Array.from([1, 2, 3, 4])], "front.png", {
    type: "image/png",
  });
  const report = await importCharacterDataset("char-1", [file]);

  expect(report.characterId).toBe("char-1");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:8000/api/characters/char-1/dataset/import");
  expect(options.method).toBe("POST");
  expect(options.headers).toEqual({ "Content-Type": "application/json" });
  const parsed = JSON.parse(options.body as string);
  expect(parsed.images).toHaveLength(1);
  expect(parsed.images[0].name).toBe("front.png");
  expect(typeof parsed.images[0].contentBase64).toBe("string");
  expect(parsed.images[0].contentBase64.length).toBeGreaterThan(0);
});

test("loads existing dataset report", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildReport(),
  });

  const report = await fetchCharacterDatasetReport("char-1");
  expect(report.qualityScore).toBe(62);
  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/characters/char-1/dataset/report",
    { signal: undefined },
  );
});

test("throws chinese detail as DatasetApiError on API failure", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({ detail: "图片导入失败，请检查图片格式后重试" }),
  });

  await expect(importCharacterDataset("char-1", [])).rejects.toMatchObject({
    name: "DatasetApiError",
    status: 400,
    message: "图片导入失败，请检查图片格式后重试",
  } satisfies Partial<DatasetApiError>);
});
