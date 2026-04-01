import { useCallback, useEffect, useState } from "react";

import {
  fetchCostumePreviews,
  generateCostumePreviews,
  type CostumePreviewResponse,
  type CostumeResponse,
} from "../api/costumes";
import { CostumeTree } from "./CostumeTree";
import { NewCostumeModal } from "./NewCostumeModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  characterId: string;
}

type ModalState =
  | { kind: "hidden" }
  | { kind: "new-root" }
  | { kind: "new-child"; parentId: string };

type PreviewLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; previews: CostumePreviewResponse[] };

type GenerateState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "accepted"; taskIds: string[] }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CostumeWorkspace({ characterId }: Props) {
  const [selectedCostume, setSelectedCostume] = useState<CostumeResponse | null>(null);
  const [modalState, setModalState] = useState<ModalState>({ kind: "hidden" });
  const [previewState, setPreviewState] = useState<PreviewLoadState>({ kind: "idle" });
  const [generateState, setGenerateState] = useState<GenerateState>({ kind: "idle" });
  // Increment to force CostumeTree to re-mount/reload
  const [treeKey, setTreeKey] = useState(0);

  const loadPreviews = useCallback(async (costumeId: string) => {
    setPreviewState({ kind: "loading" });
    try {
      const result = await fetchCostumePreviews(costumeId);
      setPreviewState({ kind: "ready", previews: result.previews });
    } catch (err) {
      const message = err instanceof Error ? err.message : "预览图加载失败，请稍后重试";
      setPreviewState({ kind: "error", message });
    }
  }, []);

  useEffect(() => {
    if (selectedCostume) {
      setGenerateState({ kind: "idle" });
      loadPreviews(selectedCostume.id);
    } else {
      setPreviewState({ kind: "idle" });
    }
  }, [selectedCostume, loadPreviews]);

  function handleSelectCostume(costume: CostumeResponse) {
    setSelectedCostume(costume);
  }

  function handleAddChild(parentCostume: CostumeResponse) {
    setModalState({ kind: "new-child", parentId: parentCostume.id });
  }

  function handleRefreshNeeded() {
    // If the selected costume was deleted, deselect it
    setSelectedCostume(null);
  }

  async function handleGeneratePreviews() {
    if (!selectedCostume || generateState.kind === "submitting") return;

    setGenerateState({ kind: "submitting" });
    try {
      const result = await generateCostumePreviews(selectedCostume.id);
      setGenerateState({ kind: "accepted", taskIds: result.taskIds });
    } catch (err) {
      const message = err instanceof Error ? err.message : "预览图生成请求失败，请稍后重试";
      setGenerateState({ kind: "error", message });
    }
  }

  function handleCostumeCreated(costume: CostumeResponse) {
    setModalState({ kind: "hidden" });
    // Refresh the tree
    setTreeKey((k) => k + 1);
    // Auto-select the newly created costume
    setSelectedCostume(costume);
  }

  const modalParentId =
    modalState.kind === "new-child" ? modalState.parentId : undefined;

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel: tree */}
      <div className="w-64 flex-shrink-0 border-r border-gray-700 flex flex-col bg-gray-900">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200">造型树</h3>
          <button
            type="button"
            onClick={() => setModalState({ kind: "new-root" })}
            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            新建根造型
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          <CostumeTree
            key={treeKey}
            characterId={characterId}
            onSelectCostume={handleSelectCostume}
            selectedCostumeId={selectedCostume?.id}
            onAddChild={handleAddChild}
            onRefreshNeeded={handleRefreshNeeded}
          />
        </div>
      </div>

      {/* Right panel: detail */}
      <div className="flex-1 min-w-0 flex flex-col bg-gray-950 p-4 gap-4 overflow-y-auto">
        {selectedCostume === null ? (
          <div className="flex flex-col items-center justify-center flex-1 text-gray-500">
            <p className="text-sm">请从左侧选择一个造型</p>
          </div>
        ) : (
          <>
            {/* Costume info */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-100">
                  {selectedCostume.name}
                </h2>
                {selectedCostume.isRoot && (
                  <span className="text-xs bg-yellow-900/50 text-yellow-400 rounded px-1.5 py-0.5">
                    根造型
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 font-mono break-all">
                {selectedCostume.costumePrompt}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Generate previews */}
              <button
                type="button"
                onClick={handleGeneratePreviews}
                disabled={generateState.kind === "submitting"}
                className="text-sm px-3 py-1.5 rounded bg-green-700 text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {generateState.kind === "submitting" ? "提交中…" : "生成预览图"}
              </button>

              {/* Add child costume */}
              {!selectedCostume.isRoot && (
                <button
                  type="button"
                  onClick={() => handleAddChild(selectedCostume)}
                  className="text-sm px-3 py-1.5 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                >
                  新建子造型
                </button>
              )}

              {selectedCostume.isRoot && (
                <button
                  type="button"
                  onClick={() => handleAddChild(selectedCostume)}
                  className="text-sm px-3 py-1.5 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                >
                  新建子造型
                </button>
              )}
            </div>

            {/* Generate state feedback */}
            {generateState.kind === "accepted" && (
              <div className="text-xs text-green-400 bg-green-900/20 border border-green-800 rounded p-2">
                <p>预览图生成任务已提交！</p>
                <p className="text-gray-500 mt-0.5">
                  任务 ID: {generateState.taskIds.join(", ")}
                </p>
              </div>
            )}
            {generateState.kind === "error" && (
              <p className="text-sm text-red-400">{generateState.message}</p>
            )}

            {/* Previews section */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  预览图
                </h4>
                {previewState.kind === "ready" && (
                  <button
                    type="button"
                    onClick={() => loadPreviews(selectedCostume.id)}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    刷新
                  </button>
                )}
              </div>

              {previewState.kind === "loading" && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                  加载预览图…
                </div>
              )}

              {previewState.kind === "error" && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-red-400">{previewState.message}</p>
                  <button
                    type="button"
                    onClick={() => loadPreviews(selectedCostume.id)}
                    className="text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
                  >
                    重试
                  </button>
                </div>
              )}

              {previewState.kind === "ready" && (
                <div className="grid grid-cols-3 gap-2">
                  {previewState.previews.length === 0 ? (
                    /* Placeholder squares when no previews */
                    Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="aspect-square bg-gray-800 border border-gray-700 rounded flex items-center justify-center text-xs text-gray-600"
                      >
                        暂无图片
                      </div>
                    ))
                  ) : (
                    previewState.previews.map((preview) => (
                      <div
                        key={preview.id}
                        className="aspect-square bg-gray-800 border border-gray-700 rounded overflow-hidden"
                      >
                        <img
                          src={`http://127.0.0.1:8000${preview.imagePath}`}
                          alt="造型预览"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal */}
      {modalState.kind !== "hidden" && (
        <NewCostumeModal
          characterId={characterId}
          parentId={modalParentId}
          onCreated={handleCostumeCreated}
          onClose={() => setModalState({ kind: "hidden" })}
        />
      )}
    </div>
  );
}
