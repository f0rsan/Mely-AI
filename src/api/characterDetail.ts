const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

export type CharacterDnaRecord = {
  hairColor: string | null;
  eyeColor: string | null;
  skinTone: string | null;
  bodyType: string | null;
  style: string | null;
  extraTags: string[] | null;
  autoPrompt: string | null;
};

export type CharacterDetail = {
  id: string;
  name: string;
  createdAt: string;
  fingerprint: string | null;
  dna: CharacterDnaRecord | null;
  visual: Record<string, unknown> | null;
  voice: Record<string, unknown> | null;
};

function resolveCharacterDetailUrl(characterId: string): string {
  return `${DEFAULT_API_BASE_URL}/api/characters/${characterId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCharacterDnaRecord(value: unknown): value is CharacterDnaRecord {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CharacterDnaRecord>;
  const isTextOrNull = (item: unknown): boolean => typeof item === "string" || item === null;
  const isTags =
    candidate.extraTags === null ||
    (Array.isArray(candidate.extraTags) && candidate.extraTags.every((tag) => typeof tag === "string"));

  return (
    isTextOrNull(candidate.hairColor) &&
    isTextOrNull(candidate.eyeColor) &&
    isTextOrNull(candidate.skinTone) &&
    isTextOrNull(candidate.bodyType) &&
    isTextOrNull(candidate.style) &&
    isTextOrNull(candidate.autoPrompt) &&
    isTags
  );
}

function isCharacterDetail(value: unknown): value is CharacterDetail {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CharacterDetail>;
  const fingerprint = candidate.fingerprint === null || typeof candidate.fingerprint === "string";
  const dna = candidate.dna === null || isCharacterDnaRecord(candidate.dna);
  const visual = candidate.visual === null || isObject(candidate.visual);
  const voice = candidate.voice === null || isObject(candidate.voice);

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    fingerprint &&
    dna &&
    visual &&
    voice
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

export class CharacterDetailApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CharacterDetailApiError";
    this.status = status;
  }
}

export async function fetchCharacterDetail(
  characterId: string,
  signal?: AbortSignal,
): Promise<CharacterDetail> {
  const response = await fetch(resolveCharacterDetailUrl(characterId), { signal });
  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new CharacterDetailApiError(response.status, detail);
  }

  const payload: unknown = await response.json();
  if (!isCharacterDetail(payload)) {
    throw new Error("INVALID_CHARACTER_DETAIL_RESPONSE");
  }
  return payload;
}
