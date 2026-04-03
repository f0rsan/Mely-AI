import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { TrainingProgressPanel } from "./TrainingProgressPanel";
import type { TrainingTaskSnapshot } from "../api/training";

const trainingApiMocks = vi.hoisted(() => ({
  fetchTrainingTasks: vi.fn(),
  fetchTrainingTask: vi.fn(),
  startTraining: vi.fn(),
}));

vi.mock("../api/training", async () => {
  const actual = await vi.importActual("../api/training");
  return {
    ...actual,
    fetchTrainingTasks: trainingApiMocks.fetchTrainingTasks,
    fetchTrainingTask: trainingApiMocks.fetchTrainingTask,
    startTraining: trainingApiMocks.startTraining,
  };
});

function buildFineTaskSnapshot(): TrainingTaskSnapshot {
  return {
    id: "task-fine-1",
    characterId: "char-1",
    queueTaskId: "task-fine-1",
    requestedMode: "fine",
    effectiveMode: "fine",
    requestedModel: "sdxl",
    effectiveModel: "sdxl",
    strategyDefaultModel: "flux-schnell",
    runtimeDefaultModel: "sdxl",
    requestedSteps: 2800,
    effectiveSteps: 2800,
    requestedRank: 32,
    effectiveRank: 32,
    precheck: { vramGB: 24, source: "env", result: "ok" },
    downgradeReasons: [],
    config: {},
    businessStatus: "completed",
    queueStatus: "completed",
    progress: 100,
    currentStage: "completed",
    latestMessage: "训练完成",
    latestError: null,
    userVisibleError: null,
    samplePreviews: [
      { progress: 20, image: "mock://sample/20.png" },
      { progress: 40, image: "mock://sample/40.png" },
    ],
    validationImages: [
      { view: "front", image: "mock://validation/front.png" },
      { view: "three_quarter", image: "mock://validation/three_quarter.png" },
      { view: "back", image: "mock://validation/back.png" },
      { view: "close_up", image: "mock://validation/close_up.png" },
    ],
    retrainOfTaskId: null,
    createdAt: "2026-03-28T00:00:00Z",
    updatedAt: "2026-03-28T00:00:00Z",
    startedAt: "2026-03-28T00:00:00Z",
    finishedAt: "2026-03-28T00:10:00Z",
  };
}

beforeEach(() => {
  const task = buildFineTaskSnapshot();
  trainingApiMocks.fetchTrainingTasks.mockResolvedValue([task]);
  trainingApiMocks.fetchTrainingTask.mockResolvedValue(task);
  trainingApiMocks.startTraining.mockResolvedValue({
    ...task,
    id: "task-fine-2",
    queueTaskId: "task-fine-2",
    businessStatus: "queued",
    queueStatus: "pending",
    progress: 0,
    currentStage: "queued",
    latestMessage: "训练任务已进入队列",
    retrainOfTaskId: "task-fine-1",
    requestedSteps: 3400,
    effectiveSteps: 3400,
    finishedAt: null,
  });
});

afterEach(() => {
  trainingApiMocks.fetchTrainingTasks.mockReset();
  trainingApiMocks.fetchTrainingTask.mockReset();
  trainingApiMocks.startTraining.mockReset();
});

test("requests same-mode retrain with retrainStepDelta for fine task", async () => {
  const user = userEvent.setup();
  render(
    <TrainingProgressPanel
      character={{
        id: "char-1",
        name: "星野ミカ",
        createdAt: "2026-03-28T00:00:00Z",
      }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "真实 API" }));
  await screen.findByRole("button", { name: "背面 不满意" });

  await user.click(screen.getByRole("button", { name: "背面 不满意" }));
  await user.click(screen.getByRole("button", { name: "增加训练步数后重训" }));

  await waitFor(() => {
    expect(trainingApiMocks.startTraining).toHaveBeenCalledWith({
      characterId: "char-1",
      mode: "fine",
      baseModel: "sdxl",
      retrainOfTaskId: "task-fine-1",
      retrainStepDelta: 600,
    });
  });
});
