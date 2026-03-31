import { useCallback, useEffect, useMemo, useState } from "react";

import { type GenerationArchiveRecord, fetchGenerationArchives } from "../api/archive";

const API_BASE_URL = "http://127.0.0.1:8000";

type Costume = { id: string; name: string };

type RegenerateParams = {
  costumeId: string;
  assembledPrompt: string;
  width: number;
  height: number;
  steps: number;
  sampler: string;
  cfgScale: number;
  seed: number | null;
  loraWeight: number;
};

type Props = {
  characterId: string;
  costumes: Costume[];
  onRegenerate?: (params: RegenerateParams) => void;
};

type FilterState = {
  costumeId: string;
  tag: string;
};

function imageUrl(generationId: string): string {
  return `${API_BASE_URL}/api/generations/${generationId}/image`;
}

export function GenerationHistoryGallery({ characterId, costumes, onRegenerate }: Props) {
  const [records, setRecords] = useState<GenerationArchiveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>({ costumeId: "", tag: "" });
  const [selected, setSelected] = useState<GenerationArchiveRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchGenerationArchives(characterId);
      setRecords(result.items);
    } catch {
      setError("历史记录加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    load();
  }, [load]);

  // Collect distinct tags from all records.
  const allTags = useMemo<string[]>(() => {
    const seen = new Set<string>();
    for (const r of records) {
      for (const t of r.tags) seen.add(t);
    }
    return Array.from(seen).sort();
  }, [records]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (filter.costumeId && r.costumeId !== filter.costumeId) return false;
      if (filter.tag && !r.tags.includes(filter.tag)) return false;
      return true;
    });
  }, [records, filter]);

  if (loading) {
    return (
      <div role="status" className="text-sm text-gray-500 py-4 text-center">
        正在加载历史记录…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="text-sm text-red-500 py-4 text-center">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          aria-label="按造型筛选"
          className="border border-gray-300 rounded px-2 py-1 text-sm"
          value={filter.costumeId}
          onChange={(e) => setFilter((f) => ({ ...f, costumeId: e.target.value }))}
        >
          <option value="">所有造型</option>
          {costumes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          aria-label="按标签筛选"
          className="border border-gray-300 rounded px-2 py-1 text-sm"
          value={filter.tag}
          onChange={(e) => setFilter((f) => ({ ...f, tag: e.target.value }))}
        >
          <option value="">所有标签</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {(filter.costumeId || filter.tag) && (
          <button
            className="text-xs text-gray-500 underline"
            onClick={() => setFilter({ costumeId: "", tag: "" })}
          >
            清除筛选
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400">
          共 {filtered.length} 条记录
        </span>
      </div>

      {/* Thumbnail grid */}
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">暂无生成记录</p>
      ) : (
        <ul
          className="grid grid-cols-3 gap-3"
          aria-label="生成历史缩略图"
        >
          {filtered.map((record) => (
            <li key={record.id}>
              <button
                className="w-full aspect-square bg-gray-100 rounded-md overflow-hidden border border-gray-200 hover:border-indigo-400 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
                aria-label={`查看生成记录 ${record.id}`}
                onClick={() => setSelected(record)}
              >
                <img
                  src={imageUrl(record.id)}
                  alt={String(record.paramsSnapshot["assembledPrompt"] ?? "")}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </button>
              <p className="text-xs text-gray-500 mt-1 truncate">
                {String(record.paramsSnapshot["assembledPrompt"] ?? "").slice(0, 30)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Detail modal */}
      {selected && (
        <GenerationDetailModal
          record={selected}
          costumes={costumes}
          onClose={() => setSelected(null)}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
}

type ModalProps = {
  record: GenerationArchiveRecord;
  costumes: Costume[];
  onClose: () => void;
  onRegenerate?: (params: RegenerateParams) => void;
};

function GenerationDetailModal({ record, costumes, onClose, onRegenerate }: ModalProps) {
  const costume = costumes.find((c) => c.id === record.costumeId);
  const snap = record.paramsSnapshot;

  function handleRegenerate() {
    if (!onRegenerate) return;
    onRegenerate({
      costumeId: record.costumeId,
      assembledPrompt: String(snap["assembledPrompt"] ?? ""),
      width: Number(snap["width"] ?? 1024),
      height: Number(snap["height"] ?? 1024),
      steps: Number(snap["steps"] ?? 28),
      sampler: String(snap["sampler"] ?? "DPM++ 2M Karras"),
      cfgScale: Number(snap["cfgScale"] ?? 3.5),
      seed: snap["seed"] != null ? Number(snap["seed"]) : null,
      loraWeight: Number(snap["loraWeight"] ?? 0.85),
    });
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="生成详情"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 overflow-hidden flex flex-col md:flex-row">
        {/* Large preview */}
        <div className="md:w-1/2 bg-gray-100 flex items-center justify-center p-4 min-h-[240px]">
          <img
            src={imageUrl(record.id)}
            alt={String(snap["assembledPrompt"] ?? "")}
            className="max-w-full max-h-[400px] object-contain rounded"
          />
        </div>

        {/* Params panel */}
        <div className="md:w-1/2 p-5 flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">生成参数</h2>
            <button
              aria-label="关闭"
              className="text-gray-400 hover:text-gray-600"
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          <dl className="text-sm flex flex-col gap-1.5">
            <ParamRow label="造型" value={costume?.name ?? record.costumeId} />
            <ParamRow label="Prompt" value={String(snap["assembledPrompt"] ?? "")} />
            <ParamRow label="尺寸" value={`${snap["width"]} × ${snap["height"]}`} />
            <ParamRow label="步数" value={String(snap["steps"] ?? "")} />
            <ParamRow label="采样器" value={String(snap["sampler"] ?? "")} />
            <ParamRow label="CFG" value={String(snap["cfgScale"] ?? "")} />
            <ParamRow label="Seed" value={snap["seed"] != null ? String(snap["seed"]) : "随机"} />
            <ParamRow label="LoRA 权重" value={String(snap["loraWeight"] ?? "")} />
          </dl>

          {record.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {record.tags.map((t) => (
                <span
                  key={t}
                  className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-auto">
            {new Date(record.createdAt).toLocaleString("zh-CN")}
          </p>

          {onRegenerate && (
            <button
              className="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
              onClick={handleRegenerate}
            >
              用此参数重新生成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-gray-500 min-w-[5rem]">{label}</dt>
      <dd className="text-gray-800 break-all">{value}</dd>
    </div>
  );
}
