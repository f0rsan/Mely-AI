const API_BASE = "http://127.0.0.1:8000";

export type VisualDataset = {
  id: string;
  characterId: string;
  name: string;
  imageCount: number;
  qualityScore: number | null;
  qualityIssues: string[];
  createdAt: string;
};

export type VisualImage = {
  id: string;
  datasetId: string;
  filename: string;
  storedPath: string;
  width: number | null;
  height: number | null;
  tags: string[];
  source: string;
  createdAt: string;
};

export async function createVisualDataset(
  characterId: string,
  name: string,
): Promise<VisualDataset> {
  const resp = await fetch(`${API_BASE}/api/visual-datasets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId, name }),
  });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "创建数据集失败");
  return (await resp.json()) as VisualDataset;
}

export async function listVisualDatasets(characterId: string): Promise<VisualDataset[]> {
  const resp = await fetch(
    `${API_BASE}/api/visual-datasets?characterId=${encodeURIComponent(characterId)}`,
  );
  if (!resp.ok) throw new Error("加载数据集失败");
  return (await resp.json()) as VisualDataset[];
}

export async function deleteVisualDataset(datasetId: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/visual-datasets/${datasetId}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("删除数据集失败");
}

export async function uploadVisualImage(
  datasetId: string,
  file: File,
): Promise<VisualImage> {
  const formData = new FormData();
  formData.append("file", file);
  const resp = await fetch(`${API_BASE}/api/visual-datasets/${datasetId}/images`, {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "上传图片失败");
  return (await resp.json()) as VisualImage;
}

export async function listVisualImages(datasetId: string): Promise<VisualImage[]> {
  const resp = await fetch(`${API_BASE}/api/visual-datasets/${datasetId}/images`);
  if (!resp.ok) throw new Error("加载图片列表失败");
  return (await resp.json()) as VisualImage[];
}

export async function deleteVisualImage(imageId: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/visual-dataset-images/${imageId}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error("删除图片失败");
}
