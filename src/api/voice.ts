const API_BASE_URL = "http://127.0.0.1:8000";

export type VoiceStatus = "unbound" | "extracting" | "bound" | "failed";

export type VoiceAssetStatus = {
  characterId: string;
  hasReference: boolean;
  status: VoiceStatus;
  referenceAudioPath: string | null;
  durationSeconds: number | null;
  ttsEngine: string | null;
  boundAt: string | null;
};

export type TTSEngineState =
  | "stopped"
  | "starting"
  | "running"
  | "crashed"
  | "restarting"
  | "failed";

export type TTSEngineStatus = {
  state: TTSEngineState;
  restartCount: number;
  errorMessage: string | null;
  pid: number | null;
};

export type TTSEngineActionResponse = {
  status: TTSEngineStatus;
  message: string;
};

export type VoiceUploadResponse = {
  characterId: string;
  referenceAudioPath: string;
  durationSeconds: number;
  audioFormat: string;
  status: string;
  message: string;
};

export type VoiceprintExtractResponse = {
  taskId: string;
  characterId: string;
  message: string;
};

export type TTSSynthesizeResponse = {
  taskId: string;
  characterId: string;
  message: string;
};

// ---------------------------------------------------------------------------
// type guards
// ---------------------------------------------------------------------------

function isVoiceAssetStatus(v: unknown): v is VoiceAssetStatus {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["characterId"] === "string" &&
    typeof o["hasReference"] === "boolean" &&
    typeof o["status"] === "string"
  );
}

function isTTSEngineStatus(v: unknown): v is TTSEngineStatus {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o["state"] === "string" && typeof o["restartCount"] === "number";
}

function isTTSEngineActionResponse(v: unknown): v is TTSEngineActionResponse {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isTTSEngineStatus(o["status"]) && typeof o["message"] === "string";
}

function readDetail(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null) {
    const d = (payload as Record<string, unknown>)["detail"];
    if (typeof d === "string") return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// voice status & upload
// ---------------------------------------------------------------------------

export async function fetchVoiceStatus(
  characterId: string,
  signal?: AbortSignal
): Promise<VoiceAssetStatus> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/voice/${characterId}/status`, {
      signal,
    });
  } catch {
    throw new Error("语音服务连接失败，请检查后端是否正常运行");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("语音服务返回数据异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "获取声音绑定状态失败");
  }

  if (!isVoiceAssetStatus(payload)) {
    throw new Error("声音状态数据格式异常");
  }

  return payload;
}

export async function uploadReferenceAudio(
  characterId: string,
  file: File,
  durationSeconds: number,
  signal?: AbortSignal
): Promise<VoiceUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/voice/upload-reference?character_id=${encodeURIComponent(characterId)}&durationSeconds=${durationSeconds}`,
      { method: "POST", body: formData, signal }
    );
  } catch {
    throw new Error("参考音频上传失败，请检查网络连接");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("参考音频上传响应异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "参考音频上传失败");
  }

  return payload as VoiceUploadResponse;
}

export async function extractVoiceprint(
  characterId: string,
  signal?: AbortSignal
): Promise<VoiceprintExtractResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/voice/extract-voiceprint?character_id=${encodeURIComponent(characterId)}`,
      { method: "POST", signal }
    );
  } catch {
    throw new Error("声纹提取请求失败");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("声纹提取响应异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "声纹提取失败");
  }

  return payload as VoiceprintExtractResponse;
}

export async function synthesizeSpeech(
  request: {
    characterId: string;
    text: string;
    language?: string;
    speed?: number;
    outputFormat?: string;
  },
  signal?: AbortSignal
): Promise<TTSSynthesizeResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/voice/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: request.characterId,
        text: request.text,
        language: request.language ?? "zh",
        speed: request.speed ?? 1.0,
        outputFormat: request.outputFormat ?? "wav",
      }),
      signal,
    });
  } catch {
    throw new Error("语音合成请求失败");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("语音合成响应异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "语音合成失败");
  }

  return payload as TTSSynthesizeResponse;
}

// ---------------------------------------------------------------------------
// TTS engine
// ---------------------------------------------------------------------------

export async function fetchTTSEngineStatus(
  signal?: AbortSignal
): Promise<TTSEngineStatus> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/voice/engine/status`, {
      signal,
    });
  } catch {
    throw new Error("TTS_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("TTS_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "TTS_SERVICE_UNAVAILABLE");
  }

  if (!isTTSEngineStatus(payload)) {
    throw new Error("TTS_INVALID_RESPONSE");
  }

  return payload;
}

export async function startTTSEngine(
  signal?: AbortSignal
): Promise<TTSEngineActionResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/voice/engine/start`, {
      method: "POST",
      signal,
    });
  } catch {
    throw new Error("TTS_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("TTS_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "TTS 引擎启动失败，请稍后重试");
  }

  if (!isTTSEngineActionResponse(payload)) {
    throw new Error("TTS_INVALID_RESPONSE");
  }

  return payload;
}

export async function stopTTSEngine(
  signal?: AbortSignal
): Promise<TTSEngineActionResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/voice/engine/stop`, {
      method: "POST",
      signal,
    });
  } catch {
    throw new Error("TTS_SERVICE_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("TTS_SERVICE_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "TTS 引擎停止失败，请稍后重试");
  }

  if (!isTTSEngineActionResponse(payload)) {
    throw new Error("TTS_INVALID_RESPONSE");
  }

  return payload;
}
