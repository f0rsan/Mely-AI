import { useState } from "react";

import { createCostume, type CostumeResponse } from "../api/costumes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

interface Props {
  characterId: string;
  parentId?: string;
  onCreated: (costume: CostumeResponse) => void;
  onClose: () => void;
}

const MAX_NAME_LENGTH = 50;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewCostumeModal({ characterId, parentId, onCreated, onClose }: Props) {
  const [name, setName] = useState("");
  const [costumePrompt, setCostumePrompt] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  const isSubmitting = submitState.kind === "submitting";
  const canSubmit = name.trim().length > 0 && costumePrompt.trim().length > 0 && !isSubmitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitState({ kind: "submitting" });

    try {
      const costume = await createCostume(characterId, {
        name: name.trim(),
        costumePrompt: costumePrompt.trim(),
        ...(parentId !== undefined ? { parentId } : {}),
      });
      onCreated(costume);
    } catch (err) {
      const message = err instanceof Error ? err.message : "造型创建失败，请稍后重试";
      setSubmitState({ kind: "error", message });
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-100">
            {parentId !== undefined ? "新建子造型" : "新建根造型"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-500 hover:text-gray-300 disabled:opacity-40 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Parent ID hint */}
        {parentId !== undefined && (
          <p className="text-xs text-gray-500">
            父造型 ID: <span className="font-mono text-gray-400">{parentId}</span>
          </p>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">造型名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
              disabled={isSubmitting}
              placeholder="例：日常便服、战斗形态"
              className="bg-gray-800 text-gray-200 text-sm rounded border border-gray-600 px-3 py-2 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <p className="text-xs text-gray-600 text-right">
              {name.length}/{MAX_NAME_LENGTH}
            </p>
          </div>

          {/* Prompt */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">造型 Prompt *</label>
            <textarea
              value={costumePrompt}
              onChange={(e) => setCostumePrompt(e.target.value)}
              disabled={isSubmitting}
              placeholder="描述造型的外观关键词，例：white dress, blue ribbon, casual outfit"
              rows={4}
              className="bg-gray-800 text-gray-200 text-sm rounded border border-gray-600 px-3 py-2 resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>

          {/* Error */}
          {submitState.kind === "error" && (
            <p className="text-sm text-red-400">{submitState.message}</p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-sm px-4 py-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="text-sm px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? "创建中…" : "创建"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
