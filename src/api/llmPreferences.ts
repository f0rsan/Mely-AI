const API_BASE = "http://127.0.0.1:8000";

export type CharacterLLMPreferences = {
  characterId: string;
  defaultBaseModelName: string | null;
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

export async function fetchCharacterLLMPreferences(
  characterId: string,
  signal?: AbortSignal,
): Promise<CharacterLLMPreferences> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-preferences`,
    { signal },
  );
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(extractDetail(body));
  }
  return body as CharacterLLMPreferences;
}

export async function updateCharacterLLMPreferences(
  characterId: string,
  payload: { defaultBaseModelName: string | null },
  signal?: AbortSignal,
): Promise<CharacterLLMPreferences> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-preferences`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  );
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(extractDetail(body));
  }
  return body as CharacterLLMPreferences;
}
