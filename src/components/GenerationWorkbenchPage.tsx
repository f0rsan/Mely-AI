import { useCallback, useEffect, useRef, useState } from "react";

import {
  createMockGenerationJob,
  fetchGenerationWorkbenchContract,
  mergeTaskIntoGenerationJob,
  type GenerationMockJob,
  type GenerationWorkbenchContract,
} from "../api/generations";
import { createTaskStream, type TaskConnectionState } from "../api/tasks";
import { EngineStatusBadge } from "./EngineStatusBadge";
import { PromptAssemblyPanel } from "./PromptAssemblyPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Params = {
  width: number;
  height: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  seed: number | null;
  loraWeight: number;
  tags: string[];
};

type WorkbenchState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; contract: GenerationWorkbenchContract };

type GenerateState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "running"; job: GenerationMockJob }
  | { kind: "done"; job: GenerationMockJob }
  | { kind: "failed"; job: GenerationMockJob; message: string };

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CostumeSelector({
  costumes,
  selectedId,
  onChange,
}: {
  costumes: GenerationWorkbenchContract["costumes"];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {costumes.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={`px-3 py-1 rounded text-sm border ${
            c.id === selectedId
              ? "bg-blue-600 border-blue-500 text-white"
              : "bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400"
          }`}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function ParamsPanel({
  params,
  onChange,
}: {
  params: Params;
  onChange: (p: Partial<Params>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded bg-gray-800 border border-gray-700">
      <button
        type="button"
        className="w-full flex justify-between items-center px-3 py-2 text-sm text-gray-300"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>参数设置</span>
        <span className="text-gray-500">{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-gray-400 text-xs">宽度</span>
            <input
              type="number"
              className="rounded bg-gray-900 border border-gray-600 px-2 py-1 text-white"
              value={params.width}
              min={64}
              max={4096}
              step={64}
              onChange={(e) => onChange({ width: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400 text-xs">高度</span>
            <input
              type="number"
              className="rounded bg-gray-900 border border-gray-600 px-2 py-1 text-white"
              value={params.height}
              min={64}
              max={4096}
              step={64}
              onChange={(e) => onChange({ height: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400 text-xs">步数</span>
            <input
              type="number"
              className="rounded bg-gray-900 border border-gray-600 px-2 py-1 text-white"
              value={params.steps}
              min={1}
              max={150}
              onChange={(e) => onChange({ steps: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400 text-xs">CFG Scale</span>
            <input
              type="number"
              className="rounded bg-gray-900 border border-gray-600 px-2 py-1 text-white"
              value={params.cfgScale}
              min={0}
              max={30}
              step={0.5}
              onChange={(e) => onChange({ cfgScale: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400 text-xs">Seed（空 = 随机）</span>
            <input
              type="number"
              className="rounded bg-gray-900 border border-gray-600 px-2 py-1 text-white"
              value={params.seed ?? ""}
              placeholder="随机"
              onChange={(e) =>
                onChange({ seed: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400 text-xs">LoRA 权重</span>
            <input
              type="number"
              className="rounded bg-gray-900 border border-gray-600 px-2 py-1 text-white"
              value={params.loraWeight}
              min={0}
              max={2}
              step={0.05}
              onChange={(e) => onChange({ loraWeight: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-gray-400 text-xs">采样器</span>
            <select
              className="rounded bg-gray-900 border border-gray-600 px-2 py-1 text-white"
              value={params.sampler}
              onChange={(e) => onChange({ sampler: e.target.value })}
            >
              {["DPM++ 2M Karras", "Euler a", "DDIM", "LMS"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-gray-700 rounded h-2">
      <div
        className="bg-blue-500 h-2 rounded transition-all"
        style={{ width: `${progress}%` }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GenerationWorkbenchPage({
  characterId,
  characterName,
}: {
  characterId: string;
  characterName: string;
}) {
  const [workbench, setWorkbench] = useState<WorkbenchState>({ kind: "loading" });
  const [selectedCostumeId, setSelectedCostumeId] = useState<string>("");
  const [assembledPrompt, setAssembledPrompt] = useState<string>("");
  const [promptReady, setPromptReady] = useState(false);
  const [params, setParams] = useState<Params>({
    width: 1024,
    height: 1024,
    steps: 28,
    sampler: "DPM++ 2M Karras",
    cfgScale: 3.5,
    seed: null,
    loraWeight: 0.85,
    tags: [],
  });
  const [generateState, setGenerateState] = useState<GenerateState>({ kind: "idle" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [taskConnection, setTaskConnection] = useState<TaskConnectionState>("disconnected");
  const wsDisconnectRef = useRef<(() => void) | null>(null);

  // Load workbench contract.
  useEffect(() => {
    const abort = new AbortController();
    setWorkbench({ kind: "loading" });

    fetchGenerationWorkbenchContract(characterId, abort.signal)
      .then((contract) => {
        setWorkbench({ kind: "ready", contract });
        setSelectedCostumeId(contract.selectedCostumeId);
        setParams((p) => ({
          ...p,
          ...contract.parameterDefaults,
          tags: [],
        }));
      })
      .catch((err: Error) => {
        if (err.message === "AbortError") return;
        setWorkbench({
          kind: "error",
          message:
            err.message === "GENERATION_CONTRACT_UNAVAILABLE"
              ? "生成工作台加载失败，请稍后重试。"
              : err.message,
        });
      });

    return () => abort.abort();
  }, [characterId]);

  // Connect to task stream.
  useEffect(() => {
    wsDisconnectRef.current = createTaskStream((event) => {
      setGenerateState((prev) => {
        if (prev.kind !== "running" && prev.kind !== "done" && prev.kind !== "failed") {
          return prev;
        }
        const job = prev.kind === "running" ? prev.job : prev.job;
        if (event.task.id !== job.taskId) return prev;

        const updated = mergeTaskIntoGenerationJob(job, event.task);
        if (updated.status === "completed") return { kind: "done", job: updated };
        if (updated.status === "failed")
          return {
            kind: "failed",
            job: updated,
            message: updated.error ?? "生成任务失败，请稍后重试。",
          };
        return { kind: "running", job: updated };
      });
    }, setTaskConnection);

    return () => {
      wsDisconnectRef.current?.();
    };
  }, []);

  const handlePromptConfirm = useCallback((prompt: string) => {
    setAssembledPrompt(prompt);
    setPromptReady(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (workbench.kind !== "ready") return;
    setSubmitError(null);
    setGenerateState({ kind: "submitting" });

    try {
      const job = await createMockGenerationJob({
        characterId,
        costumeId: selectedCostumeId,
        scenePrompt: assembledPrompt || "（未输入场景描述）",
        negativePrompt: "",
        width: params.width,
        height: params.height,
        steps: params.steps,
        sampler: params.sampler,
        cfgScale: params.cfgScale,
        seed: params.seed,
        loraWeight: params.loraWeight,
        tags: params.tags,
      });
      setGenerateState({ kind: "running", job });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "生成任务提交失败，请稍后重试。";
      setSubmitError(msg);
      setGenerateState({ kind: "idle" });
    }
  }, [workbench, characterId, selectedCostumeId, assembledPrompt, params]);

  const handleGenerateAnother = useCallback(() => {
    setParams((p) => ({ ...p, seed: randomSeed() }));
    setGenerateState({ kind: "idle" });
    setSubmitError(null);
  }, []);

  // Compute the costume prompt for PromptAssemblyPanel based on selected costume.
  const selectedCostume =
    workbench.kind === "ready"
      ? workbench.contract.costumes.find((c) => c.id === selectedCostumeId)
      : undefined;

  const canSubmit =
    workbench.kind === "ready" &&
    workbench.contract.canGenerate &&
    promptReady &&
    generateState.kind === "idle";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (workbench.kind === "loading") {
    return (
      <div className="text-sm text-gray-400 p-4" role="status" aria-live="polite">
        正在加载生成工作台…
      </div>
    );
  }

  if (workbench.kind === "error") {
    return (
      <div className="text-sm text-red-400 p-4" role="alert">
        {workbench.message}
      </div>
    );
  }

  const { contract } = workbench;

  return (
    <div className="flex flex-col gap-4">
      {/* Engine status */}
      <EngineStatusBadge pollIntervalMs={8000} />

      {/* Blocking state */}
      {!contract.canGenerate && contract.blockingReason && (
        <div
          className="rounded bg-yellow-900/30 border border-yellow-700 px-3 py-2 text-sm text-yellow-300"
          role="alert"
        >
          {contract.blockingReason}
        </div>
      )}

      {/* Costume selector */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-gray-400">造型选择</span>
        <CostumeSelector
          costumes={contract.costumes}
          selectedId={selectedCostumeId}
          onChange={setSelectedCostumeId}
        />
      </div>

      {/* Prompt assembly */}
      <PromptAssemblyPanel
        dnaPrompt={contract.promptSources.dnaPrompt}
        triggerWord={contract.promptSources.triggerWord}
        costumePrompt={selectedCostume?.costumePrompt ?? contract.promptSources.costumePrompt}
        onConfirm={handlePromptConfirm}
      />

      {/* Parameters */}
      <ParamsPanel
        params={params}
        onChange={(partial) => setParams((p) => ({ ...p, ...partial }))}
      />

      {/* Generate button */}
      {generateState.kind === "idle" && (
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="self-start px-5 py-2 rounded bg-blue-600 text-white font-medium text-sm disabled:opacity-40"
        >
          {!contract.canGenerate ? "无法生成（需完成视觉训练）" : "开始生成"}
        </button>
      )}

      {/* Submitting */}
      {generateState.kind === "submitting" && (
        <p className="text-sm text-gray-400" role="status">
          正在提交生成任务…
        </p>
      )}

      {/* Running */}
      {generateState.kind === "running" && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-xs text-gray-400">
            <span>{generateState.job.message ?? "生成中…"}</span>
            <span>{generateState.job.progress}%</span>
          </div>
          <ProgressBar progress={generateState.job.progress} />
          <span
            className={`text-xs ${taskConnection === "connected" ? "text-green-500" : "text-gray-500"}`}
          >
            {taskConnection === "connected" ? "实时推送已连接" : "实时推送连接中…"}
          </span>
        </div>
      )}

      {/* Done */}
      {generateState.kind === "done" && (
        <div className="flex flex-col gap-3">
          <div
            className="rounded bg-green-900/30 border border-green-700 px-3 py-2 text-sm text-green-300"
            role="status"
          >
            生成完成
          </div>
          {/* Image placeholder — real file path will be wired in M2-F */}
          <div
            className="rounded bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-sm"
            style={{ height: 200 }}
            aria-label="生成结果占位符"
          >
            图片归档将在 M2-F 接入后显示
          </div>
          <button
            type="button"
            onClick={handleGenerateAnother}
            className="self-start px-4 py-1.5 rounded bg-gray-700 text-white text-sm hover:bg-gray-600"
          >
            再来一张
          </button>
        </div>
      )}

      {/* Failed */}
      {generateState.kind === "failed" && (
        <div className="flex flex-col gap-2">
          <div
            className="rounded bg-red-900/30 border border-red-700 px-3 py-2 text-sm text-red-300"
            role="alert"
          >
            {generateState.message}
          </div>
          <button
            type="button"
            onClick={handleGenerateAnother}
            className="self-start px-4 py-1.5 rounded bg-gray-700 text-white text-sm"
          >
            重新生成
          </button>
        </div>
      )}

      {submitError && (
        <p className="text-sm text-red-400" role="alert">
          {submitError}
        </p>
      )}
    </div>
  );
}
