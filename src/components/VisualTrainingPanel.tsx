import { useCallback, useEffect, useRef, useState } from "react";
import {
  VisualDataset,
  listVisualDatasets,
} from "../api/visualDatasets";
import {
  VisualTrainingJob,
  VisualTrainingMode,
  cancelVisualTraining,
  getVisualTrainingJob,
  listVisualTrainingJobs,
  startVisualTraining,
} from "../api/visualTraining";
import { createTaskStream } from "../api/tasks";

type Props = {
  characterId: string;
};

const MODE_LABELS: Record<VisualTrainingMode, string> = {
  light:    "轻量（~20 分钟）",
  standard: "标准（~50 分钟）",
  fine:     "精细（需 12GB 显存）",
};

const STATUS_LABELS: Record<string, string> = {
  queued:      "队列中",
  preparing:   "准备中",
  training:    "训练中",
  completed:   "已完成",
  failed:      "失败",
  canceled:    "已取消",
};

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "completed" ? "text-green-400 bg-green-950/40 border-green-800" :
    status === "failed"    ? "text-red-400 bg-red-950/40 border-red-800" :
    status === "canceled"  ? "text-zinc-500 bg-zinc-800 border-zinc-700" :
    "text-indigo-400 bg-indigo-950/40 border-indigo-800";
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
  if (seconds === null) return "";
  if (seconds < 60) return `约 ${seconds}s`;
  return `约 ${Math.ceil(seconds / 60)} 分钟`;
}

function JobCard({
  job,
  onCancel,
}: {
  job: VisualTrainingJob;
  onCancel: (id: string) => void;
}) {
  const isActive = !["completed", "failed", "canceled"].includes(job.status);
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={job.status} />
          <span className="text-xs text-zinc-400">{MODE_LABELS[job.mode] ?? job.mode}</span>
          {job.triggerWord && (
            <span className="text-xs text-zinc-600 font-mono">{job.triggerWord}</span>
          )}
        </div>
        {isActive && (
          <button
            onClick={() => onCancel(job.id)}
            className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
          >
            取消
          </button>
        )}
      </div>

      {isActive && (
        <>
          <ProgressBar value={job.progress} />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{Math.round(job.progress * 100)}%</span>
            {job.etaSeconds !== null && <span>{formatEta(job.etaSeconds)}</span>}
            {job.totalSteps > 0 && (
              <span className="font-mono">{job.currentStep} / {job.totalSteps} steps</span>
            )}
          </div>
        </>
      )}

      {/* Sample preview images */}
      {job.sampleImages.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {job.sampleImages.map((_, i) => (
            <div
              key={i}
              className="w-14 h-14 rounded-lg bg-zinc-700 border border-zinc-600
                         flex items-center justify-center text-zinc-500 text-xs"
            >
              {i + 1}
            </div>
          ))}
        </div>
      )}

      {job.errorMessage && (
        <p className="text-xs text-yellow-500 leading-relaxed">{job.errorMessage}</p>
      )}

      <p className="text-xs text-zinc-600 font-mono truncate">{job.id.slice(0, 8)}…</p>
    </div>
  );
}

export function VisualTrainingPanel({ characterId }: Props) {
  const [datasets, setDatasets] = useState<VisualDataset[]>([]);
  const [jobs, setJobs] = useState<VisualTrainingJob[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<VisualTrainingMode>("standard");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
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

  const loadAll = useCallback(async () => {
    try {
      const [ds, jbs] = await Promise.all([
        listVisualDatasets(characterId),
        listVisualTrainingJobs(characterId),
      ]);
      setDatasets(ds);
      setJobs(jbs);
    } catch {
      setError("加载失败，请刷新重试");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    return () => {
      if (streamNoticeTimerRef.current !== null) {
        clearTimeout(streamNoticeTimerRef.current);
      }
    };
  }, []);

  // Subscribe to task stream for real-time training progress
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  useEffect(() => {
    const teardown = createTaskStream(async (event) => {
      const { task } = event;
      if (!task.name.startsWith("visual-training-")) return;

      const knownIds = new Set(jobsRef.current.map((j) => j.id));
      if (knownIds.has(task.id)) {
        try {
          const full = await getVisualTrainingJob(task.id);
          setJobs((prev) => prev.map((j) => (j.id === full.id ? full : j)));
        } catch (err) {
          showStreamNotice("任务详情刷新失败，状态可能稍有延迟");
          console.error("[VisualTrainingPanel] Failed to refresh job details", {
            step: "refresh_job_detail",
            characterId,
            jobId: task.id,
            taskName: task.name,
            error: err,
          });
        }
      } else if (task.name === `visual-training-${characterId}`) {
        try {
          const all = await listVisualTrainingJobs(characterId);
          setJobs(all);
        } catch (err) {
          showStreamNotice("训练列表刷新失败，稍后会自动重试");
          console.error("[VisualTrainingPanel] Failed to refresh job list", {
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

  const toggleDataset = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleStart = async () => {
    if (selectedIds.size === 0) {
      setError("请先选择至少一个图片数据集");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const job = await startVisualTraining(characterId, {
        datasetIds: Array.from(selectedIds),
        mode,
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
      const updated = await cancelVisualTraining(jobId);
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消失败");
    }
  };

  const activeJob = jobs.find(
    (j) => !["completed", "failed", "canceled"].includes(j.status),
  );

  return (
    <div className="space-y-5">
      {/* Dataset selector */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">选择训练数据集</h3>
        {loading ? (
          <p className="text-zinc-500 text-sm">加载中…</p>
        ) : datasets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-700 py-6 text-center">
            <p className="text-zinc-500 text-sm">还没有图片数据集</p>
            <p className="text-zinc-600 text-xs mt-1">请先在「图片数据集」标签页上传图片</p>
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
                  <span className="text-xs text-zinc-500 shrink-0">{d.imageCount} 张</span>
                  {d.qualityScore !== null && (
                    <span className={`text-xs font-mono shrink-0 ${
                      d.qualityScore >= 0.7 ? "text-green-500" :
                      d.qualityScore >= 0.4 ? "text-yellow-500" : "text-red-500"
                    }`}>
                      {Math.round(d.qualityScore * 100)}%
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Mode selector */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">训练模式</h3>
        <div className="grid grid-cols-3 gap-2">
          {(["light", "standard", "fine"] as VisualTrainingMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={m === "fine"}
              className={`rounded-lg border px-3 py-2 text-xs text-left transition-colors ${
                mode === m
                  ? "border-indigo-500 bg-indigo-950/40 text-indigo-300"
                  : m === "fine"
                  ? "border-zinc-700 bg-zinc-800/30 text-zinc-600 cursor-not-allowed"
                  : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              <span className="font-medium capitalize">{m}</span>
              <br />
              <span className="text-zinc-500 text-[10px]">{MODE_LABELS[m].split("（")[1]?.replace("）", "") ?? ""}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-600">精细模式需要 12GB 显存，当前版本暂不开放</p>
      </div>

      {/* Error */}
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

      {/* Start button */}
      <button
        onClick={handleStart}
        disabled={starting || !!activeJob || selectedIds.size === 0}
        className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                   disabled:opacity-40 disabled:cursor-not-allowed
                   text-sm font-medium text-white transition-colors"
      >
        {starting ? "提交中…" : activeJob ? "训练进行中…" : "开始视觉训练"}
      </button>

      {/* Job history */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">训练记录</h3>
          <div className="space-y-2">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} onCancel={handleCancel} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
