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
import { fetchLLMCatalog, type LLMCatalogItem } from "../api/llmCatalog";
import { fetchCharacterLLMPreferences } from "../api/llmPreferences";
import { fetchLLMRuntime } from "../api/llmRuntime";

type Props = {
  characterId: string;
  /** Ollama model name to use (from a private model). null = base model. */
  llmModelId?: string | null;
  characterName?: string;
  chatDisabledReason?: string | null;
};

const DEFAULT_BASE_MODEL_NAME = "qwen2.5:7b-instruct-q4_K_M";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type BaseModelOption = {
  modelName: string;
  displayName: string;
  visionCapable: boolean;
};

type SelectedImage = {
  name: string;
  dataUrl: string;
  base64: string;
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("图片读取失败，请重试。"));
      }
    };
    reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
}

function resolveAvailableBaseModels(
  catalogItems: LLMCatalogItem[],
  installedModelNames: Set<string>,
): BaseModelOption[] {
  return catalogItems
    .filter((item) => installedModelNames.has(item.modelName))
    .map((item) => ({
      modelName: item.modelName,
      displayName: item.displayName,
      visionCapable: item.visionCapable,
    }));
}

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

export function ChatPanel({ characterId, llmModelId, characterName, chatDisabledReason }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [catalogByModelName, setCatalogByModelName] = useState<Record<string, LLMCatalogItem>>({});
  const [availableBaseModels, setAvailableBaseModels] = useState<BaseModelOption[]>([]);
  const [characterDefaultBaseModelName, setCharacterDefaultBaseModelName] = useState<string | null>(null);
  const [selectedBaseModelName, setSelectedBaseModelName] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeSession = activeChatId ? sessions.find((session) => session.id === activeChatId) ?? null : null;
  const noAvailableBaseModel = !llmModelId && availableBaseModels.length === 0;
  const effectiveChatDisabledReason =
    chatDisabledReason
    ?? (noAvailableBaseModel ? "未检测到可用基础模型，请先在模型库下载后再试。" : null);
  const chatDisabled =
    typeof effectiveChatDisabledReason === "string" && effectiveChatDisabledReason.trim().length > 0;

  const resolveVisionCapability = useCallback((modelName: string | null | undefined) => {
    if (!modelName) return false;
    return Boolean(catalogByModelName[modelName]?.visionCapable);
  }, [catalogByModelName]);

  const sessionResolvedBaseModelName = activeSession?.llmModelId
    ? null
    : (activeSession?.baseModelName ?? characterDefaultBaseModelName ?? DEFAULT_BASE_MODEL_NAME);
  const draftBaseModelName = selectedBaseModelName ?? characterDefaultBaseModelName ?? DEFAULT_BASE_MODEL_NAME;
  const activeConversationSupportsImages = activeSession
    ? (!activeSession.llmModelId && resolveVisionCapability(sessionResolvedBaseModelName))
    : (!llmModelId && resolveVisionCapability(draftBaseModelName));
  const canAttachImage = !chatDisabled && activeConversationSupportsImages;
  const selectedDraftModelSupportsImages = !llmModelId && resolveVisionCapability(draftBaseModelName);
  const showModelSwitchImageHint = Boolean(
    activeSession
      && !activeSession.llmModelId
      && !activeConversationSupportsImages
      && selectedDraftModelSupportsImages,
  );

  const scrollToBottom = () => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => { scrollToBottom(); }, [messages, streamingContent]);

  useEffect(() => {
    if (!canAttachImage && selectedImage) {
      setSelectedImage(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [canAttachImage, selectedImage]);

  const loadAvailableBaseModels = useCallback(async () => {
    try {
      const [catalog, runtimeStatus, preferences] = await Promise.all([
        fetchLLMCatalog(),
        fetchLLMRuntime(),
        fetchCharacterLLMPreferences(characterId),
      ]);
      setCatalogByModelName(
        Object.fromEntries(catalog.items.map((item) => [item.modelName, item])),
      );
      const installed = new Set(runtimeStatus.models.map((model) => model.name));
      const availableModels = resolveAvailableBaseModels(catalog.items, installed);
      setAvailableBaseModels(availableModels);
      setCharacterDefaultBaseModelName(preferences.defaultBaseModelName ?? null);

      const inAvailableModels = (modelName: string | null | undefined) =>
        Boolean(modelName) && availableModels.some((item) => item.modelName === modelName);

      setSelectedBaseModelName((prev) => {
        if (inAvailableModels(prev)) {
          return prev ?? null;
        }
        if (inAvailableModels(preferences.defaultBaseModelName)) {
          return preferences.defaultBaseModelName ?? null;
        }
        if (inAvailableModels(DEFAULT_BASE_MODEL_NAME)) {
          return DEFAULT_BASE_MODEL_NAME;
        }
        return availableModels[0]?.modelName ?? null;
      });
    } catch {
      // non-fatal: keep current selection and let runtime checks handle failures.
    }
  }, [characterId]);

  useEffect(() => {
    void loadAvailableBaseModels();
  }, [loadAvailableBaseModels]);

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

  const createSessionByCurrentSelection = useCallback(async () => {
    const session = await createChatSession(
      characterId,
      llmModelId ?? null,
      llmModelId ? null : (selectedBaseModelName ?? null),
    );
    setSessions((prev) => [session, ...prev]);
    setActiveChatId(session.id);
    return session;
  }, [characterId, llmModelId, selectedBaseModelName]);

  const startNewChat = async () => {
    if (chatDisabled) {
      setError(effectiveChatDisabledReason ?? "当前不可新建对话");
      return;
    }
    try {
      await createSessionByCurrentSelection();
      setMessages([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建对话失败");
    }
  };

  const clearSelectedImage = useCallback(() => {
    setSelectedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handlePickImage = () => {
    if (!canAttachImage || sending) return;
    fileInputRef.current?.click();
  };

  const handleImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (files.length > 1) {
      setError("当前仅支持上传 1 张图片。");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    const file = files[0];
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError("仅支持 PNG / JPG / WEBP 图片。");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("图片过大，请换一张更小的图片后再试。");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const splitIndex = dataUrl.indexOf(",");
      if (splitIndex < 0) {
        throw new Error("图片读取失败，请重试。");
      }
      const base64 = dataUrl.slice(splitIndex + 1).trim();
      if (!base64) {
        throw new Error("图片读取失败，请重试。");
      }
      setSelectedImage({
        name: file.name,
        dataUrl,
        base64,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片读取失败，请重试。");
      clearSelectedImage();
    }
  };

  const handleSend = async () => {
    const userText = input.trim();
    if (sending || chatDisabled) return;
    if (!userText) {
      if (selectedImage) {
        setError("请输入你想让模型回答的问题。");
      }
      return;
    }
    if (selectedImage && !canAttachImage) {
      setError("当前会话使用的是文本模型，暂不支持图片对话，请切换到多模态模型后重试。");
      return;
    }

    let chatId = activeChatId;
    if (!chatId) {
      try {
        const session = await createSessionByCurrentSelection();
        chatId = session.id;
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建对话失败");
        return;
      }
    }

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
        selectedImage ? [selectedImage.base64] : undefined,
      );
      // Reload full message list to get server-persisted IDs
      const updated = await getChatMessages(chatId);
      setMessages(updated);
      setStreamingContent(null);
      clearSelectedImage();
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

  const handleSelectBaseModel = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value || null;
    setSelectedBaseModelName(next);
  };

  const resolveModelDisplayName = (modelName: string | null) => {
    if (!modelName) return "系统默认模型";
    const item = catalogByModelName[modelName];
    return item ? `${item.displayName}（${modelName}）` : modelName;
  };

  const sessionModelLabel = activeSession
    ? (activeSession.llmModelId
      ? "私有模型（当前按文本对话）"
      : resolveModelDisplayName(sessionResolvedBaseModelName))
    : null;
  const imageSupportHint = activeConversationSupportsImages
    ? `${activeSession ? "当前会话" : "新对话"}支持图片提问`
    : activeSession
      ? "当前会话使用的是文本模型，暂不支持图片对话。请切换到多模态模型后新建对话。"
      : llmModelId
        ? "当前已选择私有模型，暂不支持图片对话。"
        : "当前选择的是文本模型，暂不支持图片对话。";

  return (
    <div className="flex h-full gap-3 min-h-0">
      {/* Sidebar — chat session list */}
      <div className="w-44 shrink-0 flex flex-col gap-1.5">
        <button
          onClick={startNewChat}
          disabled={chatDisabled}
          className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                     text-xs font-medium text-white transition-colors text-left
                     disabled:opacity-40 disabled:cursor-not-allowed"
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
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-200">
              {characterName ?? "角色"} 对话
            </p>
            {!llmModelId && (
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="shrink-0">基础模型：</span>
                  <select
                    aria-label="基础模型"
                    value={selectedBaseModelName ?? ""}
                    onChange={handleSelectBaseModel}
                    disabled={chatDisabled || availableBaseModels.length === 0}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 min-w-[200px] disabled:opacity-50"
                  >
                    {availableBaseModels.length === 0 && (
                      <option value="">暂无可用基础模型</option>
                    )}
                    {availableBaseModels.map((model) => (
                      <option key={model.modelName} value={model.modelName}>
                        {model.displayName}（{model.modelName}）{model.visionCapable ? " · 支持图片" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {sessionModelLabel ? (
                  <p className="text-xs text-zinc-500">当前会话：{sessionModelLabel}</p>
                ) : (
                  <p className="text-xs text-zinc-500">新对话默认使用该角色的基础模型设置</p>
                )}
                <p className={`text-xs ${activeConversationSupportsImages ? "text-emerald-300" : "text-zinc-600"}`}>
                  {imageSupportHint}
                </p>
                {activeSession && !activeSession.llmModelId && (
                  <p className="text-xs text-zinc-600">
                    切换基础模型将用于新的对话，当前对话不会变更。
                  </p>
                )}
                {showModelSwitchImageHint && (
                  <p className="text-xs text-zinc-600">
                    图片能力将用于新的对话，当前会话仍使用原模型。
                  </p>
                )}
              </div>
            )}
            {llmModelId && (
              <div className="space-y-1">
                <p className="text-xs text-zinc-500">当前已选择私有模型，基础模型设置仅用于新的基础对话。</p>
                {sessionModelLabel && (
                  <p className="text-xs text-zinc-500">当前会话：{sessionModelLabel}</p>
                )}
                <p className={`text-xs ${activeConversationSupportsImages ? "text-emerald-300" : "text-zinc-600"}`}>
                  {imageSupportHint}
                </p>
              </div>
            )}
            <p className="text-xs text-zinc-500">Shift+Enter 换行</p>
          </div>
        </div>

        {chatDisabled && (
          <div className="shrink-0 rounded-lg bg-yellow-950/50 border border-yellow-800 px-3 py-2 text-xs text-yellow-200 mt-2">
            {effectiveChatDisabledReason}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0">
          {!activeChatId && !sending && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-zinc-500 text-sm">开始一段新对话</p>
                <p className="text-zinc-600 text-xs mt-1">
                  {chatDisabled ? "请先完成上方准备步骤" : "直接输入消息或点击「新建对话」"}
                </p>
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

        {canAttachImage && (
          <div className="shrink-0 border-t border-zinc-800 pt-2 space-y-2">
            <input
              ref={fileInputRef}
              data-testid="chat-image-upload-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => void handleImageChange(event)}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePickImage}
                disabled={sending}
                className="px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 text-zinc-200 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                上传图片
              </button>
              <p className="text-xs text-zinc-500">支持 PNG / JPG / WEBP · 当前会话支持图片提问</p>
            </div>
            {selectedImage && (
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-2.5 py-2 flex items-start gap-2">
                <img
                  src={selectedImage.dataUrl}
                  alt="已选择图片预览"
                  data-testid="chat-image-preview"
                  className="w-16 h-16 object-cover rounded border border-zinc-700"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs text-zinc-300 truncate">{selectedImage.name}</p>
                  <p className="text-[11px] text-zinc-500">发送成功后会自动清空附件</p>
                </div>
                <button
                  type="button"
                  onClick={clearSelectedImage}
                  className="text-xs px-2 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                >
                  移除
                </button>
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 flex gap-2 pt-2 border-t border-zinc-800">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={chatDisabled ? "当前不可发送消息" : "输入消息… (Enter 发送)"}
            rows={2}
            disabled={sending || chatDisabled}
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
              disabled={chatDisabled || (!input.trim() && !selectedImage)}
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
