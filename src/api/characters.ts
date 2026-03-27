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
