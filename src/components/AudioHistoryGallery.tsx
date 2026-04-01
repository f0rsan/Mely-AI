import { useCallback, useEffect, useState } from "react";

import { fetchGenerationArchives } from "../api/archive";

const API_BASE_URL = "http://127.0.0.1:8000";

type AudioRecord = {
  id: string;
  characterId: string;
  paramsSnapshot: Record<string, unknown>;
  createdAt: string;
};

type Props = {
  characterId: string;
};

function audioUrl(generationId: string): string {
  return `${API_BASE_URL}/api/generations/${generationId}/audio`;
}

function extractText(snapshot: Record<string, unknown>): string {
  const text = snapshot["text"];
  if (typeof text === "string") return text;
  return "";
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("zh-CN");
  } catch {
    return isoString;
  }
}

export function AudioHistoryGallery({ characterId }: Props) {
  const [records, setRecords] = useState<AudioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useCallback(
    (el: HTMLAudioElement | null) => {
      if (el) {
        el.onended = () => setPlayingId(null);
        el.onerror = () => setPlayingId(null);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchGenerationArchives(characterId);
        if (!cancelled) {
          // Filter to audio type only — backend returns all types
          const audioItems = result.items.filter(
            (r) => (r.paramsSnapshot as Record<string, unknown>)["ttsEngine"] !== undefined
          );
          setRecords(audioItems);
        }
      } catch {
        if (!cancelled) setError("历史记录加载失败，请稍后重试。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  function handlePlay(id: string) {
    setPlayingId(id);
  }

  if (loading) {
    return (
      <div role="status" className="text-sm text-gray-500 py-4 text-center">
        正在加载历史记录…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400 py-4">{error}</p>;
  }

  if (records.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center">
        还没有语音合成记录，去「生成」标签合成一段吧
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {records.map((record) => {
        const text = extractText(record.paramsSnapshot);
        const isPlaying = playingId === record.id;

        return (
          <div
            key={record.id}
            className="flex items-start gap-3 border border-gray-700 rounded-lg p-3 bg-gray-900"
          >
            {/* Play button */}
            <button
              type="button"
              onClick={() => handlePlay(record.id)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 text-xs"
              title="播放"
            >
              {isPlaying ? "■" : "▶"}
            </button>

            {/* Hidden audio element for playing */}
            {isPlaying && (
              <audio
                ref={audioRef}
                src={audioUrl(record.id)}
                autoPlay
                className="hidden"
              />
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              {text && (
                <p className="text-sm text-gray-200 truncate" title={text}>
                  {text}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-0.5">{formatDate(record.createdAt)}</p>
            </div>

            {/* Download */}
            <a
              href={audioUrl(record.id)}
              download={`voice-${record.id}.wav`}
              className="shrink-0 text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
            >
              下载
            </a>
          </div>
        );
      })}
    </div>
  );
}
