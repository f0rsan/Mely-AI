import type { TaskSnapshot } from "./tasks";

export type GenerationCostumeOption = {
  id: string;
  name: string;
  costumePrompt: string;
  isDefault: boolean;
};

export type GenerationPromptSources = {
  dnaPrompt: string;
  triggerWord: string;
  costumePrompt: string;
};

export type GenerationParameterDefaults = {
  width: number;
  height: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  seed: number | null;
  loraWeight: number;
};

export type GenerationWorkbenchContract = {
  characterId: string;
  characterName: string;
  canGenerate: boolean;
  blockingReason: string | null;
  costumes: GenerationCostumeOption[];
  selectedCostumeId: string;
  promptSources: GenerationPromptSources;
  parameterDefaults: GenerationParameterDefaults;
  tagOptions: string[];
};

export type GenerationMockRequest = {
  characterId: string;
  costumeId: string;
  scenePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  seed: number | null;
  loraWeight: number;
  tags: string[];
};

export type GenerationMockJob = {
  id: string;
  taskId: string;
  characterId: string;
  costumeId: string;
  scenePrompt: string;
  status: "pending" | "running" | "completed" | "failed";
  stage: "queued" | "running" | "completed" | "failed";
  progress: number;
  message?: string | null;
  error?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type GenerationCostumePayload = {
  id?: unknown;
  name?: unknown;
  costumePrompt?: unknown;
  isDefault?: unknown;
  parentId?: unknown;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

function resolveWorkbenchUrl(characterId: string): string {
  return `${DEFAULT_API_BASE_URL}/api/characters/${characterId}/generation-workbench`;
}

function resolveMockGenerationUrl(): string {
  return `${DEFAULT_API_BASE_URL}/api/generations/mock`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeGenerationCostume(payload: unknown): GenerationCostumeOption | null {
  if (!isObject(payload)) {
    return null;
  }

  const candidate = payload as GenerationCostumePayload;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.costumePrompt !== "string"
  ) {
    return null;
  }

  const isDefault =
    typeof candidate.isDefault === "boolean"
      ? candidate.isDefault
      : candidate.parentId === null && candidate.name === "基础造型";

  return {
    id: candidate.id,
    name: candidate.name,
    costumePrompt: candidate.costumePrompt,
    isDefault,
  };
}

function normalizeGenerationWorkbenchContract(value: unknown): GenerationWorkbenchContract | null {
  if (!isObject(value)) {
    return null;
  }

  const costumes = Array.isArray(value.costumes)
    ? value.costumes.map((item) => normalizeGenerationCostume(item))
    : null;
  if (costumes === null || costumes.some((item) => item === null)) {
    return null;
  }

  if (
    typeof value.characterId !== "string" ||
    typeof value.characterName !== "string" ||
    typeof value.canGenerate !== "boolean" ||
    (value.blockingReason !== null && typeof value.blockingReason !== "string") ||
    typeof value.selectedCostumeId !== "string" ||
    !isObject(value.promptSources) ||
    !isObject(value.parameterDefaults) ||
    !Array.isArray(value.tagOptions) ||
    !value.tagOptions.every((item) => typeof item === "string")
  ) {
    return null;
  }

  const promptSources = value.promptSources;
  const parameterDefaults = value.parameterDefaults;
  if (
    typeof promptSources.dnaPrompt !== "string" ||
    typeof promptSources.triggerWord !== "string" ||
    typeof promptSources.costumePrompt !== "string" ||
    typeof parameterDefaults.width !== "number" ||
    typeof parameterDefaults.height !== "number" ||
    typeof parameterDefaults.steps !== "number" ||
    typeof parameterDefaults.sampler !== "string" ||
    typeof parameterDefaults.cfgScale !== "number" ||
    (parameterDefaults.seed !== null && typeof parameterDefaults.seed !== "number") ||
    typeof parameterDefaults.loraWeight !== "number"
  ) {
    return null;
  }

  return {
    characterId: value.characterId,
    characterName: value.characterName,
    canGenerate: value.canGenerate,
    blockingReason: value.blockingReason,
    costumes: costumes as GenerationCostumeOption[],
    selectedCostumeId: value.selectedCostumeId,
    promptSources: {
      dnaPrompt: promptSources.dnaPrompt,
      triggerWord: promptSources.triggerWord,
      costumePrompt: promptSources.costumePrompt,
    },
    parameterDefaults: {
      width: parameterDefaults.width,
      height: parameterDefaults.height,
      steps: parameterDefaults.steps,
      sampler: parameterDefaults.sampler,
      cfgScale: parameterDefaults.cfgScale,
      seed: parameterDefaults.seed as number | null,
      loraWeight: parameterDefaults.loraWeight,
    },
    tagOptions: value.tagOptions as string[],
  };
}

function isGenerationMockJob(value: unknown): value is GenerationMockJob {
  if (!isObject(value)) {
    return false;
  }

  const validStatus =
    value.status === "pending" ||
    value.status === "running" ||
    value.status === "completed" ||
    value.status === "failed";
  const validStage =
    value.stage === "queued" ||
    value.stage === "running" ||
    value.stage === "completed" ||
    value.stage === "failed";

  return (
    typeof value.id === "string" &&
    typeof value.taskId === "string" &&
    typeof value.characterId === "string" &&
    typeof value.costumeId === "string" &&
    typeof value.scenePrompt === "string" &&
    validStatus &&
    validStage &&
    typeof value.progress === "number" &&
    Array.isArray(value.tags) &&
    value.tags.every((item) => typeof item === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isGenerationMockResponse(value: unknown): value is { job: GenerationMockJob } {
  if (!isObject(value)) {
    return false;
  }

  return isGenerationMockJob(value.job);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readBackendDetail(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }

  return typeof payload.detail === "string" ? payload.detail : null;
}

export async function fetchGenerationWorkbenchContract(
  characterId: string,
  signal?: AbortSignal,
): Promise<GenerationWorkbenchContract> {
  let response: Response;
  try {
    response = await fetch(resolveWorkbenchUrl(characterId), { signal });
  } catch {
    throw new Error("GENERATION_CONTRACT_UNAVAILABLE");
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(readBackendDetail(payload) ?? "GENERATION_CONTRACT_UNAVAILABLE");
  }

  const contract = normalizeGenerationWorkbenchContract(payload);
  if (contract === null) {
    throw new Error("INVALID_GENERATION_CONTRACT_RESPONSE");
  }

  return contract;
}

export async function createMockGenerationJob(
  input: GenerationMockRequest,
  signal?: AbortSignal,
): Promise<GenerationMockJob> {
  let response: Response;
  try {
    response = await fetch(resolveMockGenerationUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    throw new Error("GENERATION_SUBMIT_UNAVAILABLE");
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(readBackendDetail(payload) ?? "GENERATION_SUBMIT_FAILED");
  }

  if (!isGenerationMockResponse(payload)) {
    throw new Error("INVALID_GENERATION_SUBMIT_RESPONSE");
  }

  return payload.job;
}

export function mergeTaskIntoGenerationJob(
  job: GenerationMockJob,
  task: TaskSnapshot,
): GenerationMockJob {
  const stage =
    task.status === "pending"
      ? "queued"
      : task.status === "running"
        ? "running"
        : task.status === "completed"
          ? "completed"
          : "failed";

  return {
    ...job,
    status: task.status,
    stage,
    progress: task.progress,
    message: task.message,
    error: task.error,
    updatedAt: task.updatedAt,
  };
}
