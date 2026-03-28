import type {
  TrainingBusinessStatus,
  TrainingImage,
  TrainingMode,
  TrainingModel,
  TrainingQueueStatus,
  TrainingTaskSnapshot,
} from "../api/training";
import timelineMock from "../../docs/mocks/m1f_training_progress_timeline_mock.json";

type MockTimelineEntry = {
  t: number;
  businessStatus: TrainingBusinessStatus;
  queueStatus: TrainingQueueStatus;
  currentStage: string;
  progress: number;
  etaSeconds?: number;
  samplePreview?: { progress: number; image: string } | null;
  validationImages?: Array<{ view: string; image: string }>;
  userVisibleError?: string;
  message?: string;
};

type MockScenario = {
  taskContext: {
    id: string;
    characterId: string;
    requestedModel: TrainingModel;
    effectiveModel: TrainingModel;
    requestedMode: TrainingMode;
    effectiveMode: TrainingMode;
    precheck?: {
      vramGB: number;
      source: string;
    };
    downgradeReasons?: Array<{ code: string; message: string }>;
  };
  timeline: MockTimelineEntry[];
};

type RawScenarios = Record<string, MockScenario>;

type RawMockData = {
  scenarios: RawScenarios;
};

type MockFrame = {
  task: TrainingTaskSnapshot;
  etaSeconds: number | null;
};

function resolveTaskTimestamp(taskContext: MockScenario["taskContext"], frame: MockTimelineEntry): string {
  return new Date(`2026-03-27T00:${String(frame.t % 60).padStart(2, "0")}:00Z`).toISOString();
}

function createBaseTask(taskContext: MockScenario["taskContext"]): TrainingTaskSnapshot {
  return {
    id: taskContext.id,
    characterId: taskContext.characterId,
    queueTaskId: taskContext.id,
    requestedMode: taskContext.requestedMode,
    effectiveMode: taskContext.effectiveMode,
    requestedModel: taskContext.requestedModel,
    effectiveModel: taskContext.effectiveModel,
    strategyDefaultModel: "flux-schnell",
    runtimeDefaultModel: "sdxl",
    requestedSteps: 1800,
    effectiveSteps: 1800,
    requestedRank: 16,
    effectiveRank: 16,
    precheck: {
      vramGB: taskContext.precheck?.vramGB ?? 8,
      source: taskContext.precheck?.source ?? "mock",
      result: "ok",
    },
    downgradeReasons: taskContext.downgradeReasons ?? [],
    config: {
      source: "mock",
      warning: "M1F timeline mock",
    },
    businessStatus: "queued",
    queueStatus: "pending",
    progress: 0,
    currentStage: "任务排队中",
    latestMessage: "训练任务已创建，等待调度。",
    latestError: null,
    userVisibleError: null,
    samplePreviews: [],
    validationImages: [],
    retrainOfTaskId: null,
    createdAt: "2026-03-27T00:00:00Z",
    updatedAt: "2026-03-27T00:00:00Z",
    startedAt: null,
    finishedAt: null,
  };
}

function appendSamplePreview(
  accumulated: TrainingImage[],
  preview: MockTimelineEntry["samplePreview"],
): TrainingImage[] {
  if (!preview) {
    return accumulated;
  }

  const exists = accumulated.some(
    (item) => item.progress === preview.progress || item.image === preview.image,
  );
  if (exists) {
    return accumulated;
  }

  return [...accumulated, { progress: preview.progress, image: preview.image }].sort((a, b) => {
    return (a.progress ?? 0) - (b.progress ?? 0);
  });
}

function toValidationImages(
  current: MockTimelineEntry["validationImages"] | undefined,
  fallback: TrainingImage[],
): TrainingImage[] {
  if (!current || current.length === 0) {
    return fallback;
  }

  return current.map((item) => ({ view: item.view, image: item.image }));
}

function buildFramesFromScenario(scenario: MockScenario): MockFrame[] {
  const base = createBaseTask(scenario.taskContext);
  const frames: MockFrame[] = [];
  let samplePreviews: TrainingImage[] = [];
  let validationImages: TrainingImage[] = [];

  for (const entry of scenario.timeline) {
    samplePreviews = appendSamplePreview(samplePreviews, entry.samplePreview);
    validationImages = toValidationImages(entry.validationImages, validationImages);
    const updatedAt = resolveTaskTimestamp(scenario.taskContext, entry);

    const currentTask: TrainingTaskSnapshot = {
      ...base,
      businessStatus: entry.businessStatus,
      queueStatus: entry.queueStatus,
      progress: entry.progress,
      currentStage: entry.currentStage,
      latestMessage: entry.message ?? null,
      latestError: entry.businessStatus === "failed" ? entry.message ?? null : null,
      userVisibleError: entry.userVisibleError ?? null,
      samplePreviews,
      validationImages,
      updatedAt,
      startedAt: entry.queueStatus === "running" ? "2026-03-27T00:00:05Z" : null,
      finishedAt:
        entry.businessStatus === "completed" || entry.businessStatus === "failed"
          ? updatedAt
          : null,
    };

    frames.push({
      task: currentTask,
      etaSeconds: entry.etaSeconds ?? null,
    });
  }

  return frames;
}

const rawData = timelineMock as RawMockData;
const scenarioEntries = Object.entries(rawData.scenarios);

export type TrainingMockScenarioId = keyof typeof rawData.scenarios;

export function listTrainingMockScenarios(): Array<{ id: TrainingMockScenarioId; label: string }> {
  return scenarioEntries.map(([key]) => {
    const label =
      key === "success_standard_3070_autodowngrade"
        ? "标准流程（成功）"
        : "执行器未接入（失败）";
    return {
      id: key as TrainingMockScenarioId,
      label,
    };
  });
}

export function getTrainingMockFrames(scenarioId: TrainingMockScenarioId): MockFrame[] {
  const scenario = rawData.scenarios[scenarioId];
  if (!scenario) {
    return [];
  }
  return buildFramesFromScenario(scenario);
}
