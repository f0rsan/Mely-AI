const API_BASE = "http://127.0.0.1:8000";

export type LLMSourceFormat = "persona_doc" | "dialogue_jsonl" | "dialogue_csv" | "mixed";

export type LLMDataset = {
  id: string;
  characterId: string;
  name: string;
  sourceFormat: LLMSourceFormat;
  itemCount: number;
  qualityScore: number | null;
  qualityIssues: string[];
  convertedPath: string | null;
  createdAt: string;
};

export type ConversationPreviewItem = {
  human: string;
  gpt: string;
};

export type UploadDatasetPayload = {
  filename: string;
  content: string;
};

function extractDetail(body: unknown): string {
  if (body && typeof body === "object" && "detail" in body && typeof (body as Record<string, unknown>).detail === "string") {
    return (body as Record<string, unknown>).detail as string;
  }
  return "上传失败，请稍后重试";
}

export async function uploadLLMDataset(
  characterId: string,
  payload: UploadDatasetPayload,
  signal?: AbortSignal,
): Promise<LLMDataset> {
  const resp = await fetch(`${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-datasets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(extractDetail(body));
  return body as LLMDataset;
}

export async function listLLMDatasets(
  characterId: string,
  signal?: AbortSignal,
): Promise<LLMDataset[]> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-datasets`,
    { signal },
  );
  if (!resp.ok) throw new Error("加载数据集列表失败");
  return (await resp.json()) as LLMDataset[];
}

export async function previewLLMDataset(
  datasetId: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<ConversationPreviewItem[]> {
  const resp = await fetch(
    `${API_BASE}/api/llm-datasets/${encodeURIComponent(datasetId)}/preview?limit=${limit}`,
    { signal },
  );
  if (!resp.ok) throw new Error("加载预览失败");
  return (await resp.json()) as ConversationPreviewItem[];
}

export async function deleteLLMDataset(
  datasetId: string,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(
    `${API_BASE}/api/llm-datasets/${encodeURIComponent(datasetId)}`,
    { method: "DELETE", signal },
  );
  if (!resp.ok && resp.status !== 204) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(extractDetail(body));
  }
}
