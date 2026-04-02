import { useCallback, useEffect, useRef, useState } from "react";
import {
  VisualDataset,
  VisualImage,
  createVisualDataset,
  deleteVisualDataset,
  deleteVisualImage,
  listVisualDatasets,
  listVisualImages,
  uploadVisualImage,
} from "../api/visualDatasets";

type Props = {
  characterId: string;
};

function QualityBar({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color =
    score >= 0.7 ? "bg-green-500" :
    score >= 0.4 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-400 w-8 text-right shrink-0">{pct}%</span>
    </div>
  );
}

function ImageGrid({
  images,
  onDelete,
}: {
  images: VisualImage[];
  onDelete: (id: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2">
      {images.map((img) => (
        <div key={img.id} className="group relative aspect-square rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700">
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
            {img.width && img.height ? (
              <span className="font-mono">{img.width}×{img.height}</span>
            ) : (
              <span>图片</span>
            )}
          </div>
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
              onClick={() => onDelete(img.id)}
              className="text-red-400 hover:text-red-300 text-xs bg-zinc-900/80 px-2 py-1 rounded"
            >
              删除
            </button>
          </div>
          <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
            <p className="text-zinc-400 text-[9px] truncate">{img.filename}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DatasetCard({
  dataset,
  onDelete,
  onUpload,
}: {
  dataset: VisualDataset;
  onDelete: (id: string) => void;
  onUpload: (datasetId: string, files: FileList) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [images, setImages] = useState<VisualImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadImages = useCallback(async () => {
    setLoadingImages(true);
    try {
      setImages(await listVisualImages(dataset.id));
    } finally {
      setLoadingImages(false);
    }
  }, [dataset.id]);

  useEffect(() => {
    if (expanded) void loadImages();
  }, [expanded, loadImages]);

  const handleDeleteImage = async (imageId: string) => {
    await deleteVisualImage(imageId);
    setImages((prev) => prev.filter((i) => i.id !== imageId));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(dataset.id, e.target.files);
      e.target.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/30">
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-zinc-400 text-xs w-3 shrink-0">{expanded ? "▾" : "▸"}</span>
        <span className="flex-1 text-sm text-zinc-200 truncate">{dataset.name}</span>
        <span className="text-xs text-zinc-500 shrink-0">{dataset.imageCount} 张</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(dataset.id); }}
          className="text-zinc-600 hover:text-red-400 transition-colors text-xs ml-1 shrink-0"
        >
          ✕
        </button>
      </div>

      {dataset.qualityScore !== null && (
        <div className="px-3 pb-2">
          <QualityBar score={dataset.qualityScore} />
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-700/50">
          {dataset.qualityIssues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {dataset.qualityIssues.map((issue, i) => (
                <li key={i} className="text-xs text-yellow-600 flex gap-1.5">
                  <span className="shrink-0">⚠</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2 mt-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 py-1.5 rounded-lg border border-dashed border-zinc-600
                         hover:border-indigo-500 text-xs text-zinc-500 hover:text-indigo-400
                         transition-colors"
            >
              + 添加图片
            </button>
          </div>

          {loadingImages ? (
            <p className="text-xs text-zinc-500 text-center py-2">加载中…</p>
          ) : (
            <ImageGrid images={images} onDelete={handleDeleteImage} />
          )}
        </div>
      )}
    </div>
  );
}

export function VisualDatasetPanel({ characterId }: Props) {
  const [datasets, setDatasets] = useState<VisualDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dropZoneRef = useRef<HTMLDivElement>(null);

  const loadDatasets = useCallback(async () => {
    try {
      setDatasets(await listVisualDatasets(characterId));
    } catch {
      setError("加载失败，请刷新重试");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => { void loadDatasets(); }, [loadDatasets]);

  const handleCreate = async () => {
    const name = newName.trim() || `图片集 ${datasets.length + 1}`;
    setCreating(true);
    setError(null);
    try {
      const ds = await createVisualDataset(characterId, name);
      setDatasets((prev) => [ds, ...prev]);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (datasetId: string) => {
    try {
      await deleteVisualDataset(datasetId);
      setDatasets((prev) => prev.filter((d) => d.id !== datasetId));
    } catch {
      setError("删除失败");
    }
  };

  const handleUpload = async (datasetId: string, files: FileList) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadVisualImage(datasetId, file);
      }
      // Refresh dataset list to update counts and quality score
      const updated = await listVisualDatasets(characterId);
      setDatasets(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  // Drag-and-drop onto a dataset requires a target — for now just support
  // the global drop zone to create a new dataset + upload
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;

    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) {
      setError("请拖入 JPG、PNG 或 WebP 图片文件");
      return;
    }

    setError(null);
    // Create a dataset auto-named by date
    const name = `拖入图片集 ${new Date().toLocaleDateString("zh-CN")}`;
    const ds = await createVisualDataset(characterId, name);
    setDatasets((prev) => [ds, ...prev]);

    setUploading(true);
    try {
      for (const file of imageFiles) {
        await uploadVisualImage(ds.id, file);
      }
      const updated = await listVisualDatasets(characterId);
      setDatasets(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* New dataset form */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
          placeholder="数据集名称（可选）"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5
                     text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none
                     focus:border-indigo-500 transition-colors"
        />
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500
                     disabled:opacity-40 text-xs font-medium text-white transition-colors shrink-0"
        >
          {creating ? "创建中…" : "+ 新建数据集"}
        </button>
      </div>

      {/* Drag & drop zone */}
      <div
        ref={dropZoneRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="rounded-xl border-2 border-dashed border-zinc-700 py-6 text-center
                   hover:border-indigo-600/60 transition-colors"
      >
        {uploading ? (
          <p className="text-xs text-indigo-400">上传中…</p>
        ) : (
          <>
            <p className="text-zinc-500 text-sm">拖入图片自动创建数据集</p>
            <p className="text-zinc-600 text-xs mt-1">支持 JPG / PNG / WebP，可多选</p>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Dataset list */}
      {loading ? (
        <p className="text-zinc-500 text-sm">加载中…</p>
      ) : datasets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-700 py-8 text-center">
          <p className="text-zinc-500 text-sm">还没有图片数据集</p>
          <p className="text-zinc-600 text-xs mt-1">新建数据集或直接拖入图片开始</p>
        </div>
      ) : (
        <div className="space-y-2">
          {datasets.map((ds) => (
            <DatasetCard
              key={ds.id}
              dataset={ds}
              onDelete={handleDelete}
              onUpload={handleUpload}
            />
          ))}
        </div>
      )}
    </div>
  );
}
