const API_BASE = "http://127.0.0.1:8000";

export type LLMModelStatus = "pending" | "failed" | "ready" | "deleted";

export type LLMModel = {
  id: string;
  characterId: string;
  version: number;
  trainingJobId: string | null;
  baseModel: string;
  ollamaModelName: string;
  ggufPath: string;
  systemPrompt: string | null;
  datasetItemCount: number;
  lossFinal: number | null;
  status: LLMModelStatus;
  createdAt: string;
};

export type RegisterModelPayload = {
  ggufPath: string;
  baseModel?: string;
  trainingJobId?: string;
  systemPrompt?: string;
  datasetItemCount?: number;
  lossFinal?: number;
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

export async function registerLLMModel(
  characterId: string,
  payload: RegisterModelPayload,
  signal?: AbortSignal,
): Promise<LLMModel> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-models`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  );
  const body = await resp.json();
  if (!resp.ok) throw new Error(extractDetail(body));
  return body as LLMModel;
}

export async function listLLMModels(
  characterId: string,
  signal?: AbortSignal,
): Promise<LLMModel[]> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-models`,
    { signal },
  );
  if (!resp.ok) throw new Error("加载模型列表失败");
  return (await resp.json()) as LLMModel[];
}

export async function getLLMModel(
  modelId: string,
  signal?: AbortSignal,
): Promise<LLMModel> {
  const resp = await fetch(
    `${API_BASE}/api/llm-models/${encodeURIComponent(modelId)}`,
    { signal },
  );
  const body = await resp.json();
  if (!resp.ok) throw new Error(extractDetail(body));
  return body as LLMModel;
}

export async function retryLLMModelRegistration(
  modelId: string,
  signal?: AbortSignal,
): Promise<LLMModel> {
  const resp = await fetch(
    `${API_BASE}/api/llm-models/${encodeURIComponent(modelId)}/retry-registration`,
    { method: "POST", signal },
  );
  const body = await resp.json();
  if (!resp.ok) throw new Error(extractDetail(body));
  return body as LLMModel;
}

export async function deleteLLMModel(
  modelId: string,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(
    `${API_BASE}/api/llm-models/${encodeURIComponent(modelId)}`,
    { method: "DELETE", signal },
  );
  if (!resp.ok && resp.status !== 204) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(extractDetail(body));
  }
}
