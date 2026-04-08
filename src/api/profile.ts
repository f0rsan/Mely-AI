const BASE = "http://127.0.0.1:8000/api";

export class ProfileApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProfileApiError";
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type MemoryKind = "fact" | "event" | "relationship" | "preference";

export interface TriggerRule {
  trigger: string;
  reaction: string;
}

export interface CharacterProfile {
  characterId: string;
  updatedAt: string;
  profileVersion: number;
  // Persona
  personaSummary: string | null;
  personalityTraits: string[] | null;
  speakingStyle: string | null;
  backstory: string | null;
  valuesBeliefs: string | null;
  quirks: string | null;
  likes: string[] | null;
  dislikes: string[] | null;
  // Worldbuilding
  worldName: string | null;
  worldSetting: string | null;
  worldRules: string | null;
  worldKeyEvents: string | null;
  // Interaction
  userAddress: string;
  selfAddress: string;
  catchphrases: string[] | null;
  forbiddenWords: string[] | null;
  emotionDefault: string | null;
  triggerRules: TriggerRule[] | null;
}

export interface CharacterProfileUpdate {
  personaSummary?: string | null;
  personalityTraits?: string[] | null;
  speakingStyle?: string | null;
  backstory?: string | null;
  valuesBeliefs?: string | null;
  quirks?: string | null;
  likes?: string[] | null;
  dislikes?: string[] | null;
  worldName?: string | null;
  worldSetting?: string | null;
  worldRules?: string | null;
  worldKeyEvents?: string | null;
  userAddress?: string;
  selfAddress?: string;
  catchphrases?: string[] | null;
  forbiddenWords?: string[] | null;
  emotionDefault?: string | null;
  triggerRules?: TriggerRule[] | null;
}

export interface SystemPromptPreview {
  prompt: string;
  estimatedTokens: number;
  hasProfile: boolean;
  memoryCount: number;
}

export interface Memory {
  id: string;
  characterId: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  pinned: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  hitCount: number;
}

export interface MemoryCreate {
  kind?: MemoryKind;
  content: string;
  importance?: number;
  pinned?: boolean;
}

export interface MemoryUpdate {
  kind?: MemoryKind;
  content?: string;
  importance?: number;
  pinned?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function parseError(res: Response): Promise<ProfileApiError> {
  let detail = "操作失败，请稍后重试";
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {}
  return new ProfileApiError(detail, res.status);
}

// ── Profile API ────────────────────────────────────────────────────────────────

export async function fetchProfile(
  characterId: string,
  signal?: AbortSignal,
): Promise<CharacterProfile | null> {
  const res = await fetch(`${BASE}/characters/${characterId}/profile`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function saveProfile(
  characterId: string,
  data: CharacterProfileUpdate,
): Promise<CharacterProfile> {
  const res = await fetch(`${BASE}/characters/${characterId}/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function previewSystemPrompt(
  characterId: string,
  draft: CharacterProfileUpdate = {},
): Promise<SystemPromptPreview> {
  const res = await fetch(`${BASE}/characters/${characterId}/profile/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

// ── Memory API ─────────────────────────────────────────────────────────────────

export async function fetchMemories(
  characterId: string,
  signal?: AbortSignal,
): Promise<Memory[]> {
  const res = await fetch(`${BASE}/characters/${characterId}/memories`, { signal });
  if (!res.ok) throw await parseError(res);
  const data = await res.json();
  return data.items as Memory[];
}

export async function createMemory(
  characterId: string,
  payload: MemoryCreate,
): Promise<Memory> {
  const res = await fetch(`${BASE}/characters/${characterId}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function updateMemory(
  characterId: string,
  memoryId: string,
  payload: MemoryUpdate,
): Promise<Memory> {
  const res = await fetch(`${BASE}/characters/${characterId}/memories/${memoryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function deleteMemory(
  characterId: string,
  memoryId: string,
): Promise<void> {
  const res = await fetch(`${BASE}/characters/${characterId}/memories/${memoryId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await parseError(res);
}
