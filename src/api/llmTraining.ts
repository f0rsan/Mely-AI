const API_BASE = "http://127.0.0.1:8000";

export type LLMTrainingMode = "light" | "standard" | "fine";

export type LLMTrainingStatus =
  | "queued"
  | "preparing"
  | "training"
  | "exporting"
  | "registering"
  | "completed"
  | "failed"
  | "canceled";

export type LLMTrainingJob = {
  id: string;
  characterId: string;
  datasetIds: string[];
  mode: LLMTrainingMode;
  baseModel: string;
  status: LLMTrainingStatus;
  progress: number;
  currentStep: number;
  totalSteps: number;
  loss: number | null;
  etaSeconds: number | null;
  adapterPath: string | null;
  ggufPath: string | null;
  errorMessage: string | null;
  queueTaskId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type StartTrainingPayload = {
  datasetIds: string[];
  mode: LLMTrainingMode;
  baseModel?: string;
};

function extractDetail(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as Record<string, unknown>).detail === "string"
  ) {
    return (body as Record<string, unknown>).detail as string;
  }
  return "操作失败，请稍后重试";
}

export async function startLLMTraining(
  characterId: string,
  payload: StartTrainingPayload,
  signal?: AbortSignal,
): Promise<LLMTrainingJob> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-training/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  );
  const body = await resp.json();
  if (!resp.ok) throw new Error(extractDetail(body));
  return body as LLMTrainingJob;
}

export async function getLLMTrainingJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<LLMTrainingJob> {
  const resp = await fetch(`${API_BASE}/api/llm-training/${encodeURIComponent(jobId)}`, {
    signal,
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(extractDetail(body));
  return body as LLMTrainingJob;
}

export async function listLLMTrainingJobs(
  characterId?: string,
  signal?: AbortSignal,
): Promise<LLMTrainingJob[]> {
  const url = characterId
    ? `${API_BASE}/api/llm-training?characterId=${encodeURIComponent(characterId)}`
    : `${API_BASE}/api/llm-training`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error("加载训练任务列表失败");
  return (await resp.json()) as LLMTrainingJob[];
}

export async function cancelLLMTrainingJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<LLMTrainingJob> {
  const resp = await fetch(
    `${API_BASE}/api/llm-training/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST", signal },
  );
  const body = await resp.json();
  if (!resp.ok) throw new Error(extractDetail(body));
  return body as LLMTrainingJob;
}
