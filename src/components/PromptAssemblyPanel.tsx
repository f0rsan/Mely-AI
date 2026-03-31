import { useEffect, useRef, useState } from "react";

import {
  type AssembledPromptResponse,
  type PromptAssembleRequest,
  assemblePrompt,
} from "../api/prompt";

type Props = {
  /** Base prompt sources from the generation workbench contract. */
  dnaPrompt: string;
  triggerWord: string;
  costumePrompt: string;
  /** Called when the user confirms the prompt (assembled or overridden). */
  onConfirm?: (prompt: string, wasOverridden: boolean) => void;
};

export function PromptAssemblyPanel({
  dnaPrompt,
  triggerWord,
  costumePrompt,
  onConfirm,
}: Props) {
  const [scenePrompt, setScenePrompt] = useState("");
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideText, setOverrideText] = useState("");
  const [result, setResult] = useState<AssembledPromptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleAssemble() {
    if (!scenePrompt.trim() && !overrideMode) return;

    setError(null);
    setLoading(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const request: PromptAssembleRequest = {
      scenePrompt: overrideMode ? "placeholder" : scenePrompt,
      dnaPrompt,
      triggerWord,
      costumePrompt,
      overridePrompt: overrideMode ? overrideText : null,
    };

    try {
      const res = await assemblePrompt(request, abortRef.current.signal);
      setResult(res);
    } catch (err) {
      if (err instanceof Error && err.message !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  // Auto-assemble when scene prompt changes (debounced).
  useEffect(() => {
    if (!scenePrompt.trim()) {
      setResult(null);
      return;
    }
    const id = setTimeout(handleAssemble, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenePrompt, dnaPrompt, triggerWord, costumePrompt]);

  function handleConfirm() {
    if (!result) return;
    onConfirm?.(result.assembled, result.wasOverridden);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Scene input */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">场景描述</label>
        <textarea
          className="w-full rounded bg-gray-800 border border-gray-700 text-sm text-white p-2 resize-none"
          rows={2}
          placeholder="例如：在直播封面中微笑看向镜头"
          value={scenePrompt}
          onChange={(e) => setScenePrompt(e.target.value)}
          disabled={overrideMode}
        />
      </div>

      {/* Assembled result */}
      {result && !overrideMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              组装结果 · {result.tokenCount} tokens
            </span>
            <button
              type="button"
              className="text-xs text-blue-400 hover:text-blue-300"
              onClick={() => {
                setOverrideMode(true);
                setOverrideText(result.assembled);
              }}
            >
              高级模式（手动编辑）
            </button>
          </div>

          <div className="rounded bg-gray-900 border border-gray-700 p-2 text-sm text-gray-200 break-all">
            {result.assembled || <span className="text-gray-500">（空）</span>}
          </div>

          {/* Component breakdown */}
          <div className="flex flex-col gap-1">
            {result.components.map((comp) => (
              <div key={comp.source} className="flex gap-2 items-baseline">
                <span
                  className={`text-xs w-20 shrink-0 ${comp.active ? "text-gray-400" : "text-gray-600 line-through"}`}
                >
                  {comp.label}
                </span>
                <span
                  className={`text-xs break-all ${comp.active ? "text-gray-300" : "text-gray-600"}`}
                >
                  {comp.content || "（无）"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Override mode */}
      {overrideMode && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">完整 Prompt（手动编辑）</label>
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-gray-300"
              onClick={() => {
                setOverrideMode(false);
                setOverrideText("");
              }}
            >
              恢复自动组装
            </button>
          </div>
          <textarea
            className="w-full rounded bg-gray-800 border border-blue-600 text-sm text-white p-2 resize-none"
            rows={4}
            value={overrideText}
            onChange={(e) => setOverrideText(e.target.value)}
          />
          <button
            type="button"
            className="self-end text-xs px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={!overrideText.trim()}
            onClick={async () => {
              setError(null);
              setLoading(true);
              try {
                const res = await assemblePrompt({
                  scenePrompt: "placeholder",
                  overridePrompt: overrideText,
                });
                setResult(res);
              } catch (err) {
                if (err instanceof Error) setError(err.message);
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "处理中…" : "应用"}
          </button>
          {result?.wasOverridden && (
            <div className="rounded bg-gray-900 border border-gray-700 p-2 text-sm text-gray-200 break-all">
              {result.assembled}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {loading && !overrideMode && (
        <p className="text-xs text-gray-500">正在组装 Prompt…</p>
      )}

      {/* Confirm button */}
      {result && (
        <button
          type="button"
          className="self-start text-sm px-4 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
          disabled={!result.assembled.trim()}
          onClick={handleConfirm}
        >
          使用此 Prompt
        </button>
      )}
    </div>
  );
}
