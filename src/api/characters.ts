export type CharacterListItem = {
  id: string;
  name: string;
  createdAt: string;
  fingerprint?: string | null;
};

export type CharacterListResponse = {
  items: CharacterListItem[];
  total: number;
};

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

function resolveCharactersUrl(): string {
  return `${DEFAULT_API_BASE_URL}/api/characters`;
}

function extractDetail(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const detailValue = (payload as { detail?: unknown }).detail;
    if (typeof detailValue !== "string") {
      return null;
    }
    const detail = detailValue.trim();
    return detail.length > 0 ? detail : null;
  }
  return null;
}

function isCharacterListItem(value: unknown): value is CharacterListItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<CharacterListItem>;
  const fingerprint =
    candidate.fingerprint === undefined ||
    candidate.fingerprint === null ||
    typeof candidate.fingerprint === "string";

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    fingerprint
  );
}

function isCharacterListResponse(value: unknown): value is CharacterListResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<CharacterListResponse>;
  return (
    Array.isArray(candidate.items) &&
    candidate.items.every((item) => isCharacterListItem(item)) &&
    typeof candidate.total === "number"
  );
}

export async function fetchCharacterList(signal?: AbortSignal): Promise<CharacterListResponse> {
  let response: Response;
  try {
    response = await fetch(resolveCharactersUrl(), { signal });
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
    throw new Error("INVALID_CHARACTERS_RESPONSE");
  }

  if (!response.ok) {
    throw new Error("BACKEND_UNAVAILABLE");
  }

  if (!isCharacterListResponse(payload)) {
    throw new Error("INVALID_CHARACTERS_RESPONSE");
  }

  return payload;
}

export async function createCharacter(name: string): Promise<CharacterListItem> {
  const response = await fetch(resolveCharactersUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = extractDetail(payload);
    throw new Error(detail ?? "创建角色失败，请重试");
  }

  if (!isCharacterListItem(payload)) {
    throw new Error("创建角色失败，请重试");
  }

  return {
    id: payload.id,
    name: payload.name,
    createdAt: payload.createdAt,
    fingerprint: payload.fingerprint ?? null,
  };
}
