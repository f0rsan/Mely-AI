import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LLMDataset, listLLMDatasets } from "../api/llmDatasets";
import { pullLLMModel, type LLMPullEvent } from "../api/llmPull";
import {
  fetchLLMRuntimeReadiness,
  openLLMRuntime,
  repairLLMRuntime,
  type LLMRuntimeReadiness,
} from "../api/llmRuntime";
import {
  LLMTrainingJob,
  LLMTrainingMode,
  cancelLLMTrainingJob,
  getLLMTrainingJob,
  listLLMTrainingJobs,
  openLLMTrainingRunRoot,
  startLLMTraining,
} from "../api/llmTraining";
import { createTaskStream } from "../api/tasks";

type Props = {
  characterId: string;
};

const MODE_LABELS: Record<LLMTrainingMode, string> = {
  light: "轻量（~15 分钟）",
  standard: "标准（~35 分钟）",
  fine: "精细（~70 分钟）",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "队列中",
  preparing: "准备中",
  training: "训练中",
  exporting: "导出中",
  registering: "注册中",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
};

type TrainingBaseModelOption = {
  modelName: string;
  label: string;
  helperText: string;
};

const DEFAULT_TRAINING_BASE_MODEL_NAME = "qwen2.5:3b";
const TRAINING_COMPATIBLE_BASE_MODELS: TrainingBaseModelOption[] = [
  {
    modelName: DEFAULT_TRAINING_BASE_MODEL_NAME,
    label: "默认训练模型（Qwen2.5 3B）",
    helperText: "显存压力更低，适合作为默认角色微调基模",
  },
  {
    modelName: "qwen2.5:7b-instruct-q4_K_M",
    label: "增强训练模型（Qwen2.5 7B）",
    helperText: "表达能力更强，但训练更重，适合手动切换使用",
  },
];
const TRAINING_DEFAULT_BASE_MODEL =
  (TRAINING_COMPATIBLE_BASE_MODELS.find((item) => item.modelName === DEFAULT_TRAINING_BASE_MODEL_NAME) ??
    TRAINING_COMPATIBLE_BASE_MODELS[0])?.modelName ?? DEFAULT_TRAINING_BASE_MODEL_NAME;

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "text-green-400 bg-green-950/40 border-green-800"
      : status === "failed"
        ? "text-red-400 bg-red-950/40 border-red-800"
        : status === "canceled"
          ? "text-zinc-500 bg-zinc-800 border-zinc-700"
          : "text-indigo-400 bg-indigo-950/40 border-indigo-800";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${color}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
      <div
        className="h-full bg-indigo-500 rounded-full transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatEta(seconds: number | null): string {
  if (seconds === null) return "--";
  if (seconds < 60) return `约 ${seconds}s`;
  const m = Math.ceil(seconds / 60);
  return `约 ${m} 分钟`;
}

function resolveStageName(job: LLMTrainingJob): string {
  return job.stageName ?? STATUS_LABELS[job.status] ?? job.status;
}

function isRegistrationRetryHint(message: string | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    (message.includes("注册") && (message.includes("重试") || message.includes("稍后"))) ||
    normalized.includes("registration pending") ||
    normalized.includes("pending")
  );
}

function resolveReadinessTitle(
  readiness: LLMRuntimeReadiness | null,
  runtimeLoading: boolean,
  isPullingModel: boolean,
  pullingModelName: string,
): string {
  if (isPullingModel) return `正在拉取 ${pullingModelName}`;
  if (runtimeLoading && readiness === null) return "正在检测训练环境";
  if (readiness === null) return "训练环境状态暂不可用";
  if (readiness.state === "installing_runtime") {
    if (readiness.installProgress.stage === "snapshot") {
      return "正在准备训练基础模型";
    }
    return "正在安装训练运行时";
  }
  switch (readiness.state) {
    case "missing_runtime":
      return "训练运行时未安装";
    case "missing_ollama":
      return "Ollama 未安装或未启动";
    case "missing_inference_model":
      return "基础模型尚未下载";
    case "preparing_training_base_snapshot":
      return "正在准备训练基础模型";
    case "missing_training_base_snapshot":
      return "训练基础模型缺失，需要修复";
    case "runtime_broken":
      return "训练环境异常，需要修复";
    case "ready":
      return "已就绪，可开始训练";
    case "unsupported":
      return "当前设备暂不支持当前训练设置";
    default:
      return "训练环境状态暂不可用";
  }
}

function resolveReadinessTone(readiness: LLMRuntimeReadiness | null): string {
  if (readiness?.ready) {
    return "border-green-800/60 bg-green-950/30 text-green-200";
  }
  if (readiness?.state === "runtime_broken" || readiness?.state === "unsupported") {
    return "border-red-800/70 bg-red-950/30 text-red-200";
  }
  return "border-amber-800/70 bg-amber-950/30 text-amber-200";
}

function formatReadinessDetail(
  readiness: LLMRuntimeReadiness | null,
  pullProgress: LLMPullEvent | null,
  isPullingModel: boolean,
): string {
  if (isPullingModel) {
    if (typeof pullProgress?.percent === "number") {
      return `基础模型下载中，已完成 ${Math.round(pullProgress.percent)}%。`;
    }
    if (pullProgress?.phase) {
      return `基础模型下载中：${pullProgress.phase}。`;
    }
    return "基础模型下载中，请保持网络连接。";
  }

  if (readiness === null) {
    return "正在获取训练环境状态，请稍候。";
  }

  if (
    readiness.state === "installing_runtime" ||
    readiness.state === "preparing_training_base_snapshot"
  ) {
    const percent = Math.round(readiness.installProgress.percent);
    const progressText = Number.isFinite(percent) ? `（${percent}%）` : "";
    return `${readiness.installProgress.message}${progressText}`;
  }

  return readiness.blockingReason ?? readiness.message;
}

function JobCard({
  job,
  onCancel,
  onOpenRunRoot,
}: {
  job: LLMTrainingJob;
  onCancel: (id: string) => void;
  onOpenRunRoot: (id: string) => void;
}) {
  const isActive = !["completed", "failed", "canceled"].includes(job.status);
  const registrationRetryHint = isRegistrationRetryHint(job.errorMessage);
  const stageName = resolveStageName(job);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          <span className="text-xs text-zinc-400">{MODE_LABELS[job.mode] ?? job.mode}</span>
        </div>
        <div className="flex items-center gap-3">
          {job.runRoot && (
            <button
              onClick={() => onOpenRunRoot(job.id)}
              className="text-xs text-zinc-400 hover:text-indigo-300 transition-colors"
            >
              打开运行目录
            </button>
          )}
          {isActive && (
            <button
              onClick={() => onCancel(job.id)}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              取消
            </button>
          )}
        </div>
      </div>

      {isActive && <ProgressBar value={job.progress} />}
      <div className="text-xs text-zinc-500 grid grid-cols-2 gap-y-1.5 gap-x-3">
        <div className="flex items-center justify-between gap-2">
          <span>当前 step</span>
          <span className="font-mono text-zinc-300">{job.currentStep}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>总步数</span>
          <span className="font-mono text-zinc-300">{job.totalSteps > 0 ? job.totalSteps : "--"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>loss</span>
          <span className="font-mono text-zinc-300">
            {job.loss !== null ? job.loss.toFixed(4) : "--"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>ETA</span>
          <span className="font-mono text-zinc-300">{formatEta(job.etaSeconds)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>当前阶段</span>
          <span className="text-zinc-300 text-right">{stageName}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>进度</span>
          <span className="font-mono text-zinc-300">{Math.round(job.progress * 100)}%</span>
        </div>
        <div className="col-span-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span>最近 checkpoint</span>
            <span className="font-mono text-zinc-300 text-right">
              {job.checkpointPath ? "已生成" : "--"}
            </span>
          </div>
          <p
            className="rounded border border-zinc-700/70 bg-zinc-900/40 px-2 py-1 font-mono text-[11px] text-zinc-400 break-all"
            title={job.checkpointPath ?? ""}
          >
            {job.checkpointPath ?? "--"}
          </p>
        </div>
        {job.runRoot && (
          <div className="col-span-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span>运行目录</span>
              <span className="font-mono text-zinc-300 text-right">可打开</span>
            </div>
            <p
              className="rounded border border-zinc-700/70 bg-zinc-900/40 px-2 py-1 font-mono text-[11px] text-zinc-400 break-all"
              title={job.runRoot}
            >
              {job.runRoot}
            </p>
          </div>
        )}
      </div>

      {job.errorMessage && (
        <div
          className={`rounded-md border px-2 py-2 text-xs leading-relaxed space-y-1 ${
            registrationRetryHint
              ? "border-amber-800 bg-amber-950/30 text-amber-200"
              : job.status === "failed"
                ? "border-red-800 bg-red-950/30 text-red-200"
                : "border-zinc-700 bg-zinc-900/40 text-zinc-300"
          }`}
        >
          <p className="font-medium">{registrationRetryHint ? "模型注册待重试" : "系统提示"}</p>
          <p>{job.errorMessage}</p>
        </div>
      )}
    </div>
  );
}

export function LLMTrainingPanel({ characterId }: Props) {
  const [datasets, setDatasets] = useState<LLMDataset[]>([]);
  const [jobs, setJobs] = useState<LLMTrainingJob[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<LLMTrainingMode>("standard");
  const [selectedBaseModel, setSelectedBaseModel] = useState<string>(TRAINING_DEFAULT_BASE_MODEL);
  const [loading, setLoading] = useState(true);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [runtimeReadiness, setRuntimeReadiness] = useState<LLMRuntimeReadiness | null>(null);
  const [runtimeActionLoading, setRuntimeActionLoading] = useState<
    "repair" | "open_ollama" | "pull_model" | null
  >(null);
  const [pullProgress, setPullProgress] = useState<LLMPullEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const streamNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStreamNotice = useCallback((message: string) => {
    setStreamNotice(message);
    if (streamNoticeTimerRef.current !== null) {
      clearTimeout(streamNoticeTimerRef.current);
    }
    streamNoticeTimerRef.current = setTimeout(() => {
      setStreamNotice(null);
      streamNoticeTimerRef.current = null;
    }, 4000);
  }, []);

  const loadTrainingData = useCallback(async () => {
    try {
      const [ds, jbs] = await Promise.all([listLLMDatasets(characterId), listLLMTrainingJobs(characterId)]);
      setDatasets(ds);
      setJobs(jbs);
    } catch {
      setError("加载失败，请刷新重试");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  const loadReadiness = useCallback(
    async (options?: { silent?: boolean; autoFix?: boolean; mode?: LLMTrainingMode }) => {
      if (!options?.silent) {
        setRuntimeLoading(true);
      }
      try {
        const readiness = await fetchLLMRuntimeReadiness({
          mode: options?.mode ?? mode,
          baseModel: selectedBaseModel,
          autoFix: options?.autoFix ?? !options?.silent,
        });
        setRuntimeReadiness(readiness);
        return readiness;
      } catch (err) {
        if (!options?.silent) {
          setError(err instanceof Error ? err.message : "训练环境状态检测失败，请稍后重试");
        }
        return null;
      } finally {
        if (!options?.silent) {
          setRuntimeLoading(false);
        }
      }
    },
    [mode, selectedBaseModel],
  );

  useEffect(() => {
    void loadTrainingData();
  }, [loadTrainingData]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadReadiness({ silent: true });
    }, 8000);
    return () => clearInterval(timer);
  }, [loadReadiness]);

  useEffect(() => {
    return () => {
      if (streamNoticeTimerRef.current !== null) {
        clearTimeout(streamNoticeTimerRef.current);
      }
    };
  }, []);

  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    const teardown = createTaskStream(async (event) => {
      const { task } = event;
      if (!task.name.startsWith("llm-training-")) return;

      const knownIds = new Set(jobsRef.current.map((j) => j.id));
      if (knownIds.has(task.id)) {
        try {
          const full = await getLLMTrainingJob(task.id);
          setJobs((prev) => prev.map((j) => (j.id === full.id ? full : j)));
        } catch (err) {
          showStreamNotice("任务详情刷新失败，状态可能稍有延迟");
          console.error("[LLMTrainingPanel] Failed to refresh job details", {
            step: "refresh_job_detail",
            characterId,
            jobId: task.id,
            taskName: task.name,
            error: err,
          });
        }
      } else if (task.name === `llm-training-${characterId}`) {
        try {
          const all = await listLLMTrainingJobs(characterId);
          setJobs(all);
        } catch (err) {
          showStreamNotice("训练列表刷新失败，稍后会自动重试");
          console.error("[LLMTrainingPanel] Failed to refresh job list", {
            step: "refresh_job_list",
            characterId,
            taskId: task.id,
            taskName: task.name,
            error: err,
          });
        }
      }
    });
    return teardown;
  }, [characterId, showStreamNotice]);

  const activeJob = useMemo(
    () => jobs.find((j) => !["completed", "failed", "canceled"].includes(j.status)),
    [jobs],
  );

  const runRootJobId = useMemo(() => {
    if (activeJob?.runRoot) return activeJob.id;
    const historyJob = jobs.find((job) => job.runRoot);
    return historyJob?.id ?? null;
  }, [activeJob, jobs]);

  const supportedModes = runtimeReadiness?.hardware?.supportedModes;
  useEffect(() => {
    if (!supportedModes || supportedModes.length === 0) {
      return;
    }
    if (!supportedModes.includes(mode)) {
      if (supportedModes.includes("standard")) {
        setMode("standard");
      } else {
        setMode(supportedModes[0]);
      }
    }
  }, [mode, supportedModes]);

  const fineModeDisabledReason = useMemo(() => {
    if (!runtimeReadiness?.hardware) return null;
    if (runtimeReadiness.state === "unsupported") return null;
    if (runtimeReadiness.hardware.supportedModes.includes("fine")) return null;
    return (
      `当前设备显存为 ${runtimeReadiness.hardware.vramGB.toFixed(1)}GB，` +
      "精细模式至少需要 12GB。"
    );
  }, [runtimeReadiness]);

  const toggleDataset = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleStart = async () => {
    if (selectedIds.size === 0) {
      setError("请先选择至少一个数据集");
      return;
    }

    const latestReadiness = await loadReadiness({ mode });
    if (latestReadiness === null) {
      setError("训练环境检测失败，请稍后重试");
      return;
    }
    if (!latestReadiness.ready) {
      setError(latestReadiness.blockingReason ?? "训练环境未就绪，请先完成准备步骤");
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const job = await startLLMTraining(characterId, {
        datasetIds: Array.from(selectedIds),
        mode,
        baseModel: selectedBaseModel,
      });
      setJobs((prev) => [job, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动训练失败，请重试");
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      const updated = await cancelLLMTrainingJob(jobId);
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消失败");
    }
  };

  const handleOpenRunRoot = async (jobId: string) => {
    try {
      await openLLMTrainingRunRoot(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开运行目录失败");
    }
  };

  const handleRepairRuntime = async () => {
    setRuntimeActionLoading("repair");
    setError(null);
    try {
      const readiness = await repairLLMRuntime();
      setRuntimeReadiness(readiness);
    } catch (err) {
      setError(err instanceof Error ? err.message : "修复训练环境失败，请稍后重试");
    } finally {
      setRuntimeActionLoading(null);
      void loadReadiness({ silent: true });
    }
  };

  const handleOpenOllama = async () => {
    setRuntimeActionLoading("open_ollama");
    setError(null);
    try {
      await openLLMRuntime();
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动语言引擎失败，请稍后重试");
    } finally {
      setRuntimeActionLoading(null);
      void loadReadiness({ silent: true });
    }
  };

  const handleDownloadBaseModel = async () => {
    setRuntimeActionLoading("pull_model");
    setPullProgress({
      status: "running",
      phase: "正在准备下载",
      percent: 0,
    });
    setError(null);
    try {
      await pullLLMModel(selectedBaseModel, (event) => {
        setPullProgress(event);
      });
      setPullProgress({
        status: "done",
        phase: "下载完成",
        percent: 100,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载基础模型失败，请稍后重试");
    } finally {
      setRuntimeActionLoading(null);
      await loadReadiness({ silent: true });
    }
  };

  const readinessTitle = resolveReadinessTitle(
    runtimeReadiness,
    runtimeLoading,
    runtimeActionLoading === "pull_model",
    selectedBaseModel,
  );
  const readinessDetail = formatReadinessDetail(
    runtimeReadiness,
    pullProgress,
    runtimeActionLoading === "pull_model",
  );
  const readinessTone = resolveReadinessTone(runtimeReadiness);

  const canInstallRuntime = runtimeReadiness?.state === "missing_runtime";
  const canRepairRuntime =
    runtimeReadiness?.state === "runtime_broken" ||
    runtimeReadiness?.state === "missing_training_base_snapshot";
  const canOpenOllama = runtimeReadiness?.state === "missing_ollama";
  const canDownloadBaseModel =
    runtimeReadiness?.state === "missing_inference_model" || runtimeActionLoading === "pull_model";

  return (
    <div className="space-y-5">
      <div className={`rounded-lg border px-3 py-3 space-y-2 ${readinessTone}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-wide uppercase text-zinc-200">训练环境状态</p>
            <p className="text-sm font-medium">{readinessTitle}</p>
          </div>
          {runtimeLoading && (
            <span className="text-xs text-zinc-300">检测中…</span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-zinc-300">{readinessDetail}</p>
        {fineModeDisabledReason && (
          <p className="text-xs text-amber-200">{fineModeDisabledReason}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canInstallRuntime && (
            <button
              type="button"
              onClick={() => void handleRepairRuntime()}
              disabled={runtimeActionLoading !== null}
              className="text-xs px-2.5 py-1 rounded border border-indigo-700 bg-indigo-950/50 text-indigo-300 hover:text-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {runtimeActionLoading === "repair" ? "处理中…" : "安装训练环境"}
            </button>
          )}
          {canRepairRuntime && (
            <button
              type="button"
              onClick={() => void handleRepairRuntime()}
              disabled={runtimeActionLoading !== null}
              className="text-xs px-2.5 py-1 rounded border border-indigo-700 bg-indigo-950/50 text-indigo-300 hover:text-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {runtimeActionLoading === "repair" ? "处理中…" : "修复训练环境"}
            </button>
          )}
          {canOpenOllama && (
            <button
              type="button"
              onClick={() => void handleOpenOllama()}
              disabled={runtimeActionLoading !== null}
              className="text-xs px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {runtimeActionLoading === "open_ollama" ? "处理中…" : "安装/启动 Ollama"}
            </button>
          )}
          {canDownloadBaseModel && (
            <button
              type="button"
              onClick={() => void handleDownloadBaseModel()}
              disabled={runtimeActionLoading !== null}
              className="text-xs px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {runtimeActionLoading === "pull_model" ? "下载中…" : "下载基础模型"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (runRootJobId) {
                void handleOpenRunRoot(runRootJobId);
              }
            }}
            disabled={!runRootJobId}
            className="text-xs px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            打开运行目录
          </button>
          <button
            type="button"
            onClick={() => void loadReadiness()}
            className="text-xs px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100"
          >
            重新检测
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">选择训练数据集</h3>
        {loading ? (
          <p className="text-zinc-500 text-sm">加载中…</p>
        ) : datasets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-700 py-6 text-center">
            <p className="text-zinc-500 text-sm">还没有数据集</p>
            <p className="text-zinc-600 text-xs mt-1">请先在「数据集」标签页上传文件</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {datasets.map((d) => (
              <li key={d.id}>
                <label className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-2 cursor-pointer hover:border-indigo-600 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(d.id)}
                    onChange={() => toggleDataset(d.id)}
                    className="accent-indigo-500 w-4 h-4 shrink-0"
                  />
                  <span className="text-sm text-zinc-200 flex-1 truncate">{d.name}</span>
                  <span className="text-xs text-zinc-500 shrink-0">{d.itemCount} 条</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="llm-training-base-model"
          className="text-xs font-medium text-zinc-400 uppercase tracking-wide block"
        >
          基础模型
        </label>
        <select
          id="llm-training-base-model"
          value={selectedBaseModel}
          onChange={(event) => setSelectedBaseModel(event.target.value)}
          disabled={starting || !!activeJob}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 text-sm px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {TRAINING_COMPATIBLE_BASE_MODELS.map((item) => (
            <option key={item.modelName} value={item.modelName}>
              {item.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">
          {
            TRAINING_COMPATIBLE_BASE_MODELS.find((item) => item.modelName === selectedBaseModel)
              ?.helperText
          }
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">训练模式</h3>
        <div className="grid grid-cols-3 gap-2">
          {(["light", "standard", "fine"] as LLMTrainingMode[]).map((m) => {
            const modeDisabled = supportedModes ? !supportedModes.includes(m) : false;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                disabled={modeDisabled || starting || !!activeJob}
                className={`rounded-lg border px-3 py-2 text-xs text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  mode === m
                    ? "border-indigo-500 bg-indigo-950/40 text-indigo-300"
                    : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                <span className="font-medium capitalize">{m}</span>
                <br />
                <span className="text-zinc-500">
                  {MODE_LABELS[m].split("（")[1]?.replace("）", "") ?? ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {streamNotice && (
        <div
          className="rounded-lg bg-amber-950/40 border border-amber-900 px-3 py-2 text-xs text-amber-200"
          role="status"
          aria-live="polite"
        >
          {streamNotice}
        </div>
      )}

      <button
        onClick={() => void handleStart()}
        disabled={
          starting ||
          !!activeJob ||
          selectedIds.size === 0 ||
          runtimeLoading ||
          !runtimeReadiness?.ready
        }
        className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                   disabled:opacity-40 disabled:cursor-not-allowed
                   text-sm font-medium text-white transition-colors"
      >
        {starting
          ? "提交中…"
          : runtimeLoading
            ? "检测训练环境中…"
            : activeJob
              ? "训练进行中…"
              : runtimeReadiness?.ready
                ? "开始训练"
                : "训练环境未就绪"}
      </button>

      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">训练记录</h3>
          <div className="space-y-2">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onCancel={handleCancel}
                onOpenRunRoot={handleOpenRunRoot}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
