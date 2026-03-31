const API_BASE_URL = "http://127.0.0.1:8000";

export type PromptComponent = {
  source: "trigger_word" | "dna_prompt" | "costume_prompt" | "scene_prompt" | "override";
  label: string;
  content: string;
  active: boolean;
};

export type AssembledPromptResponse = {
  assembled: string;
  tokenCount: number;
  components: PromptComponent[];
  wasOverridden: boolean;
};

export type PromptAssembleRequest = {
  scenePrompt: string;
  dnaPrompt?: string;
  triggerWord?: string;
  costumePrompt?: string;
  overridePrompt?: string | null;
};

function isPromptComponent(value: unknown): value is PromptComponent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["source"] === "string" &&
    typeof v["label"] === "string" &&
    typeof v["content"] === "string" &&
    typeof v["active"] === "boolean"
  );
}

function isAssembledPromptResponse(value: unknown): value is AssembledPromptResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["assembled"] === "string" &&
    typeof v["tokenCount"] === "number" &&
    Array.isArray(v["components"]) &&
    (v["components"] as unknown[]).every(isPromptComponent) &&
    typeof v["wasOverridden"] === "boolean"
  );
}

export async function assemblePrompt(
  request: PromptAssembleRequest,
  signal?: AbortSignal
): Promise<AssembledPromptResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/prompt/assemble`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw new Error("PROMPT_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("PROMPT_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null
        ? ((payload as Record<string, unknown>)["detail"] as string | undefined)
        : undefined;
    throw new Error(detail ?? "PROMPT_ASSEMBLE_FAILED");
  }

  if (!isAssembledPromptResponse(payload)) {
    throw new Error("PROMPT_INVALID_RESPONSE");
  }

  return payload;
}
