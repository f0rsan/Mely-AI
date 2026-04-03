import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChatMessage,
  ChatSession,
  createChatSession,
  deleteChatSession,
  getChatMessages,
  listChatSessions,
  streamChatMessage,
} from "../api/chat";

type Props = {
  characterId: string;
  /** Ollama model name to use (from a private model). null = base model. */
  llmModelId?: string | null;
  characterName?: string;
};

function MessageBubble({ msg }: { msg: ChatMessage | { role: "assistant"; content: string; id?: string; streaming?: boolean } }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-indigo-600 text-white rounded-br-sm"
            : "bg-zinc-700 text-zinc-100 rounded-bl-sm"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        {"streaming" in msg && msg.streaming && (
          <span className="inline-block w-1.5 h-4 bg-zinc-400 animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-zinc-700 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ChatPanel({ characterId, llmModelId, characterName }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => { scrollToBottom(); }, [messages, streamingContent]);

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    try {
      const data = await listChatSessions(characterId);
      setSessions(data);
    } catch {
      // non-fatal
    }
  }, [characterId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    setLoadingHistory(true);
    getChatMessages(activeChatId)
      .then(setMessages)
      .catch(() => setError("加载消息历史失败"))
      .finally(() => setLoadingHistory(false));
  }, [activeChatId]);

  const startNewChat = async () => {
    try {
      const session = await createChatSession(characterId, llmModelId);
      setSessions((prev) => [session, ...prev]);
      setActiveChatId(session.id);
      setMessages([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建对话失败");
    }
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    let chatId = activeChatId;
    if (!chatId) {
      try {
        const session = await createChatSession(characterId, llmModelId);
        setSessions((prev) => [session, ...prev]);
        setActiveChatId(session.id);
        chatId = session.id;
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建对话失败");
        return;
      }
    }

    const userText = input.trim();
    setInput("");
    setError(null);
    setSending(true);
    setStreamingContent("");

    // Optimistically add user message to display
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      chatId,
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    abortRef.current = new AbortController();

    try {
      await streamChatMessage(
        chatId,
        userText,
        (chunk) => setStreamingContent((prev) => (prev ?? "") + chunk),
        abortRef.current.signal,
      );
      // Reload full message list to get server-persisted IDs
      const updated = await getChatMessages(chatId);
      setMessages(updated);
      setStreamingContent(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "发送失败，请重试");
      setStreamingContent(null);
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      await deleteChatSession(chatId);
      setSessions((prev) => prev.filter((s) => s.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
      }
    } catch {
      setError("删除失败");
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setSending(false);
    setStreamingContent(null);
  };

  return (
    <div className="flex h-full gap-3 min-h-0">
      {/* Sidebar — chat session list */}
      <div className="w-44 shrink-0 flex flex-col gap-1.5">
        <button
          onClick={startNewChat}
          className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                     text-xs font-medium text-white transition-colors text-left"
        >
          + 新建对话
        </button>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded-lg px-2.5 py-1.5 cursor-pointer text-xs transition-colors ${
                s.id === activeChatId
                  ? "bg-indigo-950/50 text-indigo-300 border border-indigo-800"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              onClick={() => setActiveChatId(s.id)}
            >
              <span className="flex-1 truncate font-mono">{s.id.slice(0, 8)}…</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteChat(s.id); }}
                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800 shrink-0">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {characterName ?? "角色"} 对话
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {llmModelId ? "私有模型" : "基础模型"} · Shift+Enter 换行
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0">
          {!activeChatId && !sending && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-zinc-500 text-sm">开始一段新对话</p>
                <p className="text-zinc-600 text-xs mt-1">直接输入消息或点击「新建对话」</p>
              </div>
            </div>
          )}
          {loadingHistory && (
            <p className="text-zinc-500 text-xs text-center">加载中…</p>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          {sending && streamingContent === "" && <TypingIndicator />}
          {sending && streamingContent !== null && streamingContent !== "" && (
            <MessageBubble
              msg={{ role: "assistant", content: streamingContent, streaming: true }}
            />
          )}
          <div ref={bottomRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="shrink-0 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-300 mb-2">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 flex gap-2 pt-2 border-t border-zinc-800">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息… (Enter 发送)"
            rows={2}
            disabled={sending}
            className="flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-800
                       px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600
                       focus:outline-none focus:border-indigo-500 disabled:opacity-50
                       transition-colors"
          />
          {sending ? (
            <button
              onClick={handleStop}
              className="px-4 rounded-xl bg-red-900/60 hover:bg-red-800/60 border border-red-700
                         text-xs text-red-300 font-medium transition-colors self-end py-2"
            >
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-xs text-white font-medium transition-colors self-end py-2"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
