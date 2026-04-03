const API_BASE = "http://127.0.0.1:8000";

export type OllamaModelInfo = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  digest: string;
};

export type LLMHealthStatus = {
  running: boolean;
  version: string | null;
  models: OllamaModelInfo[];
  hint: string | null;
};

export async function fetchLLMHealth(signal?: AbortSignal): Promise<LLMHealthStatus> {
  const resp = await fetch(`${API_BASE}/api/llm/health`, { signal });
  if (!resp.ok) throw new Error("LLM health check failed");
  return (await resp.json()) as LLMHealthStatus;
}
