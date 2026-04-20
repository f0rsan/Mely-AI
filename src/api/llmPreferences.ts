import { FetchTimeoutError, fetchWithTimeout } from "./http";

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
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-preferences`,
      { signal, timeoutMs: 10_000 },
    );
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(extractDetail(body));
    }
    return body as CharacterLLMPreferences;
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("读取默认模型配置超时，请稍后重试");
    }
    throw err;
  }
}

export async function updateCharacterLLMPreferences(
  characterId: string,
  payload: { defaultBaseModelName: string | null },
  signal?: AbortSignal,
): Promise<CharacterLLMPreferences> {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/llm-preferences`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
        timeoutMs: 10_000,
      },
    );
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(extractDetail(body));
    }
    return body as CharacterLLMPreferences;
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      throw new Error("设置默认模型超时，请稍后重试");
    }
    throw err;
  }
}
