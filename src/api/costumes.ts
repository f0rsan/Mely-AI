const API_BASE_URL = "http://127.0.0.1:8000/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostumeResponse {
  id: string;
  characterId: string;
  name: string;
  parentId: string | null;
  costumeLora: string | null;
  costumePrompt: string;
  isRoot: boolean;
  previewCount: number;
  createdAt: string;
}

export interface CostumeTreeResponse {
  characterId: string;
  costumes: CostumeResponse[];
  total: number;
}

export interface CostumePreviewResponse {
  id: string;
  costumeId: string;
  imagePath: string;
  sortOrder: number;
}

export interface CostumePreviewListResponse {
  costumeId: string;
  previews: CostumePreviewResponse[];
}

export interface CostumePreviewGenerateAcceptedResponse {
  costumeId: string;
  taskIds: string[];
  message: string;
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

export async function fetchCostumes(characterId: string): Promise<CostumeTreeResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/costumes/${encodeURIComponent(characterId)}`);
  } catch {
    throw new Error("造型列表获取失败，请检查后端是否正常运行");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("造型列表返回数据异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "造型列表获取失败，请稍后重试");
  }

  return payload as CostumeTreeResponse;
}

export async function createCostume(
  characterId: string,
  payload: { name: string; costumePrompt: string; parentId?: string }
): Promise<CostumeResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/costumes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, ...payload }),
    });
  } catch {
    throw new Error("造型创建请求失败，请检查网络连接");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("造型创建响应异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(result) ?? "造型创建失败，请稍后重试");
  }

  return result as CostumeResponse;
}

export async function updateCostume(
  costumeId: string,
  payload: { name?: string; costumePrompt?: string }
): Promise<CostumeResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/costumes/${encodeURIComponent(costumeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("造型更新请求失败，请检查网络连接");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("造型更新响应异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(result) ?? "造型更新失败，请稍后重试");
  }

  return result as CostumeResponse;
}

export async function deleteCostume(costumeId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/costumes/${encodeURIComponent(costumeId)}`, {
      method: "DELETE",
    });
  } catch {
    throw new Error("造型删除请求失败，请检查网络连接");
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("造型删除失败，请稍后重试");
    }
    throw new Error(readDetail(payload) ?? "造型删除失败，请稍后重试");
  }
}

export async function fetchCostumePreviews(costumeId: string): Promise<CostumePreviewListResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/costumes/${encodeURIComponent(costumeId)}/previews`);
  } catch {
    throw new Error("预览图获取失败，请检查后端是否正常运行");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("预览图返回数据异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "预览图获取失败，请稍后重试");
  }

  return payload as CostumePreviewListResponse;
}

export async function generateCostumePreviews(
  costumeId: string
): Promise<CostumePreviewGenerateAcceptedResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/costumes/${encodeURIComponent(costumeId)}/previews/generate`,
      { method: "POST" }
    );
  } catch {
    throw new Error("预览图生成请求失败，请检查网络连接");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("预览图生成响应异常");
  }

  if (!response.ok) {
    throw new Error(readDetail(payload) ?? "预览图生成失败，请稍后重试");
  }

  return payload as CostumePreviewGenerateAcceptedResponse;
}
