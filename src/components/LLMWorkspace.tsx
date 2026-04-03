import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLLMHealth, type LLMHealthStatus } from "../api/llmHealth";
import { LLMDatasetPanel } from "./LLMDatasetPanel";
import { LLMTrainingPanel } from "./LLMTrainingPanel";
import { LLMModelPanel } from "./LLMModelPanel";
import { ChatPanel } from "./ChatPanel";
import type { LLMModel } from "../api/llmModels";

type LLMSubTab = "datasets" | "training" | "models" | "chat";

const SUB_TAB_LABELS: Record<LLMSubTab, string> = {
  datasets: "文字数据集",
  training: "模型训练",
  models:   "私有模型",
  chat:     "角色对话",
};

function OllamaBanner({ status }: { status: LLMHealthStatus | null }) {
  if (status === null) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-500">
        <span className="w-2 h-2 rounded-full bg-zinc-600 shrink-0" />
        正在检测 Ollama 状态…
      </div>
    );
  }

  if (status.running) {
    const baseModel = status.models.find((m) =>
      m.name.includes("qwen2.5") || m.name.includes("qwen")
    );
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-950/30 border border-green-800/50 text-xs">
        <span className="relative flex w-2 h-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50" />
          <span className="relative inline-flex rounded-full w-2 h-2 bg-green-400" />
        </span>
        <span className="text-green-300">Ollama 已就绪</span>
        {status.version && (
          <span className="text-green-800 font-mono">v{status.version}</span>
        )}
        {baseModel ? (
          <>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-400 font-mono">{baseModel.name}</span>
          </>
        ) : (
          <>
            <span className="text-zinc-700">·</span>
            <span className="text-yellow-600">{status.models.length} 个模型可用</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-yellow-950/40 border border-yellow-800/60 px-3 py-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
        <span className="text-yellow-300 font-medium">Ollama 未运行</span>
        <span className="text-zinc-500 ml-auto">语言引擎不可用，无法训练或对话</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
          前往 ollama.com 下载安装
        </span>
        <span className="text-zinc-700">→</span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
          启动 Ollama 应用
        </span>
        <span className="text-zinc-700">→</span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
          回到此页面自动检测
        </span>
      </div>
      {status.hint && (
        <p className="text-xs text-zinc-500">{status.hint}</p>
      )}
    </div>
  );
}

type Props = {
  characterId: string;
  characterName: string;
};

export function LLMWorkspace({ characterId, characterName }: Props) {
  const [subTab, setSubTab] = useState<LLMSubTab>("datasets");
  const [ollamaStatus, setOllamaStatus] = useState<LLMHealthStatus | null>(null);
  // selectedModel flows: 私有模型 tab → 角色对话 tab
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const status = await fetchLLMHealth();
      setOllamaStatus(status);
    } catch {
      setOllamaStatus({ running: false, version: null, models: [], hint: null });
    }
  }, []);

  // Initial check + poll every 15 seconds
  useEffect(() => {
    void checkHealth();
    pollRef.current = setInterval(() => void checkHealth(), 15_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checkHealth]);

  return (
    <div className="flex flex-col gap-4 min-h-0 h-full">
      {/* Ollama status banner */}
      <OllamaBanner status={ollamaStatus} />

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
            />
          </div>
        )}
      </div>
    </div>
  );
}
