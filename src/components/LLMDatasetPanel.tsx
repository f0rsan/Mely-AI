import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationPreviewItem,
  LLMDataset,
  deleteLLMDataset,
  listLLMDatasets,
  previewLLMDataset,
  uploadLLMDataset,
} from "../api/llmDatasets";

type Props = {
  characterId: string;
};

const FORMAT_LABELS: Record<string, string> = {
  persona_doc: "人设文档",
  dialogue_jsonl: "对话样本 (JSONL)",
  dialogue_csv: "对话样本 (CSV)",
  mixed: "混合",
};

function QualityBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? "text-green-400" : score >= 0.5 ? "text-yellow-400" : "text-red-400";
  return <span className={`text-xs font-mono ${color}`}>{pct}%</span>;
}

function PreviewModal({
  dataset,
  onClose,
}: {
  dataset: LLMDataset;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ConversationPreviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    previewLLMDataset(dataset.id, 10)
      .then((data) => { if (!cancelled) setItems(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dataset.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-zinc-900 rounded-xl border border-zinc-700 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-200">
            预览：{dataset.name}
            <span className="ml-2 text-xs text-zinc-500">
              {FORMAT_LABELS[dataset.sourceFormat] ?? dataset.sourceFormat}
            </span>
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">✕</button>
        </div>

        {loading ? (
          <p className="text-zinc-500 text-sm">加载中…</p>
        ) : items.length === 0 ? (
          <p className="text-zinc-500 text-sm">暂无预览内容</p>
        ) : (
          <div className="space-y-4">
            {items.map((item, i) => (
              <div key={i} className="rounded-lg border border-zinc-700 overflow-hidden text-sm">
                <div className="px-3 py-2 bg-zinc-800 border-b border-zinc-700">
                  <span className="text-zinc-400 text-xs">用户</span>
                  <p className="text-zinc-200 mt-1">{item.human}</p>
                </div>
                <div className="px-3 py-2 bg-zinc-850">
                  <span className="text-indigo-400 text-xs">角色</span>
                  <p className="text-zinc-300 mt-1 whitespace-pre-wrap">{item.gpt}</p>
                </div>
              </div>
            ))}
            <p className="text-zinc-600 text-xs text-center">显示前 {items.length} 条 / 共 {dataset.itemCount} 条</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function LLMDatasetPanel({ characterId }: Props) {
  const [datasets, setDatasets] = useState<LLMDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewDataset, setPreviewDataset] = useState<LLMDataset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await listLLMDatasets(characterId);
      setDatasets(data);
    } catch {
      setError("加载数据集列表失败");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => { load(); }, [load]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const content = await file.text();
      const record = await uploadLLMDataset(characterId, {
        filename: file.name,
        content,
      });
      setDatasets((prev) => [record, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (datasetId: string) => {
    try {
      await deleteLLMDataset(datasetId);
      setDatasets((prev) => prev.filter((d) => d.id !== datasetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">文字数据集</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            支持人设文档（.md / .txt）和对话样本（.jsonl / .csv）
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-xs font-medium text-white transition-colors"
        >
          {uploading ? "上传中…" : "+ 上传文件"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.jsonl,.csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Format guide */}
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="text-zinc-400"><span className="text-zinc-300">.md / .txt</span> — 人设文档</div>
        <div className="text-zinc-400"><span className="text-zinc-300">.jsonl</span> — 对话样本</div>
        <div className="text-zinc-500 col-span-2">JSONL 支持 user/assistant、human/gpt、ShareGPT 格式</div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-zinc-500 text-sm">加载中…</p>
      ) : datasets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 py-10 text-center">
          <p className="text-zinc-500 text-sm">还没有数据集</p>
          <p className="text-zinc-600 text-xs mt-1">上传人设文档或对话样本开始训练</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {datasets.map((d) => (
            <li
              key={d.id}
              className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-2.5
                         flex items-center gap-3"
            >
              {/* Icon */}
              <span className="text-lg shrink-0">
                {d.sourceFormat === "persona_doc" ? "📄" : "💬"}
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">{d.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-zinc-500">
                    {FORMAT_LABELS[d.sourceFormat] ?? d.sourceFormat}
                  </span>
                  <span className="text-zinc-700">·</span>
                  <span className="text-xs text-zinc-500">{d.itemCount} 条</span>
                  <span className="text-zinc-700">·</span>
                  <QualityBadge score={d.qualityScore} />
                </div>
                {d.qualityIssues.length > 0 && (
                  <p className="text-xs text-yellow-500 mt-1 truncate">
                    ⚠ {d.qualityIssues[0]}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setPreviewDataset(d)}
                  className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200
                             hover:bg-zinc-700 transition-colors"
                >
                  预览
                </button>
                <button
                  onClick={() => handleDelete(d.id)}
                  className="px-2 py-1 rounded text-xs text-zinc-500 hover:text-red-400
                             hover:bg-zinc-700 transition-colors"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Total stats */}
      {datasets.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-zinc-500 pt-1">
          <span>{datasets.length} 个文件</span>
          <span>共 {datasets.reduce((s, d) => s + d.itemCount, 0)} 条对话</span>
        </div>
      )}

      {/* Preview modal */}
      {previewDataset && (
        <PreviewModal dataset={previewDataset} onClose={() => setPreviewDataset(null)} />
      )}
    </div>
  );
}
