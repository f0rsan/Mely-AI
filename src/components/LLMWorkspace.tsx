import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLLMRuntime, openLLMRuntime, type LLMRuntimeStatus } from "../api/llmRuntime";
import { LLMDatasetPanel } from "./LLMDatasetPanel";
import { LLMTrainingPanel } from "./LLMTrainingPanel";
import { LLMModelPanel } from "./LLMModelPanel";
import { ChatPanel } from "./ChatPanel";
import { ModelLibraryPanel } from "./ModelLibraryPanel";
import type { LLMModel } from "../api/llmModels";

type LLMSubTab = "datasets" | "training" | "models" | "chat" | "library";

const SUB_TAB_LABELS: Record<LLMSubTab, string> = {
  datasets: "文字数据集",
  training: "模型训练",
  models:   "私有模型",
  chat:     "角色对话",
  library:  "模型库",
};

export function hasBaseModel(status: LLMRuntimeStatus): boolean {
  return status.models.length > 0;
}

function formatPathTail(rawPath: string | null | undefined): string {
  if (!rawPath) return "";
  const parts = rawPath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return rawPath;
  return `…/${parts.slice(-3).join("/")}`;
}

function resolveBaseModelChatDisabledReason(
  status: LLMRuntimeStatus | null,
  loading: boolean,
): string | null {
  if (loading || status === null) {
    return "正在检测语言引擎状态，请稍候。";
  }
  if (!status.installed) {
    return "未检测到语言引擎，请先安装后重试。";
  }
  if (!status.running) {
    return "语言引擎未启动，请先启动语言引擎。";
  }
  if (!hasBaseModel(status)) {
    return "未检测到基础模型，请先在模型库下载后再试。";
  }
  return null;
}

function RuntimeBanner({
  loading,
  runtime,
  busyOpening,
  startError,
  onOpenRuntime,
  onRefresh,
}: {
  loading: boolean;
  runtime: LLMRuntimeStatus | null;
  busyOpening: boolean;
  startError: string | null;
  onOpenRuntime: () => void;
  onRefresh: () => void;
}) {
  if (loading || runtime === null) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-500">
        <span className="w-2 h-2 rounded-full bg-zinc-600 shrink-0" />
        正在检测语言引擎状态…
      </div>
    );
  }

  if (!runtime.installed) {
    return (
      <div className="rounded-lg bg-yellow-950/40 border border-yellow-800/60 px-3 py-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
          <span className="text-yellow-300 font-medium">未检测到语言引擎</span>
          <span className="text-zinc-500 ml-auto">请先安装后继续</span>
        </div>
        <p className="text-xs text-zinc-400">请先安装 Ollama 后再返回此页面。</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.open("https://ollama.com/download", "_blank")}
            className="text-xs px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100"
          >
            查看安装指引
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100"
          >
            重新检测
          </button>
        </div>
      </div>
    );
  }

  if (!runtime.running) {
    return (
      <div className="rounded-lg bg-yellow-950/40 border border-yellow-800/60 px-3 py-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
          <span className="text-yellow-300 font-medium">语言引擎未启动</span>
          <span className="text-zinc-500 ml-auto">请先启动后再继续</span>
        </div>
        <p className="text-xs text-zinc-500">{runtime.hint ?? "语言引擎未启动，请点击下方按钮尝试启动。"}</p>
        {startError && (
          <p className="text-xs text-red-300">{startError}</p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenRuntime}
            disabled={busyOpening}
            className="text-xs px-2.5 py-1 rounded border border-indigo-700 bg-indigo-950/50 text-indigo-300 hover:text-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busyOpening ? "启动中…" : "启动引擎"}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100"
          >
            重新检测
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-green-950/30 border border-green-800/50 px-3 py-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="relative flex w-2 h-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50" />
          <span className="relative inline-flex rounded-full w-2 h-2 bg-green-400" />
        </span>
        <span className="text-green-300 font-medium">语言引擎已就绪</span>
        {runtime.version && <span className="text-green-800 font-mono">v{runtime.version}</span>}
        <span className="text-zinc-700">·</span>
        <span className="text-zinc-400">已安装模型 {runtime.models.length} 个</span>
      </div>
      {(runtime.buildVersion || runtime.releaseSummaryPath) && (
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          构建版本：{runtime.buildVersion ?? "未知"}
          {runtime.releaseSummaryPath && (
            <>
              {" "}· 构建摘要：
              <span title={runtime.releaseSummaryPath} className="font-mono text-zinc-400">
                {formatPathTail(runtime.releaseSummaryPath)}
              </span>
            </>
          )}
        </p>
      )}
      <button
        type="button"
        onClick={onRefresh}
        className="text-xs px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100"
      >
        重新检测
      </button>
    </div>
  );
}

type Props = {
  characterId: string;
  characterName: string;
  initialSubTab?: LLMSubTab;
};

export function LLMWorkspace({ characterId, characterName, initialSubTab }: Props) {
  const [subTab, setSubTab] = useState<LLMSubTab>(initialSubTab ?? "datasets");
  const [runtimeStatus, setRuntimeStatus] = useState<LLMRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [openingRuntime, setOpeningRuntime] = useState(false);
  // selectedModel flows: 私有模型 tab → 角色对话 tab
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkRuntime = useCallback(async () => {
    try {
      setRuntimeLoading(true);
      const status = await fetchLLMRuntime();
      setRuntimeStatus(status);
      setRuntimeError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "语言引擎状态检测失败，请重试";
      setRuntimeStatus({
        installed: false,
        running: false,
        version: null,
        minimumVersion: "0.3.10",
        platform: "unknown",
        models: [],
        hint: message,
      });
      setRuntimeError(message);
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  const handleOpenRuntime = useCallback(async () => {
    setOpeningRuntime(true);
    setRuntimeError(null);
    try {
      await openLLMRuntime();
      await checkRuntime();
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "启动失败，请稍后重试");
    } finally {
      setOpeningRuntime(false);
    }
  }, [checkRuntime]);

  useEffect(() => {
    void checkRuntime();
    pollRef.current = setInterval(() => void checkRuntime(), 15_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checkRuntime]);

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const chatDisabledReason =
    selectedModel === null ? resolveBaseModelChatDisabledReason(runtimeStatus, runtimeLoading) : null;

  return (
    <div className="flex flex-col gap-4 min-h-0 h-full">
      <RuntimeBanner
        loading={runtimeLoading}
        runtime={runtimeStatus}
        busyOpening={openingRuntime}
        startError={runtimeError}
        onOpenRuntime={() => void handleOpenRuntime()}
        onRefresh={() => void checkRuntime()}
      />

      {/* Sub-tab bar */}
      <div className="flex gap-0 border-b border-zinc-800">
        {(Object.keys(SUB_TAB_LABELS) as LLMSubTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              subTab === tab
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {SUB_TAB_LABELS[tab]}
            {tab === "chat" && selectedModel && (
              <span className="ml-1.5 text-[10px] text-indigo-500 font-mono">v{selectedModel.version}</span>
            )}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {subTab === "datasets" && (
          <LLMDatasetPanel characterId={characterId} />
        )}
        {subTab === "training" && (
          <LLMTrainingPanel characterId={characterId} />
        )}
        {subTab === "models" && (
          <LLMModelPanel
            characterId={characterId}
            selectedModelId={selectedModel?.id ?? null}
            onSelectModel={(model) => {
              setSelectedModel(model);
              // Navigate to chat after selecting a model
              if (model) setSubTab("chat");
            }}
          />
        )}
        {subTab === "chat" && (
          <div className="h-full" style={{ minHeight: "500px" }}>
            <ChatPanel
              characterId={characterId}
              characterName={characterName}
              llmModelId={selectedModel?.id ?? null}
              chatDisabledReason={chatDisabledReason}
            />
          </div>
        )}
        {subTab === "library" && (
          <ModelLibraryPanel
            characterId={characterId}
            runtimeStatus={runtimeStatus}
            onRefreshRuntime={() => checkRuntime()}
          />
        )}
      </div>
    </div>
  );
}
