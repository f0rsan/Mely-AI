const API_BASE = "http://127.0.0.1:8000";

export type LLMRuntimeModelInfo = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  digest: string;
};

export type LLMRuntimeStatus = {
  installed: boolean;
  running: boolean;
  version: string | null;
  minimumVersion: string;
  platform: string;
  models: LLMRuntimeModelInfo[];
  hint: string | null;
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

export async function fetchLLMRuntime(signal?: AbortSignal): Promise<LLMRuntimeStatus> {
  const resp = await fetch(`${API_BASE}/api/llm/runtime`, { signal });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(extractDetail(body));
  }
  return body as LLMRuntimeStatus;
}

export async function openLLMRuntime(signal?: AbortSignal): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/llm/runtime/open`, {
    method: "POST",
    signal,
  });
  if (!resp.ok && resp.status !== 204) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(extractDetail(body));
  }
}
