import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { submitBatchGeneration } from "./batch";

const fetchMock = vi.fn();

function buildJob(taskId: string, scenePrompt: string) {
  return {
    taskId,
    scenePrompt,
    status: "pending",
    progress: 0,
    message: "批量生成任务已进入队列",
    error: null,
    createdAt: "2026-03-31T00:00:00Z",
    updatedAt: "2026-03-31T00:00:00Z",
  };
}

function buildBatchResponse(count = 2) {
  return {
    batchId: "batch-abc",
    total: count,
    jobs: Array.from({ length: count }, (_, i) =>
      buildJob(`task-${i + 1}`, `场景${i + 1}`),
    ),
  };
}

function buildRequest() {
  return {
    characterId: "char-1",
    costumeId: "costume-1",
    scenePrompts: ["场景1", "场景2"],
    width: 1024,
    height: 1024,
    steps: 28,
    sampler: "DPM++ 2M Karras",
    cfgScale: 3.5,
    seed: null,
    loraWeight: 0.85,
    tags: [],
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("submitBatchGeneration sends POST and returns response", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildBatchResponse(),
  });

  const result = await submitBatchGeneration(buildRequest());

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/generations/batch",
    expect.objectContaining({ method: "POST" }),
  );
  expect(result.batchId).toBe("batch-abc");
  expect(result.total).toBe(2);
  expect(result.jobs).toHaveLength(2);
});

test("submitBatchGeneration throws Chinese detail on 400", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ detail: "该角色当前无法生成图像。" }),
  });

  await expect(submitBatchGeneration(buildRequest())).rejects.toThrow("该角色当前无法生成图像。");
});

test("submitBatchGeneration throws BATCH_SERVICE_UNAVAILABLE on network error", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

  await expect(submitBatchGeneration(buildRequest())).rejects.toThrow(
    "BATCH_SERVICE_UNAVAILABLE",
  );
});

test("submitBatchGeneration throws BATCH_INVALID_RESPONSE for malformed payload", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ unexpected: true }),
  });

  await expect(submitBatchGeneration(buildRequest())).rejects.toThrow("BATCH_INVALID_RESPONSE");
});
