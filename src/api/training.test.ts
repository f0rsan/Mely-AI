import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { fetchTrainingTask, fetchTrainingTasks, startTraining } from "./training";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("reads character scoped training task list from local backend", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => [
      {
        id: "task-1",
        characterId: "char-1",
        queueTaskId: "task-1",
        requestedMode: "standard",
        effectiveMode: "standard",
        requestedModel: "flux-schnell",
        effectiveModel: "sdxl",
        strategyDefaultModel: "flux-schnell",
        runtimeDefaultModel: "sdxl",
        requestedSteps: 1800,
        effectiveSteps: 1800,
        requestedRank: 16,
        effectiveRank: 16,
        precheck: { vramGB: 8, source: "env", result: "ok" },
        downgradeReasons: [],
        config: {},
        businessStatus: "training",
        queueStatus: "running",
        progress: 40,
        currentStage: "训练进行中",
        latestMessage: "已完成 40%",
        latestError: null,
        userVisibleError: null,
        samplePreviews: [],
        validationImages: [],
        retrainOfTaskId: null,
        createdAt: "2026-03-27T00:00:00Z",
        updatedAt: "2026-03-27T00:00:40Z",
        startedAt: "2026-03-27T00:00:05Z",
        finishedAt: null,
      },
    ],
  });

  const items = await fetchTrainingTasks("char-1");

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/training/tasks?characterId=char-1",
    { signal: undefined },
  );
  expect(items).toHaveLength(1);
  expect(items[0].businessStatus).toBe("training");
});

test("reads single training task snapshot", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: "task-1",
      characterId: "char-1",
      queueTaskId: "task-1",
      requestedMode: "standard",
      effectiveMode: "standard",
      requestedModel: "flux-schnell",
      effectiveModel: "sdxl",
      strategyDefaultModel: "flux-schnell",
      runtimeDefaultModel: "sdxl",
      requestedSteps: 1800,
      effectiveSteps: 1800,
      requestedRank: 16,
      effectiveRank: 16,
      precheck: { vramGB: 8, source: "env", result: "ok" },
      downgradeReasons: [],
      config: {},
      businessStatus: "failed",
      queueStatus: "failed",
      progress: 5,
      currentStage: "训练失败",
      latestMessage: null,
      latestError: "占位执行器未接入",
      userVisibleError: "训练任务已通过预检并入队，但当前环境未接入真实训练执行器。",
      samplePreviews: [],
      validationImages: [],
      retrainOfTaskId: null,
      createdAt: "2026-03-27T00:00:00Z",
      updatedAt: "2026-03-27T00:00:40Z",
      startedAt: "2026-03-27T00:00:05Z",
      finishedAt: "2026-03-27T00:00:07Z",
    }),
  });

  const item = await fetchTrainingTask("task-1");
  expect(item.queueStatus).toBe("failed");
  expect(item.userVisibleError).toContain("未接入真实训练执行器");
});

test("starts a retraining task with source task id", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: "task-2",
      characterId: "char-1",
      queueTaskId: "task-2",
      requestedMode: "standard",
      effectiveMode: "standard",
      requestedModel: "flux-schnell",
      effectiveModel: "sdxl",
      strategyDefaultModel: "flux-schnell",
      runtimeDefaultModel: "sdxl",
      requestedSteps: 1800,
      effectiveSteps: 1800,
      requestedRank: 16,
      effectiveRank: 16,
      precheck: { vramGB: 8, source: "env", result: "ok" },
      downgradeReasons: [],
      config: {},
      businessStatus: "queued",
      queueStatus: "pending",
      progress: 0,
      currentStage: "任务排队中",
      latestMessage: "训练任务已创建，等待调度。",
      latestError: null,
      userVisibleError: null,
      samplePreviews: [],
      validationImages: [],
      retrainOfTaskId: "task-1",
      createdAt: "2026-03-27T00:00:00Z",
      updatedAt: "2026-03-27T00:00:00Z",
      startedAt: null,
      finishedAt: null,
    }),
  });

  const item = await startTraining({
    characterId: "char-1",
    mode: "standard",
    baseModel: "flux-schnell",
    retrainOfTaskId: "task-1",
  });

  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/training/start", {
    body: JSON.stringify({
      characterId: "char-1",
      mode: "standard",
      baseModel: "flux-schnell",
      retrainOfTaskId: "task-1",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: undefined,
  });
  expect(item.retrainOfTaskId).toBe("task-1");
});

test("starts same-mode retraining with retrain step delta", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: "task-3",
      characterId: "char-1",
      queueTaskId: "task-3",
      requestedMode: "fine",
      effectiveMode: "fine",
      requestedModel: "sdxl",
      effectiveModel: "sdxl",
      strategyDefaultModel: "flux-schnell",
      runtimeDefaultModel: "sdxl",
      requestedSteps: 3400,
      effectiveSteps: 3400,
      requestedRank: 32,
      effectiveRank: 32,
      precheck: { vramGB: 24, source: "env", result: "ok" },
      downgradeReasons: [],
      config: {},
      businessStatus: "queued",
      queueStatus: "pending",
      progress: 0,
      currentStage: "任务排队中",
      latestMessage: "训练任务已创建，等待调度。",
      latestError: null,
      userVisibleError: null,
      samplePreviews: [],
      validationImages: [],
      retrainOfTaskId: "task-2",
      createdAt: "2026-03-27T00:00:00Z",
      updatedAt: "2026-03-27T00:00:00Z",
      startedAt: null,
      finishedAt: null,
    }),
  });

  await startTraining({
    characterId: "char-1",
    mode: "fine",
    baseModel: "sdxl",
    retrainOfTaskId: "task-2",
    retrainStepDelta: 600,
  });

  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/training/start", {
    body: JSON.stringify({
      characterId: "char-1",
      mode: "fine",
      baseModel: "sdxl",
      retrainOfTaskId: "task-2",
      retrainStepDelta: 600,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: undefined,
  });
});
