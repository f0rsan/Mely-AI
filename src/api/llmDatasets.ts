import { FetchTimeoutError, fetchWithTimeout } from "./http";

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
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-datasets`,
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
    return body as LLMDataset;
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("上传数据集超时，请稍后重试");
    }
    throw err;
  }
}

export async function listLLMDatasets(
  characterId: string,
  signal?: AbortSignal,
): Promise<LLMDataset[]> {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-datasets`,
      { signal, timeoutMs: 10_000 },
    );
    if (!resp.ok) throw new Error("加载数据集列表失败");
    return (await resp.json()) as LLMDataset[];
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("加载数据集列表超时，请稍后重试");
    }
    throw err;
  }
}

export async function previewLLMDataset(
  datasetId: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<ConversationPreviewItem[]> {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/llm-datasets/${encodeURIComponent(datasetId)}/preview?limit=${limit}`,
      { signal, timeoutMs: 10_000 },
    );
    if (!resp.ok) throw new Error("加载预览失败");
    return (await resp.json()) as ConversationPreviewItem[];
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("加载预览超时，请稍后重试");
    }
    throw err;
  }
}

export async function deleteLLMDataset(
  datasetId: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/llm-datasets/${encodeURIComponent(datasetId)}`,
      { method: "DELETE", signal, timeoutMs: 10_000 },
    );
    if (!resp.ok && resp.status !== 204) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(extractDetail(body));
    }
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("删除数据集超时，请稍后重试");
    }
    throw err;
  }
}
