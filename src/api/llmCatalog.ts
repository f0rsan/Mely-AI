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
  const resp = await fetch(`${API_BASE}/api/llm/catalog`, { signal });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(extractDetail(body));
  }
  return body as LLMCatalogResponse;
}

export async function deleteLLMRuntimeModel(modelName: string, signal?: AbortSignal): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/llm/models`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName }),
    signal,
  });
  if (!resp.ok && resp.status !== 204) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(extractDetail(body));
  }
}
