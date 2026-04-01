import { useEffect, useRef, useState } from "react";

import {
  type TTSEngineState,
  type TTSEngineStatus,
  fetchTTSEngineStatus,
  startTTSEngine,
  stopTTSEngine,
} from "../api/voice";

const STATE_LABEL: Record<TTSEngineState, string> = {
  stopped: "TTS 引擎未启动",
  starting: "TTS 引擎启动中…",
  running: "TTS 引擎运行中",
  crashed: "TTS 引擎崩溃，重启中",
  restarting: "TTS 引擎重启中…",
  failed: "TTS 引擎启动失败",
};

const STATE_COLOR: Record<TTSEngineState, string> = {
  stopped: "text-gray-400",
  starting: "text-blue-400",
  running: "text-green-400",
  crashed: "text-orange-400",
  restarting: "text-orange-400",
  failed: "text-red-500",
};

const TRANSITIONING: TTSEngineState[] = ["starting", "restarting", "crashed"];

type Props = {
  pollIntervalMs?: number;
};

export function TTSEngineStatusBadge({ pollIntervalMs = 5000 }: Props) {
  const [status, setStatus] = useState<TTSEngineStatus>({
    state: "stopped",
    restartCount: 0,
    errorMessage: null,
    pid: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const s = await fetchTTSEngineStatus();
        if (!cancelled) setStatus(s);
      } catch {
        // Silently ignore poll failures.
      }
    }

    poll();
    const id = setInterval(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollIntervalMs]);

  async function handleStart() {
    setActionError(null);
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      const res = await startTTSEngine(abortRef.current.signal);
      setStatus(res.status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "TTS 引擎操作失败，请稍后重试";
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setActionError(null);
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      const res = await stopTTSEngine(abortRef.current.signal);
      setStatus(res.status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "TTS 引擎操作失败，请稍后重试";
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  }

  const isTransitioning = TRANSITIONING.includes(status.state);
  const showStart = status.state === "stopped" || status.state === "failed";
  const showStop = status.state === "running";
  const buttonDisabled = busy || isTransitioning;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className={`text-sm font-medium ${STATE_COLOR[status.state]}`}>
          {STATE_LABEL[status.state]}
        </span>

        {showStart && (
          <button
            type="button"
            disabled={buttonDisabled}
            onClick={handleStart}
            className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            启动 TTS 引擎
          </button>
        )}

        {showStop && (
          <button
            type="button"
            disabled={buttonDisabled}
            onClick={handleStop}
            className="text-xs px-2 py-0.5 rounded bg-gray-600 text-white disabled:opacity-50"
          >
            停止 TTS 引擎
          </button>
        )}

        {isTransitioning && (
          <button
            type="button"
            disabled
            className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-400 opacity-50"
          >
            处理中…
          </button>
        )}
      </div>

      {status.state === "failed" && status.errorMessage && (
        <p className="text-xs text-red-400">{status.errorMessage}</p>
      )}

      {actionError && <p className="text-xs text-red-400">{actionError}</p>}
    </div>
  );
}
