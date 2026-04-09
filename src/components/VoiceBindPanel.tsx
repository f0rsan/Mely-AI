import { useEffect, useRef, useState } from "react";

import {
  extractVoiceprint,
  fetchVoiceStatus,
  uploadReferenceAudio,
} from "../api/voice";
import { TTSEngineStatusBadge } from "./TTSEngineStatusBadge";

type VoiceBindState =
  | { kind: "loading" }
  | { kind: "unbound" }
  | { kind: "uploading"; progress: number }
  | { kind: "extracting"; taskId: string }
  | { kind: "bound"; boundAt: string }
  | { kind: "error"; message: string };

type Props = {
  characterId: string;
};

const ALLOWED_EXT = ".wav";

export function VoiceBindPanel({ characterId }: Props) {
  const [state, setState] = useState<VoiceBindState>({ kind: "loading" });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial status
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const status = await fetchVoiceStatus(characterId);
        if (cancelled) return;

        if (status.status === "bound") {
          setState({ kind: "bound", boundAt: status.boundAt ?? "" });
        } else if (status.status === "extracting") {
          setState({ kind: "extracting", taskId: "" });
          startPolling();
        } else {
          setState({ kind: "unbound" });
        }
      } catch {
        if (!cancelled) setState({ kind: "unbound" });
      }
    }

    load();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [characterId]);

  function startPolling() {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const status = await fetchVoiceStatus(characterId);
        if (status.status === "bound") {
          stopPolling();
          setState({ kind: "bound", boundAt: status.boundAt ?? "" });
        } else if (status.status === "failed") {
          stopPolling();
          setState({ kind: "error", message: "声纹提取失败，请重新上传参考音频" });
        }
      } catch {
        // keep polling
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function handleFile(file: File) {
    if (!isWavFile(file)) {
      setState({ kind: "error", message: "当前仅支持 WAV 参考音频，请先转换后再上传" });
      return;
    }

    // Basic duration estimation: just use a nominal value — the backend validates.
    // For a real impl this would use the Web Audio API to get actual duration.
    // We use a default of 10s if we can't determine it.
    let durationSeconds = 10;
    try {
      durationSeconds = await getAudioDuration(file);
    } catch {
      // use default
    }

    setState({ kind: "uploading", progress: 0 });

    try {
      await uploadReferenceAudio(characterId, file, durationSeconds);
      setState({ kind: "uploading", progress: 50 });

      await extractVoiceprint(characterId);
      setState({ kind: "extracting", taskId: "" });
      startPolling();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "上传失败，请重试";
      setState({ kind: "error", message: msg });
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleReset() {
    stopPolling();
    setState({ kind: "unbound" });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <TTSEngineStatusBadge />

      <div className="rounded-lg border border-yellow-800/60 bg-yellow-950/30 px-3 py-3 text-xs leading-6 text-yellow-100">
        当前声音绑定用于验证上传、绑定和合成链路是否跑通；声纹提取仍是轻量联调，不建议把它当作最终成品效果。
      </div>

      <div className="border border-gray-700 rounded-lg p-4 bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">声音绑定</h3>

        {state.kind === "loading" && (
          <p className="text-sm text-gray-400">加载中…</p>
        )}

        {state.kind === "unbound" && (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-blue-500 bg-blue-500/10"
                : "border-gray-600 hover:border-gray-500"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_EXT}
              className="hidden"
              onChange={handleFileInput}
            />
            <p className="text-sm text-gray-300 mb-1">拖拽或点击上传参考音频</p>
            <p className="text-xs text-gray-500">
              当前仅支持 WAV · 时长 3–30 秒
            </p>
          </div>
        )}

        {state.kind === "uploading" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-300">正在上传…</p>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${state.progress}%` }}
              />
            </div>
          </div>
        )}

        {state.kind === "extracting" && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-300">声纹提取中，请稍候…</p>
          </div>
        )}

        {state.kind === "bound" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-green-400 text-sm">✓ 声音绑定成功</span>
            </div>
            {state.boundAt && (
              <p className="text-xs text-gray-500">
                绑定时间：{new Date(state.boundAt).toLocaleString("zh-CN")}
              </p>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 w-fit mt-1"
            >
              重新绑定
            </button>
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-red-400">{state.message}</p>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs px-3 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 w-fit"
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helper: get audio duration via Web Audio API
// ---------------------------------------------------------------------------

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取音频时长"));
    });
  });
}

function isWavFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === "audio/wav" || name.endsWith(".wav");
}
