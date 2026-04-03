const API_BASE_URL = "http://127.0.0.1:8000";

export type GenerationArchiveRequest = {
  characterId: string;
  costumeId: string;
  assembledPrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  seed: number | null;
  loraWeight: number;
  tags?: string[];
  // Formal archive requires real image bytes; backend rejects empty payloads.
  imageDataB64?: string | null;
};

export type GenerationArchiveRecord = {
  id: string;
  characterId: string;
  costumeId: string;
  outputPath: string;
  paramsSnapshot: Record<string, unknown>;
  tags: string[];
  createdAt: string;
};

export type GenerationArchiveListResponse = {
  items: GenerationArchiveRecord[];
};

function isArchiveRecord(value: unknown): value is GenerationArchiveRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["characterId"] === "string" &&
    typeof v["costumeId"] === "string" &&
    typeof v["outputPath"] === "string" &&
    typeof v["paramsSnapshot"] === "object" &&
    Array.isArray(v["tags"]) &&
    typeof v["createdAt"] === "string"
  );
}

function readBackendDetail(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null) {
    const d = (payload as Record<string, unknown>)["detail"];
    if (typeof d === "string") return d;
  }
  return null;
}

export async function archiveGeneration(
  request: GenerationArchiveRequest,
  signal?: AbortSignal
): Promise<GenerationArchiveRecord> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/generations/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw new Error("ARCHIVE_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("ARCHIVE_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error(readBackendDetail(payload) ?? "ARCHIVE_FAILED");
  }

  if (!isArchiveRecord(payload)) {
    throw new Error("ARCHIVE_INVALID_RESPONSE");
  }

  return payload;
}

export async function fetchGenerationById(
  generationId: string,
  signal?: AbortSignal
): Promise<GenerationArchiveRecord> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/generations/${generationId}`,
      { signal }
    );
  } catch {
    throw new Error("ARCHIVE_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("ARCHIVE_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error(readBackendDetail(payload) ?? "ARCHIVE_FETCH_FAILED");
  }

  if (!isArchiveRecord(payload)) {
    throw new Error("ARCHIVE_INVALID_RESPONSE");
  }

  return payload;
}

export async function fetchGenerationArchives(
  characterId: string,
  signal?: AbortSignal
): Promise<GenerationArchiveListResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/characters/${characterId}/generations`,
      { signal }
    );
  } catch {
    throw new Error("ARCHIVE_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("ARCHIVE_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error(readBackendDetail(payload) ?? "ARCHIVE_FETCH_FAILED");
  }

  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p["items"])) {
    throw new Error("ARCHIVE_INVALID_RESPONSE");
  }

  return { items: p["items"] as GenerationArchiveRecord[] };
}
