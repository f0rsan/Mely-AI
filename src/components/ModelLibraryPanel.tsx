import { useCallback, useEffect, useMemo, useState } from "react";

import { deleteLLMRuntimeModel, fetchLLMCatalog, type LLMCatalogItem } from "../api/llmCatalog";
import { fetchCharacterLLMPreferences, updateCharacterLLMPreferences } from "../api/llmPreferences";
import { pullLLMModel, type LLMPullEvent } from "../api/llmPull";
import type { LLMRuntimeStatus } from "../api/llmRuntime";

type Props = {
  characterId: string;
  runtimeStatus: LLMRuntimeStatus | null;
  onRefreshRuntime: () => Promise<void> | void;
};

type PullState = {
  status: string;
  phase: string;
  percent: number | null;
  total: number | null;
  completed: number | null;
};

function kindLabel(item: LLMCatalogItem): string {
  if (item.kind === "vision") return "多模态";
  if (item.tier === "default") return "对话";
  if (item.tier === "light") return "轻量";
  return "文本";
}

function formatBinarySize(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}

function toPullState(event: LLMPullEvent): PullState {
  return {
    status: event.status,
    phase: event.phase ?? "处理中",
    percent: typeof event.percent === "number" ? event.percent : null,
    total: typeof event.total === "number" ? event.total : null,
    completed: typeof event.completed === "number" ? event.completed : null,
  };
}

export function ModelLibraryPanel({ characterId, runtimeStatus, onRefreshRuntime }: Props) {
  const [catalog, setCatalog] = useState<LLMCatalogItem[]>([]);
  const [defaultModelName, setDefaultModelName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pullStates, setPullStates] = useState<Record<string, PullState>>({});
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [settingDefaultModel, setSettingDefaultModel] = useState<string | null>(null);

  const installedModelNames = useMemo(() => {
    return new Set(runtimeStatus?.models.map((model) => model.name) ?? []);
  }, [runtimeStatus]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogResp, prefResp] = await Promise.all([
        fetchLLMCatalog(),
        fetchCharacterLLMPreferences(characterId),
      ]);
      setCatalog(catalogResp.items);
      setDefaultModelName(prefResp.defaultBaseModelName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载模型库失败");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshRuntime = useCallback(async () => {
    await onRefreshRuntime();
  }, [onRefreshRuntime]);

  const handleDownload = async (item: LLMCatalogItem) => {
    if (!runtimeStatus?.running) {
      setError("请先启动语言引擎后再下载模型。");
      return;
    }
    setError(null);
    setPullStates((prev) => ({
      ...prev,
      [item.modelName]: {
        status: "pulling manifest",
        phase: "正在获取模型信息",
        percent: 0,
        total: null,
        completed: null,
      },
    }));

    try {
      await pullLLMModel(item.modelName, (event) => {
        setPullStates((prev) => ({
          ...prev,
          [item.modelName]: toPullState(event),
        }));
      });
      setPullStates((prev) => ({
        ...prev,
        [item.modelName]: {
          status: "done",
          phase: "下载完成",
          percent: 100,
          total: prev[item.modelName]?.total ?? null,
          completed: prev[item.modelName]?.completed ?? null,
        },
      }));
      await refreshRuntime();
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败，请稍后重试");
      setPullStates((prev) => ({
        ...prev,
        [item.modelName]: {
          status: "error",
          phase: "下载失败",
          percent: prev[item.modelName]?.percent ?? null,
          total: prev[item.modelName]?.total ?? null,
          completed: prev[item.modelName]?.completed ?? null,
        },
      }));
    }
  };

  const handleDelete = async (item: LLMCatalogItem) => {
    setError(null);
    setDeletingModel(item.modelName);
    try {
      await deleteLLMRuntimeModel(item.modelName);
      await refreshRuntime();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败，请稍后重试");
    } finally {
      setDeletingModel(null);
    }
  };

  const handleSetDefault = async (item: LLMCatalogItem) => {
    setError(null);
    setSettingDefaultModel(item.modelName);
    try {
      const updated = await updateCharacterLLMPreferences(characterId, {
        defaultBaseModelName: item.modelName,
      });
      setDefaultModelName(updated.defaultBaseModelName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置默认模型失败");
    } finally {
      setSettingDefaultModel(null);
    }
  };

  if (loading) {
    return <p className="text-zinc-500 text-sm">正在加载模型库…</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">模型库</h3>
        <p className="text-xs text-zinc-600 mt-0.5">可在应用内下载、删除并设置角色默认基础模型</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {catalog.map((item) => {
          const pullState = pullStates[item.modelName];
          const isDownloading = Boolean(pullState) && !["done", "error"].includes(pullState.status);
          const isInstalled = installedModelNames.has(item.modelName);
          const isDefault = defaultModelName === item.modelName;
          const statusLabel = isDownloading
            ? `下载中 ${Math.round(pullState?.percent ?? 0)}%`
            : isInstalled
              ? "已就绪"
              : "未下载";

          return (
            <div
              key={item.id}
              data-testid={`model-card-${item.id}`}
              className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-zinc-200">{item.displayName}</p>
                    <span className="text-[11px] px-1.5 py-0.5 rounded border border-zinc-600 text-zinc-300">
                      {kindLabel(item)}
                    </span>
                    {item.recommended && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded border border-indigo-700 text-indigo-300">
                        推荐
                      </span>
                    )}
                    {isDefault && (
                      <span className="text-xs text-indigo-300 font-mono">当前默认</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 font-mono truncate">{item.modelName}</p>
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span>{item.sizeLabel}</span>
                    <span>{item.memoryHint}</span>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded border ${
                    isInstalled
                      ? "border-green-800 bg-green-950/40 text-green-300"
                      : isDownloading
                        ? "border-blue-800 bg-blue-950/40 text-blue-300"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {statusLabel}
                </span>
              </div>

              {pullState && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-zinc-400">{pullState.phase}</p>
                  {pullState.total !== null && pullState.completed !== null && (
                    <p className="text-xs text-zinc-500">
                      已下载 {formatBinarySize(pullState.completed)} / {formatBinarySize(pullState.total)}
                    </p>
                  )}
                  <div className="w-full h-1.5 rounded bg-zinc-700 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, pullState.percent ?? 0))}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownload(item)}
                  disabled={isDownloading || !runtimeStatus?.running || isInstalled}
                  className="px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下载
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(item)}
                  disabled={!isInstalled || deletingModel === item.modelName}
                  className="px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  删除
                </button>
                <button
                  type="button"
                  onClick={() => void handleSetDefault(item)}
                  disabled={!isInstalled || isDefault || settingDefaultModel === item.modelName}
                  className="px-2.5 py-1 rounded text-xs border border-indigo-700 bg-indigo-950/40 text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  设为默认
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500">
        多模态模型下载后可在角色对话中用于图片提问。
      </p>
    </div>
  );
}
