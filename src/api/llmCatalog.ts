import { FetchTimeoutError, fetchWithTimeout } from "./http";

const API_BASE = "http://127.0.0.1:8000";

export type LLMCatalogKind = "text" | "vision";
export type LLMCatalogTier = "default" | "light" | "vision";

export type LLMCatalogItem = {
  id: string;
  modelName: string;
  displayName: string;
  kind: LLMCatalogKind;
  tier: LLMCatalogTier;
  sizeLabel: string;
  recommended: boolean;
  visionCapable: boolean;
  minOllamaVersion: string | null;
  memoryHint: string;
};

export type LLMCatalogResponse = {
  items: LLMCatalogItem[];
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

export async function fetchLLMCatalog(signal?: AbortSignal): Promise<LLMCatalogResponse> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/api/llm/catalog`, {
      signal,
      timeoutMs: 10_000,
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(extractDetail(body));
    }
    return body as LLMCatalogResponse;
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("加载模型库超时，请稍后重试");
    }
    throw err;
  }
}

export async function deleteLLMRuntimeModel(modelName: string, signal?: AbortSignal): Promise<void> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/api/llm/models`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
      signal,
      timeoutMs: 10_000,
    });
    if (!resp.ok && resp.status !== 204) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(extractDetail(body));
    }
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("删除基础模型超时，请稍后重试");
    }
    throw err;
  }
}
