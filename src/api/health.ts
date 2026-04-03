export type HealthResponse = {
  status: "ok" | "error";
  app: string;
  dataRoot?: string | null;
  services: {
    api: string;
  };
  database: {
    path?: string | null;
    initialized: boolean;
    appliedMigrations?: string[];
    error?: string | null;
  };
  error?: string | null;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

function resolveHealthUrl(): string {
  return `${DEFAULT_API_BASE_URL}/api/health`;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<HealthResponse>;
  return (
    (candidate.status === "ok" || candidate.status === "error") &&
    typeof candidate.app === "string" &&
    typeof candidate.services?.api === "string" &&
    typeof candidate.database?.initialized === "boolean"
  );
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  let response: Response;
  try {
    response = await fetch(resolveHealthUrl(), { signal });
  } catch {
    throw new Error("BACKEND_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error("BACKEND_UNAVAILABLE");
    }
    throw new Error("INVALID_HEALTH_RESPONSE");
  }

  if (!isHealthResponse(payload)) {
    if (!response.ok) {
      throw new Error("BACKEND_UNAVAILABLE");
    }
    throw new Error("INVALID_HEALTH_RESPONSE");
  }

  return payload;
}
