import { useCallback, useEffect, useRef, useState } from "react";
import {
  LLMDataset,
  listLLMDatasets,
} from "../api/llmDatasets";
import {
  LLMTrainingJob,
  LLMTrainingMode,
  cancelLLMTrainingJob,
  getLLMTrainingJob,
  listLLMTrainingJobs,
  startLLMTraining,
} from "../api/llmTraining";
import { createTaskStream } from "../api/tasks";

type Props = {
  characterId: string;
};

const MODE_LABELS: Record<LLMTrainingMode, string> = {
  light:    "轻量（~15 分钟）",
  standard: "标准（~35 分钟）",
  fine:     "精细（~70 分钟）",
};

const STATUS_LABELS: Record<string, string> = {
  queued:      "队列中",
  preparing:   "准备中",
  training:    "训练中",
  exporting:   "导出中",
  registering: "注册中",
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
  const m = Math.ceil(seconds / 60);
  return `约 ${m} 分钟`;
}

function JobCard({
  job,
  onCancel,
}: {
  job: LLMTrainingJob;
  onCancel: (id: string) => void;
}) {
  const isActive = !["completed", "failed", "canceled"].includes(job.status);
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          <span className="text-xs text-zinc-400">{MODE_LABELS[job.mode] ?? job.mode}</span>
          {job.loss !== null && (
            <span className="text-xs text-zinc-500 font-mono">loss {job.loss.toFixed(4)}</span>
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
              <span className="font-mono">
                {job.currentStep} / {job.totalSteps} steps
              </span>
            )}
          </div>
        </>
      )}

      {job.errorMessage && (
        <p className="text-xs text-yellow-500 leading-relaxed">{job.errorMessage}</p>
      )}

      <p className="text-xs text-zinc-600 font-mono truncate">{job.id.slice(0, 8)}…</p>
    </div>
  );
}

export function LLMTrainingPanel({ characterId }: Props) {
  const [datasets, setDatasets] = useState<LLMDataset[]>([]);
  const [jobs, setJobs] = useState<LLMTrainingJob[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<LLMTrainingMode>("standard");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [ds, jbs] = await Promise.all([
        listLLMDatasets(characterId),
        listLLMTrainingJobs(characterId),
      ]);
      setDatasets(ds);
      setJobs(jbs);
    } catch {
      setError("加载失败，请刷新重试");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Subscribe to task stream for real-time training progress
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  useEffect(() => {
    const teardown = createTaskStream(async (event) => {
      const { task } = event;
      if (!task.name.startsWith("llm-training-")) return;

      const knownIds = new Set(jobsRef.current.map((j) => j.id));
      if (knownIds.has(task.id)) {
        // Update known job with fresh details
        try {
          const full = await getLLMTrainingJob(task.id);
          setJobs((prev) => prev.map((j) => (j.id === full.id ? full : j)));
        } catch {
          // silent — stale read is acceptable
        }
      } else if (task.name === `llm-training-${characterId}`) {
        // A new job for this character appeared (e.g. started elsewhere)
        try {
          const all = await listLLMTrainingJobs(characterId);
          setJobs(all);
        } catch {
          // silent
        }
      }
    });
    return teardown;
  }, [characterId]);

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
    setStarting(true);
    setError(null);
    try {
      const job = await startLLMTraining(characterId, {
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
      const updated = await cancelLLMTrainingJob(jobId);
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

      {/* Mode selector */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">训练模式</h3>
        <div className="grid grid-cols-3 gap-2">
          {(["light", "standard", "fine"] as LLMTrainingMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg border px-3 py-2 text-xs text-left transition-colors ${
                mode === m
                  ? "border-indigo-500 bg-indigo-950/40 text-indigo-300"
                  : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              <span className="font-medium capitalize">{m}</span>
              <br />
              <span className="text-zinc-500">{MODE_LABELS[m].split("（")[1]?.replace("）", "") ?? ""}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300">
          {error}
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
        {starting ? "提交中…" : activeJob ? "训练进行中…" : "开始训练"}
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
