import { useCallback, useEffect, useState } from "react";
import {
  LLMModel,
  deleteLLMModel,
  listLLMModels,
  retryLLMModelRegistration,
} from "../api/llmModels";

type Props = {
  characterId: string;
  onSelectModel?: (model: LLMModel | null) => void;
  selectedModelId?: string | null;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded border border-green-800 bg-green-950/40 text-green-400 font-mono">
        已就绪
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded border border-yellow-800 bg-yellow-950/40 text-yellow-400 font-mono">
        待注册
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded border border-red-800 bg-red-950/40 text-red-300 font-mono">
        注册失败
      </span>
    );
  }
  return null;
}

function ModelCard({
  model,
  isSelected,
  onSelect,
  onRetry,
  onDelete,
}: {
  model: LLMModel;
  isSelected: boolean;
  onSelect: () => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-3 cursor-pointer transition-colors ${
        isSelected
          ? "border-indigo-500 bg-indigo-950/30"
          : "border-zinc-700 bg-zinc-800/30 hover:border-zinc-500"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-zinc-200 shrink-0">v{model.version}</span>
          <StatusBadge status={model.status} />
          {isSelected && (
            <span className="text-xs text-indigo-400 font-mono shrink-0">● 当前</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {(model.status === "pending" || model.status === "failed") && (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(model.id); }}
              className="px-2 py-1 rounded text-xs text-yellow-400 hover:bg-zinc-700 transition-colors"
            >
              重试注册
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(model.id); }}
            className="px-2 py-1 rounded text-xs text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors"
          >
            删除
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-0.5">
        <p className="text-xs text-zinc-500 font-mono truncate">{model.ollamaModelName}</p>
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          {model.datasetItemCount > 0 && <span>{model.datasetItemCount} 条训练数据</span>}
          {model.lossFinal !== null && (
            <span>loss {model.lossFinal.toFixed(4)}</span>
          )}
          <span>{model.createdAt.slice(0, 10)}</span>
        </div>
      </div>
    </div>
  );
}

export function LLMModelPanel({
  characterId,
  onSelectModel,
  selectedModelId,
}: Props) {
  const [models, setModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listLLMModels(characterId);
      setModels(data);
    } catch {
      setError("加载模型列表失败");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => { load(); }, [load]);

  const handleSelect = (model: LLMModel) => {
    if (model.status !== "ready") return;
    onSelectModel?.(model.id === selectedModelId ? null : model);
  };

  const handleRetry = async (modelId: string) => {
    setRetrying(modelId);
    setError(null);
    try {
      const updated = await retryLLMModelRegistration(modelId);
      setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试注册失败，请确认 Ollama 已启动");
    } finally {
      setRetrying(null);
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      await deleteLLMModel(modelId);
      setModels((prev) => prev.filter((m) => m.id !== modelId));
      if (selectedModelId === modelId) {
        onSelectModel?.(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  if (loading) {
    return <p className="text-zinc-500 text-sm">加载中…</p>;
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">私有模型</h3>
        <p className="text-xs text-zinc-600 mt-0.5">选择模型后将在对话中使用该角色专属模型</p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Model list */}
      {models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 py-8 text-center">
          <p className="text-zinc-500 text-sm">暂无私有模型</p>
          <p className="text-zinc-600 text-xs mt-1">完成训练后模型会自动出现在这里</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Base model option */}
          <div
            className={`rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
              !selectedModelId
                ? "border-zinc-500 bg-zinc-700/30"
                : "border-zinc-700 bg-zinc-800/20 hover:border-zinc-600"
            }`}
            onClick={() => onSelectModel?.(null)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-300">基础模型</span>
              {!selectedModelId && (
                <span className="text-xs text-zinc-400 font-mono">● 当前</span>
              )}
            </div>
            <p className="text-xs text-zinc-600 mt-0.5 font-mono">qwen2.5:7b-instruct-q4_K_M</p>
          </div>

          {models.map((model) => (
            <div key={model.id} className={retrying === model.id ? "opacity-60" : ""}>
              <ModelCard
                model={model}
                isSelected={selectedModelId === model.id}
                onSelect={() => handleSelect(model)}
                onRetry={handleRetry}
                onDelete={handleDelete}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
