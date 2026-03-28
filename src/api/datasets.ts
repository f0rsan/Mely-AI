const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

export type DatasetAngleBucket =
  | "front"
  | "threeQuarter"
  | "side"
  | "back"
  | "closeup"
  | "fullBody"
  | "unknown";

export type DatasetProblemItem = {
  imageId: string;
  name: string;
  angleBucket: DatasetAngleBucket | string;
  issues: string[];
};

export type DatasetImageItem = {
  imageId: string;
  name: string;
  relativePath: string;
  imageFormat: string;
  width: number;
  height: number;
  fileSize: number;
  angleBucket: DatasetAngleBucket | string;
  qualityStatus: "qualified" | "problem" | string;
  issues: string[];
};

export type RecommendedTrainingMode = {
  mode: "light" | "standard" | "fine" | string;
  reason: string;
  suggestedSteps: number;
  suggestedRank: number;
  minRecommendedImages: number;
  strategyDefaultModel: string;
  runtimeModelHintOn8GB: string;
};

export type DatasetReport = {
  characterId: string;
  totalImages: number;
  qualifiedImages: number;
  problemImages: number;
  qualityScore: number;
  angleDistribution: Record<string, number>;
  problemItems: DatasetProblemItem[];
  recommendedTrainingMode: RecommendedTrainingMode;
  recommendations: string[];
  images: DatasetImageItem[];
  updatedAt: string;
};

type ApiDetail = {
  detail?: string;
};

export class DatasetApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DatasetApiError";
    this.status = status;
  }
}

function resolveDatasetImportUrl(characterId: string): string {
  return `${DEFAULT_API_BASE_URL}/api/characters/${characterId}/dataset/import`;
}

function resolveDatasetReportUrl(characterId: string): string {
  return `${DEFAULT_API_BASE_URL}/api/characters/${characterId}/dataset/report`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDatasetReport(value: unknown): value is DatasetReport {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.characterId === "string" &&
    typeof value.totalImages === "number" &&
    typeof value.qualifiedImages === "number" &&
    typeof value.problemImages === "number" &&
    typeof value.qualityScore === "number" &&
    isObject(value.angleDistribution) &&
    Array.isArray(value.problemItems) &&
    Array.isArray(value.recommendations) &&
    Array.isArray(value.images) &&
    isObject(value.recommendedTrainingMode) &&
    typeof value.updatedAt === "string"
  );
}

async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiDetail;
    if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
      return payload.detail;
    }
  } catch {
    // ignore parse errors
  }

  if (response.status >= 500) {
    return "服务暂不可用，请稍后重试";
  }
  return "请求失败，请稍后重试";
}

async function encodeFileToBase64(file: File): Promise<string> {
  let bytes: Uint8Array;
  if (typeof file.arrayBuffer === "function") {
    const buffer = await file.arrayBuffer();
    bytes = new Uint8Array(buffer);
  } else {
    bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
      reader.onload = () => {
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(new Error("FILE_READ_FAILED"));
          return;
        }
        resolve(new Uint8Array(reader.result));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function importCharacterDataset(
  characterId: string,
  files: File[],
  signal?: AbortSignal,
): Promise<DatasetReport> {
  const images = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      contentBase64: await encodeFileToBase64(file),
    })),
  );

  const response = await fetch(resolveDatasetImportUrl(characterId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images }),
    signal,
  });

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new DatasetApiError(response.status, detail);
  }

  const payload: unknown = await response.json();
  if (!isDatasetReport(payload)) {
    throw new Error("INVALID_DATASET_REPORT_RESPONSE");
  }
  return payload;
}

export async function fetchCharacterDatasetReport(
  characterId: string,
  signal?: AbortSignal,
): Promise<DatasetReport> {
  const response = await fetch(resolveDatasetReportUrl(characterId), { signal });
  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new DatasetApiError(response.status, detail);
  }

  const payload: unknown = await response.json();
  if (!isDatasetReport(payload)) {
    throw new Error("INVALID_DATASET_REPORT_RESPONSE");
  }
  return payload;
}
