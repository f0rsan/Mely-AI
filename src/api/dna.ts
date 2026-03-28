import { type CharacterDetail } from "./characterDetail";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

export type DnaFieldKey = "hairColor" | "eyeColor" | "skinTone" | "bodyType" | "style";

export type DnaSuggestionOption = {
  value: string;
  prompt: string;
};

export type DnaSuggestionField = {
  label: string;
  recommended: string;
  recommendedPrompt: string;
  options: DnaSuggestionOption[];
};

export type Wd14Meta = {
  available: boolean;
  modelId: string | null;
  reason: string | null;
  tags: string[];
};

export type CharacterDnaSuggestions = {
  characterId: string;
  source: string;
  fields: Record<DnaFieldKey, DnaSuggestionField>;
  autoPromptPreview: string;
  wd14: Wd14Meta;
};

export type SaveCharacterDnaPayload = {
  hairColor: string;
  eyeColor: string;
  skinTone: string;
  bodyType: string;
  style: string;
  extraTags?: string[];
};

export class CharacterDnaApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CharacterDnaApiError";
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveDnaSuggestionUrl(characterId: string): string {
  return `${DEFAULT_API_BASE_URL}/api/characters/${characterId}/dna/suggestions`;
}

function resolveDnaSaveUrl(characterId: string): string {
  return `${DEFAULT_API_BASE_URL}/api/characters/${characterId}/dna`;
}

function isSuggestionField(value: unknown): value is DnaSuggestionField {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<DnaSuggestionField>;
  return (
    typeof candidate.label === "string" &&
    typeof candidate.recommended === "string" &&
    typeof candidate.recommendedPrompt === "string" &&
    Array.isArray(candidate.options) &&
    candidate.options.every(
      (option) => isObject(option) && typeof option.value === "string" && typeof option.prompt === "string",
    )
  );
}

function isCharacterDnaSuggestions(value: unknown): value is CharacterDnaSuggestions {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CharacterDnaSuggestions>;
  if (
    typeof candidate.characterId !== "string" ||
    typeof candidate.source !== "string" ||
    typeof candidate.autoPromptPreview !== "string" ||
    !isObject(candidate.fields) ||
    !isObject(candidate.wd14)
  ) {
    return false;
  }

  const fieldKeys: DnaFieldKey[] = ["hairColor", "eyeColor", "skinTone", "bodyType", "style"];
  const fields = candidate.fields as Record<string, unknown>;
  const hasAllFields = fieldKeys.every((key) => isSuggestionField(fields[key]));
  if (!hasAllFields) {
    return false;
  }

  return (
    typeof candidate.wd14.available === "boolean" &&
    (candidate.wd14.modelId === null || typeof candidate.wd14.modelId === "string") &&
    (candidate.wd14.reason === null || typeof candidate.wd14.reason === "string") &&
    Array.isArray(candidate.wd14.tags) &&
    candidate.wd14.tags.every((tag) => typeof tag === "string")
  );
}

function isCharacterDetail(value: unknown): value is CharacterDetail {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CharacterDetail>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    (candidate.fingerprint === null || typeof candidate.fingerprint === "string")
  );
}

async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
      return payload.detail;
    }
  } catch {
    // ignore parse failure
  }

  if (response.status >= 500) {
    return "服务暂不可用，请稍后重试。";
  }
  return "请求失败，请稍后重试。";
}

export async function fetchCharacterDnaSuggestions(
  characterId: string,
  signal?: AbortSignal,
): Promise<CharacterDnaSuggestions> {
  const response = await fetch(resolveDnaSuggestionUrl(characterId), { signal });
  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new CharacterDnaApiError(response.status, detail);
  }

  const payload: unknown = await response.json();
  if (!isCharacterDnaSuggestions(payload)) {
    throw new Error("INVALID_DNA_SUGGESTION_RESPONSE");
  }
  return payload;
}

export async function saveCharacterDna(
  characterId: string,
  payload: SaveCharacterDnaPayload,
): Promise<CharacterDetail> {
  const response = await fetch(resolveDnaSaveUrl(characterId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new CharacterDnaApiError(response.status, detail);
  }

  const body: unknown = await response.json();
  if (!isCharacterDetail(body)) {
    throw new Error("INVALID_DNA_SAVE_RESPONSE");
  }
  return body;
}
