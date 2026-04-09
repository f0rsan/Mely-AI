import type { EngineState } from "./engine";
import type { TTSEngineState } from "./voice";

const API_BASE = "http://127.0.0.1:8000";

export type SetupStatus = {
  backend: {
    status: "ok" | "error";
    dataRoot: string | null;
    databaseInitialized: boolean;
  };
  gpu: {
    vramGB: number;
    source: string;
    result: string;
    recommendedMode: "text_only" | "light" | "standard" | "fine";
    target3070Ready: boolean;
    fineTuneReady: boolean;
    recommendation: string;
  };
  llm: {
    installed: boolean;
    running: boolean;
    version: string | null;
    minimumVersion: string;
    platform: string;
    models: Array<{
      name: string;
      sizeBytes: number;
      modifiedAt: string;
      digest: string;
    }>;
    hint: string | null;
  };
  imageEngine: {
    state: EngineState;
    restartCount: number;
    errorMessage: string | null;
    pid: number | null;
  };
  ttsEngine: {
    state: TTSEngineState;
    restartCount: number;
    errorMessage: string | null;
    pid: number | null;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSetupStatus(value: unknown): value is SetupStatus {
  if (!isObject(value)) return false;
  const backend = value["backend"];
  const gpu = value["gpu"];
  const llm = value["llm"];
  const imageEngine = value["imageEngine"];
  const ttsEngine = value["ttsEngine"];
  return (
    isObject(backend) &&
    (backend["status"] === "ok" || backend["status"] === "error") &&
    typeof backend["databaseInitialized"] === "boolean" &&
    isObject(gpu) &&
    typeof gpu["vramGB"] === "number" &&
    typeof gpu["recommendation"] === "string" &&
    isObject(llm) &&
    typeof llm["installed"] === "boolean" &&
    typeof llm["running"] === "boolean" &&
    Array.isArray(llm["models"]) &&
    isObject(imageEngine) &&
    typeof imageEngine["state"] === "string" &&
    isObject(ttsEngine) &&
    typeof ttsEngine["state"] === "string"
  );
}

function readDetail(payload: unknown): string | null {
  if (isObject(payload) && typeof payload["detail"] === "string") {
    return payload["detail"];
  }
  return null;
}

export async function fetchSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/setup/status`, { signal });
  } catch {
    throw new Error("环境状态检测失败，请确认本地后端已经启动。");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "环境状态检测失败，请稍后重试。");
  }

  if (!isSetupStatus(payload)) {
    throw new Error("环境状态数据格式异常，请稍后重试。");
  }

  return payload;
}
