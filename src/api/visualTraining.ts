const API_BASE = "http://127.0.0.1:8000";

export type VisualTrainingMode = "light" | "standard" | "fine";

export type VisualTrainingJob = {
  id: string;
  characterId: string;
  datasetIds: string[];
  mode: VisualTrainingMode;
  baseCheckpoint: string;
  triggerWord: string;
  status: string;
  progress: number;
  currentStep: number;
  totalSteps: number;
  etaSeconds: number | null;
  loraPath: string | null;
  sampleImages: string[];
  errorMessage: string | null;
  queueTaskId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export async function startVisualTraining(
  characterId: string,
  payload: {
    datasetIds: string[];
    mode: VisualTrainingMode;
    triggerWord?: string;
  },
): Promise<VisualTrainingJob> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${characterId}/visual-training/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "启动训练失败");
  return (await resp.json()) as VisualTrainingJob;
}

export async function cancelVisualTraining(jobId: string): Promise<VisualTrainingJob> {
  const resp = await fetch(`${API_BASE}/api/visual-training/${jobId}/cancel`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "取消失败");
  return (await resp.json()) as VisualTrainingJob;
}

export async function getVisualTrainingJob(jobId: string): Promise<VisualTrainingJob> {
  const resp = await fetch(`${API_BASE}/api/visual-training/${jobId}`);
  if (!resp.ok) throw new Error("加载训练任务失败");
  return (await resp.json()) as VisualTrainingJob;
}

export async function listVisualTrainingJobs(characterId: string): Promise<VisualTrainingJob[]> {
  const resp = await fetch(
    `${API_BASE}/api/visual-training?characterId=${encodeURIComponent(characterId)}`,
  );
  if (!resp.ok) throw new Error("加载训练记录失败");
  return (await resp.json()) as VisualTrainingJob[];
}
