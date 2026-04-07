const API_BASE = "http://127.0.0.1:8000";

export type LLMPullEvent = {
  status: string;
  phase?: string;
  digest?: string;
  total?: number;
  completed?: number;
  percent?: number;
  message?: string;
};

function extractDetail(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as Record<string, unknown>).detail === "string"
  ) {
    return (body as Record<string, unknown>).detail as string;
  }
  return "模型下载失败，请稍后重试";
}

export async function pullLLMModel(
  modelName: string,
  onEvent: (event: LLMPullEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/llm/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelName }),
    signal,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(extractDetail(body));
  }

  if (!resp.body) {
    throw new Error("模型下载失败，请稍后重试");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }
      const raw = line.slice(6).trim();
      if (!raw) {
        continue;
      }
      let event: LLMPullEvent;
      try {
        event = JSON.parse(raw) as LLMPullEvent;
      } catch {
        continue;
      }
      onEvent(event);
      if (event.status === "error") {
        throw new Error(event.message ?? "模型下载失败，请稍后重试");
      }
    }
  }
}
