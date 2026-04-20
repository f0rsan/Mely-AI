const API_BASE = "http://127.0.0.1:8000";

export type LLMRuntimeReadinessState =
  | "unsupported"
  | "missing_runtime"
  | "installing_runtime"
  | "preparing_training_base_snapshot"
  | "runtime_broken"
  | "missing_ollama"
  | "missing_inference_model"
  | "missing_training_base_snapshot"
  | "ready";

export type LLMTrainingMode = "light" | "standard" | "fine";

export type LLMRuntimeModelInfo = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  digest: string;
};

export type LLMRuntimeStatus = {
  installed: boolean;
  running: boolean;
  version: string | null;
  minimumVersion: string;
  platform: string;
  models: LLMRuntimeModelInfo[];
  hint: string | null;
  buildVersion?: string | null;
  backendExecutable?: string | null;
  runtimeResourceRoot?: string | null;
  releaseSummaryPath?: string | null;
};

export type LLMRuntimeReadinessAction = {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
};

export type LLMRuntimeInstallProgress = {
  active: boolean;
  percent: number;
  stage: string;
  message: string;
  startedAt: string | null;
  updatedAt: string | null;
  attempt: number;
  errorMessage: string | null;
};

export type LLMRuntimeHardware = {
  gpuModel: string | null;
  vramGB: number;
  driverVersion: string | null;
  cudaVersion: string | null;
  driverCompatibility: "ok" | "incompatible" | "unknown";
  cudaCompatibility: "ok" | "incompatible" | "unknown";
  diskFreeGB: number;
  diskRequiredGB: number;
  source: string;
  supportedModes: LLMTrainingMode[];
};

export type LLMRuntimeReadiness = {
  state: LLMRuntimeReadinessState;
  ready: boolean;
  message: string;
  blockingReason: string | null;
  repairable: boolean;
  actions: LLMRuntimeReadinessAction[];
  installProgress: LLMRuntimeInstallProgress;
  hardware: LLMRuntimeHardware | null;
  checks: Record<string, unknown>;
};

function extractDetail(body: unknown, options?: { status?: number; api?: string }): string {
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as Record<string, unknown>).detail === "string"
  ) {
    const detail = (body as Record<string, unknown>).detail as string;
    if (
      options?.api === "readiness" &&
      options.status === 404 &&
      detail.trim().toLowerCase() === "not found"
    ) {
      return "当前安装包里的后端版本过旧，缺少训练环境接口。请重新运行 Windows 打包脚本并重新安装应用。";
    }
    return detail;
  }
  if (options?.api === "readiness" && options?.status === 404) {
    return "当前安装包里的后端版本过旧，缺少训练环境接口。请重新运行 Windows 打包脚本并重新安装应用。";
  }
  return "操作失败，请稍后重试";
}

export async function fetchLLMRuntime(signal?: AbortSignal): Promise<LLMRuntimeStatus> {
  const resp = await fetch(`${API_BASE}/api/llm/runtime`, { signal });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(extractDetail(body, { status: resp.status }));
  }
  return body as LLMRuntimeStatus;
}

export async function fetchLLMRuntimeReadiness(
  options?: {
    mode?: LLMTrainingMode;
    baseModel?: string;
    autoFix?: boolean;
  },
  signal?: AbortSignal,
): Promise<LLMRuntimeReadiness> {
  const query = new URLSearchParams();
  query.set("mode", options?.mode ?? "standard");
  query.set("baseModel", options?.baseModel ?? "qwen2.5:3b");
  query.set("autoFix", options?.autoFix ? "true" : "false");
  const resp = await fetch(`${API_BASE}/api/llm-runtime/readiness?${query.toString()}`, { signal });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(extractDetail(body, { status: resp.status, api: "readiness" }));
  }
  return body as LLMRuntimeReadiness;
}

export async function repairLLMRuntime(signal?: AbortSignal): Promise<LLMRuntimeReadiness> {
  const resp = await fetch(`${API_BASE}/api/llm-runtime/repair`, {
    method: "POST",
    signal,
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(extractDetail(body, { status: resp.status }));
  }
  return body as LLMRuntimeReadiness;
}

export async function openLLMRuntime(signal?: AbortSignal): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/llm/runtime/open`, {
    method: "POST",
    signal,
  });
  if (!resp.ok && resp.status !== 204) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(extractDetail(body, { status: resp.status }));
  }
}
