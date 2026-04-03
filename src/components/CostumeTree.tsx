import { useCallback, useEffect, useState } from "react";

import {
  deleteCostume,
  fetchCostumes,
  type CostumeResponse,
  type CostumeTreeResponse,
} from "../api/costumes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: CostumeTreeResponse };

interface Props {
  characterId: string;
  onSelectCostume: (costume: CostumeResponse) => void;
  selectedCostumeId?: string;
  onAddChild?: (parentCostume: CostumeResponse) => void;
  onRefreshNeeded?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a depth map: costumeId -> depth (0 = root level) */
function buildDepthMap(costumes: CostumeResponse[]): Map<string, number> {
  const map = new Map<string, number>();
  const idSet = new Set(costumes.map((c) => c.id));

  function getDepth(costume: CostumeResponse): number {
    if (map.has(costume.id)) return map.get(costume.id)!;
    if (costume.parentId === null || !idSet.has(costume.parentId)) {
      map.set(costume.id, 0);
      return 0;
    }
    const parent = costumes.find((c) => c.id === costume.parentId);
    const parentDepth = parent ? getDepth(parent) : 0;
    const depth = Math.min(parentDepth + 1, 2);
    map.set(costume.id, depth);
    return depth;
  }

  for (const c of costumes) getDepth(c);
  return map;
}

/** Sort costumes: roots first, then children ordered under their parent */
function sortCostumes(costumes: CostumeResponse[]): CostumeResponse[] {
  const rootCostumes = costumes.filter((c) => c.parentId === null || c.isRoot);
  const childrenMap = new Map<string, CostumeResponse[]>();

  for (const c of costumes) {
    if (c.parentId !== null && !c.isRoot) {
      const siblings = childrenMap.get(c.parentId) ?? [];
      siblings.push(c);
      childrenMap.set(c.parentId, siblings);
    }
  }

  const result: CostumeResponse[] = [];

  function appendWithChildren(costume: CostumeResponse) {
    result.push(costume);
    const children = childrenMap.get(costume.id) ?? [];
    for (const child of children) appendWithChildren(child);
  }

  for (const root of rootCostumes) appendWithChildren(root);

  // Append any orphaned items not already added
  for (const c of costumes) {
    if (!result.includes(c)) result.push(c);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CostumeTree({
  characterId,
  onSelectCostume,
  selectedCostumeId,
  onAddChild,
  onRefreshNeeded,
}: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState({ kind: "loading" });
    try {
      const data = await fetchCostumes(characterId);
      setLoadState({ kind: "ready", data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "造型列表加载失败，请稍后重试";
      setLoadState({ kind: "error", message });
    }
  }, [characterId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(costume: CostumeResponse, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`确认删除造型「${costume.name}」？此操作不可撤销。`)) return;

    setDeletingId(costume.id);
    try {
      await deleteCostume(costume.id);
      onRefreshNeeded?.();
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "造型删除失败，请稍后重试";
      alert(message);
    } finally {
      setDeletingId(null);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-gray-400">
        <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
        加载造型中…
      </div>
    );
  }

  if (loadState.kind === "error") {
    return (
      <div className="flex flex-col gap-2 p-3">
        <p className="text-sm text-red-400">{loadState.message}</p>
        <button
          type="button"
          onClick={load}
          className="text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 w-fit"
        >
          重试
        </button>
      </div>
    );
  }

  const { costumes } = loadState.data;
  const depthMap = buildDepthMap(costumes);
  const sorted = sortCostumes(costumes);

  if (sorted.length === 0) {
    return (
      <p className="p-3 text-sm text-gray-500">暂无造型，请先新建根造型。</p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {sorted.map((costume) => {
        const depth = depthMap.get(costume.id) ?? 0;
        const isSelected = costume.id === selectedCostumeId;
        const isDeleting = deletingId === costume.id;

        return (
          <li
            key={costume.id}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            className={`flex items-center gap-2 pr-2 py-1.5 cursor-pointer rounded text-sm transition-colors ${
              isSelected
                ? "bg-blue-600/30 text-blue-200"
                : "hover:bg-gray-700/60 text-gray-300"
            }`}
            onClick={() => onSelectCostume(costume)}
          >
            {/* Root indicator */}
            {costume.isRoot && (
              <span className="text-yellow-400 text-xs" title="根造型">
                &#x1F512;
              </span>
            )}

            {/* Name */}
            <span className="flex-1 truncate">
              {costume.name}
              {costume.isRoot && (
                <span className="ml-1 text-xs text-yellow-500">(根)</span>
              )}
            </span>

            {/* Preview count badge */}
            {costume.previewCount > 0 && (
              <span className="text-xs bg-gray-700 text-gray-400 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {costume.previewCount}
              </span>
            )}

            {/* Add child button — only on selected non-root */}
            {isSelected && !costume.isRoot && onAddChild && (
              <button
                type="button"
                title="新建子造型"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddChild(costume);
                }}
                className="text-xs text-blue-400 hover:text-blue-300 px-1"
              >
                +子
              </button>
            )}

            {/* Delete button — only on non-root */}
            {!costume.isRoot && (
              <button
                type="button"
                title="删除造型"
                disabled={isDeleting}
                onClick={(e) => handleDelete(costume, e)}
                className="text-xs text-gray-500 hover:text-red-400 disabled:opacity-40 px-1"
              >
                {isDeleting ? "…" : "✕"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
