export type TrainingMode = "light" | "standard" | "fine";
export type TrainingModel = "flux-schnell" | "flux-dev" | "sdxl";
export type TrainingBusinessStatus =
  | "draft"
  | "queued"
  | "preparing"
  | "training"
  | "sampling"
  | "validating"
  | "completed"
  | "failed"
  | "canceled";
export type TrainingQueueStatus = "pending" | "running" | "completed" | "failed";

export type TrainingImage = {
  progress?: number;
  view?: string;
  image: string;
};

export type TrainingTaskSnapshot = {
  id: string;
  characterId: string;
  queueTaskId: string;
  requestedMode: TrainingMode;
  effectiveMode: TrainingMode;
  requestedModel: TrainingModel;
  effectiveModel: TrainingModel;
  strategyDefaultModel: string;
  runtimeDefaultModel: string;
  requestedSteps: number;
  effectiveSteps: number;
  requestedRank: number;
  effectiveRank: number;
  precheck: {
    vramGB: number;
    source: string;
    result: string;
  };
  downgradeReasons: Array<{ code: string; message: string }>;
  config: Record<string, unknown>;
  businessStatus: TrainingBusinessStatus;
  queueStatus: TrainingQueueStatus;
  progress: number;
  currentStage: string;
  latestMessage: string | null;
  latestError: string | null;
  userVisibleError: string | null;
  samplePreviews: TrainingImage[];
  validationImages: TrainingImage[];
  retrainOfTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type StartTrainingPayload = {
  characterId: string;
  mode: TrainingMode;
  baseModel?: TrainingModel;
  confirmFluxDevLicense?: boolean;
  retrainOfTaskId?: string;
  retrainStepDelta?: number;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

function resolveTrainingTasksUrl(characterId?: string): string {
  if (characterId) {
    return `${DEFAULT_API_BASE_URL}/api/training/tasks?characterId=${encodeURIComponent(characterId)}`;
  }
  return `${DEFAULT_API_BASE_URL}/api/training/tasks`;
}

function resolveTrainingTaskUrl(taskId: string): string {
  return `${DEFAULT_API_BASE_URL}/api/training/tasks/${encodeURIComponent(taskId)}`;
}

function resolveTrainingStartUrl(): string {
  return `${DEFAULT_API_BASE_URL}/api/training/start`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTrainingMode(value: unknown): value is TrainingMode {
  return value === "light" || value === "standard" || value === "fine";
}

function isTrainingModel(value: unknown): value is TrainingModel {
  return value === "flux-schnell" || value === "flux-dev" || value === "sdxl";
}

function isTrainingBusinessStatus(value: unknown): value is TrainingBusinessStatus {
  return (
    value === "draft" ||
    value === "queued" ||
    value === "preparing" ||
    value === "training" ||
    value === "sampling" ||
    value === "validating" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled"
  );
}

function isTrainingQueueStatus(value: unknown): value is TrainingQueueStatus {
  return value === "pending" || value === "running" || value === "completed" || value === "failed";
}

function isTrainingImage(value: unknown): value is TrainingImage {
  if (!isRecord(value) || typeof value.image !== "string") {
    return false;
  }
  const hasValidProgress = value.progress === undefined || typeof value.progress === "number";
  const hasValidView = value.view === undefined || typeof value.view === "string";
  return hasValidProgress && hasValidView;
}

function isTrainingTaskSnapshot(value: unknown): value is TrainingTaskSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.characterId !== "string" ||
    typeof value.queueTaskId !== "string" ||
    !isTrainingMode(value.requestedMode) ||
    !isTrainingMode(value.effectiveMode) ||
    !isTrainingModel(value.requestedModel) ||
    !isTrainingModel(value.effectiveModel) ||
    typeof value.strategyDefaultModel !== "string" ||
    typeof value.runtimeDefaultModel !== "string" ||
    typeof value.requestedSteps !== "number" ||
    typeof value.effectiveSteps !== "number" ||
    typeof value.requestedRank !== "number" ||
    typeof value.effectiveRank !== "number" ||
    !isRecord(value.precheck) ||
    typeof value.precheck.vramGB !== "number" ||
    typeof value.precheck.source !== "string" ||
    typeof value.precheck.result !== "string" ||
    !Array.isArray(value.downgradeReasons) ||
    !isRecord(value.config) ||
    !isTrainingBusinessStatus(value.businessStatus) ||
    !isTrainingQueueStatus(value.queueStatus) ||
    typeof value.progress !== "number" ||
    typeof value.currentStage !== "string" ||
    !(value.latestMessage === null || typeof value.latestMessage === "string") ||
    !(value.latestError === null || typeof value.latestError === "string") ||
    !(value.userVisibleError === null || typeof value.userVisibleError === "string") ||
    !Array.isArray(value.samplePreviews) ||
    !Array.isArray(value.validationImages) ||
    !(value.retrainOfTaskId === null || typeof value.retrainOfTaskId === "string") ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !(value.startedAt === null || typeof value.startedAt === "string") ||
    !(value.finishedAt === null || typeof value.finishedAt === "string")
  ) {
    return false;
  }

  const reasonsValid = value.downgradeReasons.every(
    (item) => isRecord(item) && typeof item.code === "string" && typeof item.message === "string",
  );

  if (!reasonsValid) {
    return false;
  }

  const sampleValid = value.samplePreviews.every((item) => isTrainingImage(item));
  const validationValid = value.validationImages.every((item) => isTrainingImage(item));
  return sampleValid && validationValid;
}

function extractErrorMessage(payload: unknown): string {
  if (isRecord(payload) && typeof payload.detail === "string") {
    return payload.detail;
  }
  return "训练请求失败，请稍后重试。";
}

async function parseJsonOrThrow(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("INVALID_TRAINING_RESPONSE");
  }
}

export async function fetchTrainingTasks(
  characterId?: string,
  signal?: AbortSignal,
): Promise<TrainingTaskSnapshot[]> {
  let response: Response;
  try {
    response = await fetch(resolveTrainingTasksUrl(characterId), { signal });
  } catch {
    throw new Error("TRAINING_SERVICE_UNAVAILABLE");
  }

  const payload = await parseJsonOrThrow(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }

  if (!Array.isArray(payload) || !payload.every((item) => isTrainingTaskSnapshot(item))) {
    throw new Error("INVALID_TRAINING_RESPONSE");
  }

  return payload;
}

export async function fetchTrainingTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<TrainingTaskSnapshot> {
  let response: Response;
  try {
    response = await fetch(resolveTrainingTaskUrl(taskId), { signal });
  } catch {
    throw new Error("TRAINING_SERVICE_UNAVAILABLE");
  }

  const payload = await parseJsonOrThrow(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }

  if (!isTrainingTaskSnapshot(payload)) {
    throw new Error("INVALID_TRAINING_RESPONSE");
  }

  return payload;
}

export async function startTraining(
  payload: StartTrainingPayload,
  signal?: AbortSignal,
): Promise<TrainingTaskSnapshot> {
  let response: Response;
  try {
    response = await fetch(resolveTrainingStartUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new Error("TRAINING_SERVICE_UNAVAILABLE");
  }

  const responsePayload = await parseJsonOrThrow(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(responsePayload));
  }

  if (!isTrainingTaskSnapshot(responsePayload)) {
    throw new Error("INVALID_TRAINING_RESPONSE");
  }

  return responsePayload;
}
