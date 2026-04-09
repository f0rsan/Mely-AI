import { useEffect, useRef, useState } from "react";

import { synthesizeSpeech } from "../api/voice";
import { type TaskEvent, createTaskStream } from "../api/tasks";
import { TTSEngineStatusBadge } from "./TTSEngineStatusBadge";

type TTSGenerateState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "generating"; taskId: string; progress: number; message: string }
  | { kind: "done"; taskId: string }
  | { kind: "failed"; message: string };

const LANGUAGE_OPTIONS = [
  { value: "zh", label: "中文" },
  { value: "en", label: "英文" },
  { value: "zh-en", label: "中英混合" },
];

const MAX_CHARS = 500;

type Props = {
  characterId: string;
  onViewHistory?: () => void;
};

export function TTSGeneratePanel({ characterId, onViewHistory }: Props) {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("zh");
  const [speed, setSpeed] = useState(1.0);
  const [genState, setGenState] = useState<TTSGenerateState>({ kind: "idle" });
  const destroyStreamRef = useRef<(() => void) | null>(null);

  // Clean up WS on unmount
  useEffect(() => {
    return () => {
      destroyStreamRef.current?.();
    };
  }, []);

  // Subscribe to task stream when generating
  useEffect(() => {
    if (genState.kind !== "generating") return;

    const { taskId } = genState;

    const destroy = createTaskStream((event: TaskEvent) => {
      if (event.task.id !== taskId) return;

      if (event.task.status === "completed") {
        destroy();
        setGenState({ kind: "done", taskId });
      } else if (event.task.status === "failed") {
        destroy();
        setGenState({
          kind: "failed",
          message: event.task.error ?? "语音合成失败，请稍后重试",
        });
      } else {
        setGenState((prev) =>
          prev.kind === "generating"
            ? { ...prev, progress: event.task.progress, message: event.task.message ?? "" }
            : prev
        );
      }
    });

    destroyStreamRef.current = destroy;
    return () => {
      destroy();
      destroyStreamRef.current = null;
    };
  }, [genState.kind === "generating" ? genState.taskId : null]);

  async function handleSubmit() {
    if (!text.trim() || genState.kind === "submitting" || genState.kind === "generating") return;

    setGenState({ kind: "submitting" });

    try {
      const result = await synthesizeSpeech({ characterId, text: text.trim(), language, speed });
      setGenState({ kind: "generating", taskId: result.taskId, progress: 0, message: "语音合成任务已进入队列" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "语音合成请求失败，请稍后重试";
      setGenState({ kind: "failed", message: msg });
    }
  }

  function handleRetry() {
    setGenState({ kind: "idle" });
  }

  const isSubmitting = genState.kind === "submitting" || genState.kind === "generating";
  const canSubmit = text.trim().length > 0 && !isSubmitting;

  return (
    <div className="flex flex-col gap-4 p-4">
      <TTSEngineStatusBadge />

      <div className="rounded-lg border border-yellow-800/60 bg-yellow-950/30 px-3 py-3 text-xs leading-6 text-yellow-100">
        当前语音能力适合先验证本地 TTS 引擎和任务流；如果你还没有完成声音绑定或模型准备，先不要把它当成最终交付路径。
      </div>

      <div className="border border-gray-700 rounded-lg p-4 bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">语音合成</h3>

        <div className="flex flex-col gap-3">
          {/* Text input */}
          <div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
              disabled={isSubmitting}
              placeholder="输入想让角色说的话，最多 500 字"
              rows={4}
              className="w-full bg-gray-800 text-gray-200 text-sm rounded border border-gray-600 p-2 resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <p className="text-xs text-gray-500 text-right">{text.length}/{MAX_CHARS}</p>
          </div>

          {/* Language + Speed row */}
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 whitespace-nowrap">语言</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isSubmitting}
                className="text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1 disabled:opacity-50"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 flex-1">
              <label className="text-xs text-gray-400 whitespace-nowrap">
                语速 {speed.toFixed(1)}x
              </label>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                disabled={isSubmitting}
                className="flex-1 accent-blue-500 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="text-sm px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700 transition-colors w-fit"
          >
            {isSubmitting ? "合成中…" : "开始合成"}
          </button>

          {/* Progress */}
          {genState.kind === "generating" && (
            <div className="flex flex-col gap-1">
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${genState.progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400">{genState.message}</p>
            </div>
          )}

          {/* Done */}
          {genState.kind === "done" && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-400">✓ 语音合成完成！</span>
              {onViewHistory && (
                <button
                  type="button"
                  onClick={onViewHistory}
                  className="text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
                >
                  查看历史
                </button>
              )}
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                再合成一段
              </button>
            </div>
          )}

          {/* Failed */}
          {genState.kind === "failed" && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-red-400">{genState.message}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
