const API_BASE_URL = "http://127.0.0.1:8000";

export type BatchJobItem = {
  taskId: string;
  scenePrompt: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  message?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BatchGenerationResponse = {
  batchId: string;
  jobs: BatchJobItem[];
  total: number;
};

export type BatchGenerationRequest = {
  characterId: string;
  costumeId: string;
  scenePrompts: string[];
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  seed: number | null;
  loraWeight: number;
  tags?: string[];
};

function isBatchJobItem(value: unknown): value is BatchJobItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["taskId"] === "string" &&
    typeof v["scenePrompt"] === "string" &&
    (v["status"] === "pending" ||
      v["status"] === "running" ||
      v["status"] === "completed" ||
      v["status"] === "failed") &&
    typeof v["progress"] === "number" &&
    typeof v["createdAt"] === "string" &&
    typeof v["updatedAt"] === "string"
  );
}

function isBatchGenerationResponse(value: unknown): value is BatchGenerationResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["batchId"] === "string" &&
    typeof v["total"] === "number" &&
    Array.isArray(v["jobs"]) &&
    (v["jobs"] as unknown[]).every(isBatchJobItem)
  );
}

export async function submitBatchGeneration(
  request: BatchGenerationRequest,
  signal?: AbortSignal,
): Promise<BatchGenerationResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/generations/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw new Error("BATCH_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("BATCH_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    const detail =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as Record<string, unknown>)["detail"] === "string"
        ? (payload as Record<string, unknown>)["detail"]
        : null;
    throw new Error((detail as string | null) ?? "BATCH_SUBMIT_FAILED");
  }

  if (!isBatchGenerationResponse(payload)) {
    throw new Error("BATCH_INVALID_RESPONSE");
  }

  return payload;
}
