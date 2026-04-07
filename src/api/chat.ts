const API_BASE = "http://127.0.0.1:8000";

export type ChatSession = {
  id: string;
  characterId: string;
  llmModelId: string | null;
  baseModelName: string | null;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type SSEEvent =
  | { type: "chunk"; content: string }
  | { type: "done"; messageId: string | null }
  | { type: "error"; message: string };

function extractDetail(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "detail" in body &&
    typeof (body as Record<string, unknown>).detail === "string"
  ) {
    return (body as Record<string, unknown>).detail as string;
  }
  return "操作失败，请稍后重试";
}

export async function createChatSession(
  characterId: string,
  llmModelId?: string | null,
  baseModelName?: string | null,
  signal?: AbortSignal,
): Promise<ChatSession> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/chats`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        llmModelId: llmModelId ?? null,
        baseModelName: baseModelName ?? null,
      }),
      signal,
    },
  );
  const body = await resp.json();
  if (!resp.ok) throw new Error(extractDetail(body));
  return body as ChatSession;
}

export async function listChatSessions(
  characterId: string,
  signal?: AbortSignal,
): Promise<ChatSession[]> {
  const resp = await fetch(
    `${API_BASE}/api/characters/${encodeURIComponent(characterId)}/chats`,
    { signal },
  );
  if (!resp.ok) throw new Error("加载对话列表失败");
  return (await resp.json()) as ChatSession[];
}

export async function getChatMessages(
  chatId: string,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const resp = await fetch(
    `${API_BASE}/api/chats/${encodeURIComponent(chatId)}/messages`,
    { signal },
  );
  if (!resp.ok) throw new Error("加载消息历史失败");
  return (await resp.json()) as ChatMessage[];
}

export async function deleteChatSession(
  chatId: string,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(
    `${API_BASE}/api/chats/${encodeURIComponent(chatId)}`,
    { method: "DELETE", signal },
  );
  if (!resp.ok && resp.status !== 204) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(extractDetail(body));
  }
}

/**
 * Stream a chat message. Calls onChunk for each text chunk, returns the
 * final assistant message ID (or null). Throws on network/API errors.
 */
export async function streamChatMessage(
  chatId: string,
  content: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  images?: string[],
): Promise<string | null> {
  const payload: { content: string; images?: string[] } = { content };
  if (Array.isArray(images) && images.length > 0) {
    payload.images = images;
  }
  const resp = await fetch(
    `${API_BASE}/api/chats/${encodeURIComponent(chatId)}/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  );

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(extractDetail(body));
  }

  if (!resp.body) throw new Error("服务器未返回数据流");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let messageId: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        const event = JSON.parse(raw) as SSEEvent;
        if (event.type === "chunk") {
          onChunk(event.content);
        } else if (event.type === "done") {
          messageId = event.messageId;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  return messageId;
}
