import { FetchTimeoutError, fetchWithTimeout } from "./http";

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
  stageName: string | null;
  checkpointPath: string | null;
  runRoot: string | null;
  logPath: string | null;
  logExcerpt: string | null;
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
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-training/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
        timeoutMs: 15_000,
      },
    );
    const body = await resp.json();
    if (!resp.ok) throw new Error(extractDetail(body));
    return body as LLMTrainingJob;
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("启动训练超时，请稍后重试");
    }
    throw err;
  }
}

export async function getLLMTrainingJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<LLMTrainingJob> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/api/llm-training/${encodeURIComponent(jobId)}`, {
      signal,
      timeoutMs: 10_000,
    });
    const body = await resp.json();
    if (!resp.ok) throw new Error(extractDetail(body));
    return body as LLMTrainingJob;
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("读取训练任务超时，请稍后重试");
    }
    throw err;
  }
}

export async function listLLMTrainingJobs(
  characterId?: string,
  signal?: AbortSignal,
): Promise<LLMTrainingJob[]> {
  const url = characterId
    ? `${API_BASE}/api/llm-training?characterId=${encodeURIComponent(characterId)}`
    : `${API_BASE}/api/llm-training`;
  try {
    const resp = await fetchWithTimeout(url, { signal, timeoutMs: 10_000 });
    if (!resp.ok) throw new Error("加载训练任务列表失败");
    return (await resp.json()) as LLMTrainingJob[];
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("加载训练任务列表超时，请稍后重试");
    }
    throw err;
  }
}

export async function cancelLLMTrainingJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<LLMTrainingJob> {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/llm-training/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST", signal, timeoutMs: 10_000 },
    );
    const body = await resp.json();
    if (!resp.ok) throw new Error(extractDetail(body));
    return body as LLMTrainingJob;
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("取消训练超时，请稍后重试");
    }
    throw err;
  }
}

export async function openLLMTrainingRunRoot(
  jobId: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/llm-training/${encodeURIComponent(jobId)}/open-run-root`,
      { method: "POST", signal, timeoutMs: 10_000 },
    );
    if (resp.ok) return;

    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }
    throw new Error(extractDetail(body));
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("打开运行目录超时，请稍后重试");
    }
    throw err;
  }
}
