const API_BASE_URL = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportRecord {
  id: string;
  characterId: string;
  exportType: string;
  filePath: string;
  fileSize: number | null;
  status: "pending" | "generating" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ExportListResponse {
  items: ExportRecord[];
}

export interface ExportAcceptedResponse {
  exportId: string;
  taskId: string;
  characterId: string;
  message: string;
}

export interface ProofExportResponse {
  characterId: string;
  chain: Record<string, unknown>[];
  total: number;
  message: string;
}

export interface ProofVerifyResponse {
  characterId: string;
  isValid: boolean;
  totalProofs: number;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readDetail(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null) {
    const d = (payload as Record<string, unknown>)["detail"];
    if (typeof d === "string") return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function exportCharacterPdf(
  characterId: string
): Promise<ExportAcceptedResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/exports/pdf?character_id=${encodeURIComponent(characterId)}`,
      { method: "POST" }
    );
  } catch {
    throw new Error("导出请求失败，请检查后端是否正常运行");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("导出服务返回数据异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "设定书导出失败，请稍后重试");
  }

  return payload as ExportAcceptedResponse;
}

export async function fetchExports(
  characterId: string
): Promise<ExportListResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/exports?character_id=${encodeURIComponent(characterId)}`
    );
  } catch {
    throw new Error("导出服务连接失败，请检查后端是否正常运行");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("导出服务返回数据异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "导出记录获取失败，请稍后重试");
  }

  return payload as ExportListResponse;
}

export async function fetchProofChain(
  characterId: string
): Promise<ProofExportResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/exports/proof-chain?character_id=${encodeURIComponent(characterId)}`
    );
  } catch {
    throw new Error("证明链服务连接失败，请检查后端是否正常运行");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("证明链服务返回数据异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "创作证明链获取失败，请稍后重试");
  }

  return payload as ProofExportResponse;
}

export async function verifyProofChain(
  characterId: string
): Promise<ProofVerifyResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/exports/proof-chain/verify?character_id=${encodeURIComponent(characterId)}`,
      { method: "POST" }
    );
  } catch {
    throw new Error("证明链验证请求失败，请检查后端是否正常运行");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("证明链验证服务返回数据异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "证明链验证失败，请稍后重试");
  }

  return payload as ProofVerifyResponse;
}

// Download URL helper — synchronous, just returns the URL string
export function getExportDownloadUrl(exportId: string): string {
  return `${API_BASE_URL}/api/exports/${exportId}/download`;
}
