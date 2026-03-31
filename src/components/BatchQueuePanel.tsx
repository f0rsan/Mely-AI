import { useEffect, useRef, useState } from "react";

import { type BatchGenerationRequest, type BatchJobItem, submitBatchGeneration } from "../api/batch";
import { type TaskEvent, createTaskStream } from "../api/tasks";

type BatchParams = Omit<BatchGenerationRequest, "characterId" | "costumeId" | "scenePrompts">;

type Props = {
  characterId: string;
  costumeId: string;
  params: BatchParams;
  disabled?: boolean;
};

type JobState = BatchJobItem & {
  // enriched from WS
};

type BatchState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "running"; batchId: string; jobs: JobState[] }
  | { kind: "done"; jobs: JobState[] }
  | { kind: "error"; message: string };

export function BatchQueuePanel({ characterId, costumeId, params, disabled }: Props) {
  const [rawInput, setRawInput] = useState("");
  const [batchState, setBatchState] = useState<BatchState>({ kind: "idle" });
  const destroyStreamRef = useRef<(() => void) | null>(null);

  // Clean up WS stream on unmount.
  useEffect(() => {
    return () => {
      destroyStreamRef.current?.();
    };
  }, []);

  // Subscribe to task updates when a batch is running.
  useEffect(() => {
    if (batchState.kind !== "running") return;

    const taskIds = new Set(batchState.jobs.map((j) => j.taskId));

    const destroy = createTaskStream((event: TaskEvent) => {
      if (!taskIds.has(event.task.id)) return;

      setBatchState((prev) => {
        if (prev.kind !== "running") return prev;

        const updatedJobs = prev.jobs.map((job) =>
          job.taskId === event.task.id
            ? {
                ...job,
                status: event.task.status,
                progress: event.task.progress,
                message: event.task.message ?? null,
                error: event.task.error ?? null,
                updatedAt: event.task.updatedAt,
              }
            : job,
        );

        const allDone = updatedJobs.every(
          (j) => j.status === "completed" || j.status === "failed",
        );

        if (allDone) {
          destroy();
          return { kind: "done", jobs: updatedJobs };
        }

        return { ...prev, jobs: updatedJobs };
      });
    });

    destroyStreamRef.current = destroy;
    return () => {
      destroy();
      destroyStreamRef.current = null;
    };
  }, [batchState.kind === "running" ? batchState.batchId : null]);

  const scenePrompts = rawInput
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  async function handleSubmit() {
    if (scenePrompts.length === 0) return;

    setBatchState({ kind: "submitting" });

    try {
      const result = await submitBatchGeneration({
        characterId,
        costumeId,
        scenePrompts,
        ...params,
      });

      setBatchState({
        kind: "running",
        batchId: result.batchId,
        jobs: result.jobs,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "批量生成提交失败，请稍后重试。";
      setBatchState({ kind: "error", message });
    }
  }

  function handleReset() {
    destroyStreamRef.current?.();
    destroyStreamRef.current = null;
    setBatchState({ kind: "idle" });
    setRawInput("");
  }

  const isIdle = batchState.kind === "idle" || batchState.kind === "error";
  const isSubmitting = batchState.kind === "submitting";
  const jobs =
    batchState.kind === "running" || batchState.kind === "done" ? batchState.jobs : [];

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-semibold text-sm text-gray-700">批量生成队列</h3>

      {isIdle && (
        <div className="flex flex-col gap-3">
          <textarea
            className="w-full border border-gray-300 rounded-md p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            rows={6}
            placeholder={"每行输入一个场景描述，例如：\n在咖啡馆\n在海边看日落\n图书馆读书"}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            disabled={disabled}
          />

          {batchState.kind === "error" && (
            <p role="alert" className="text-sm text-red-600">
              {batchState.message}
            </p>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {scenePrompts.length > 0
                ? `${scenePrompts.length} 个场景已输入`
                : "请输入场景描述"}
            </span>
            <button
              className="ml-auto px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={disabled || scenePrompts.length === 0 || scenePrompts.length > 20}
              onClick={handleSubmit}
            >
              提交批量生成
            </button>
          </div>
        </div>
      )}

      {isSubmitting && (
        <p className="text-sm text-gray-500">正在提交批量任务…</p>
      )}

      {jobs.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-500">
            {batchState.kind === "done" ? "全部完成" : "批量生成进行中…"}
            {" · "}
            {jobs.filter((j) => j.status === "completed").length}/{jobs.length} 完成
          </p>

          <ul className="flex flex-col gap-1.5" aria-label="批量任务队列">
            {jobs.map((job) => (
              <li key={job.taskId} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate max-w-[60%] text-gray-700">{job.scenePrompt}</span>
                  <JobStatusBadge status={job.status} />
                </div>

                {(job.status === "running" || job.status === "pending") && (
                  <div
                    role="progressbar"
                    aria-valuenow={job.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="w-full h-1 bg-gray-200 rounded-full overflow-hidden"
                  >
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                )}

                {job.status === "failed" && job.error && (
                  <p className="text-xs text-red-500">{job.error}</p>
                )}
              </li>
            ))}
          </ul>

          {batchState.kind === "done" && (
            <button
              className="mt-2 px-3 py-1 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
              onClick={handleReset}
            >
              重新开始
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function JobStatusBadge({ status }: { status: BatchJobItem["status"] }) {
  const labelMap: Record<BatchJobItem["status"], string> = {
    pending: "等待中",
    running: "生成中",
    completed: "已完成",
    failed: "失败",
  };
  const colorMap: Record<BatchJobItem["status"], string> = {
    pending: "text-gray-400",
    running: "text-indigo-600",
    completed: "text-green-600",
    failed: "text-red-500",
  };
  return <span className={`font-medium ${colorMap[status]}`}>{labelMap[status]}</span>;
}
