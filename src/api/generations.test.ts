import { afterEach, expect, test, vi } from "vitest";

import {
  createMockGenerationJob,
  fetchGenerationWorkbenchContract,
  mergeTaskIntoGenerationJob,
} from "./generations";
import type { TaskSnapshot } from "./tasks";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("fetches a valid generation workbench contract", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      characterId: "char-1",
      characterName: "星野ミカ",
      canGenerate: true,
      blockingReason: null,
      selectedCostumeId: "costume-1",
      costumes: [
        {
          id: "costume-1",
          name: "基础造型",
          costumePrompt: "",
          isDefault: true,
        },
      ],
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
  });

  const result = await fetchGenerationWorkbenchContract("char-1");

  expect(result.characterName).toBe("星野ミカ");
  expect(result.canGenerate).toBe(true);
  expect(result.costumes[0].name).toBe("基础造型");
  expect(result.parameterDefaults.sampler).toBe("DPM++ 2M Karras");
});

test("returns backend detail when mock generation submit is rejected", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({
      detail: "该角色当前还不能生成，请先完成视觉训练。",
    }),
  });

  await expect(
    createMockGenerationJob({
      characterId: "char-1",
      costumeId: "costume-1",
      scenePrompt: "测试场景",
      negativePrompt: "",
      width: 1024,
      height: 1024,
      steps: 28,
      sampler: "DPM++ 2M Karras",
      cfgScale: 3.5,
      seed: null,
      loraWeight: 0.85,
      tags: ["封面图"],
    }),
  ).rejects.toThrow("该角色当前还不能生成，请先完成视觉训练。");
});

test("merges task updates into a generation job snapshot", () => {
  const initialJob = {
    id: "task-1",
    taskId: "task-1",
    characterId: "char-1",
    costumeId: "costume-1",
    scenePrompt: "测试场景",
    status: "pending" as const,
    stage: "queued" as const,
    progress: 0,
    message: "生成任务已进入队列",
    error: null,
    tags: ["封面图"],
    createdAt: "2026-03-28T00:00:00Z",
    updatedAt: "2026-03-28T00:00:00Z",
  };

  const taskUpdate: TaskSnapshot = {
    id: "task-1",
    name: "generation-contract-char-1",
    status: "running",
    progress: 55,
    message: "正在准备图像引擎",
    error: null,
    createdAt: "2026-03-28T00:00:00Z",
    updatedAt: "2026-03-28T00:00:01Z",
  };

  const merged = mergeTaskIntoGenerationJob(initialJob, taskUpdate);

  expect(merged.status).toBe("running");
  expect(merged.stage).toBe("running");
  expect(merged.progress).toBe(55);
  expect(merged.message).toBe("正在准备图像引擎");
});
