import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { archiveGeneration, fetchGenerationArchives } from "./archive";

const fetchMock = vi.fn();

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "gen-1",
    characterId: "char-1",
    costumeId: "costume-1",
    outputPath: "/tmp/.mely/characters/char-1/generations/gen-1.png",
    paramsSnapshot: { assembledPrompt: "test", seed: 42 },
    tags: ["封面图"],
    createdAt: "2026-03-31T00:00:00Z",
    ...overrides,
  };
}

function buildRequest() {
  return {
    characterId: "char-1",
    costumeId: "costume-1",
    assembledPrompt: "hoshino_mika, pink hair, 在咖啡馆",
    width: 1024,
    height: 1024,
    steps: 28,
    sampler: "DPM++ 2M Karras",
    cfgScale: 3.5,
    seed: 42,
    loraWeight: 0.85,
    tags: ["封面图"],
    imageDataB64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("archiveGeneration sends POST and returns record", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildRecord(),
  });

  const result = await archiveGeneration(buildRequest());

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/generations/archive",
    expect.objectContaining({ method: "POST" })
  );
  expect(result.id).toBe("gen-1");
  expect(result.tags).toEqual(["封面图"]);
  expect(result.paramsSnapshot["seed"]).toBe(42);
});

test("archiveGeneration throws Chinese detail on 404", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ detail: "角色不存在，请刷新后重试。" }),
  });

  await expect(archiveGeneration(buildRequest())).rejects.toThrow("角色不存在");
});

test("archiveGeneration throws ARCHIVE_SERVICE_UNAVAILABLE on network error", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

  await expect(archiveGeneration(buildRequest())).rejects.toThrow(
    "ARCHIVE_SERVICE_UNAVAILABLE"
  );
});

test("fetchGenerationArchives returns items array", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items: [buildRecord(), buildRecord({ id: "gen-2" })] }),
  });

  const result = await fetchGenerationArchives("char-1");

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/characters/char-1/generations",
    expect.objectContaining({})
  );
  expect(result.items).toHaveLength(2);
});

test("fetchGenerationArchives throws on network error", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

  await expect(fetchGenerationArchives("char-1")).rejects.toThrow(
    "ARCHIVE_SERVICE_UNAVAILABLE"
  );
});
