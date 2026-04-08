/**
 * CharacterProfileWorkspace — 角色人设、世界观、交互设定、记忆管理的综合工作区。
 * Embedded as a tab inside the character detail page.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type CharacterProfile,
  type CharacterProfileUpdate,
  type Memory,
  type MemoryCreate,
  type MemoryKind,
  type TriggerRule,
  ProfileApiError,
  createMemory,
  deleteMemory,
  fetchMemories,
  fetchProfile,
  previewSystemPrompt,
  saveProfile,
  updateMemory,
} from "../api/profile";

// ── Types ──────────────────────────────────────────────────────────────────────

type ProfileSubTab = "persona" | "world" | "interaction" | "memory";

interface ProfileFormState {
  personaSummary: string;
  personalityTraits: string[];
  speakingStyle: string;
  backstory: string;
  valuesBeliefs: string;
  quirks: string;
  likes: string[];
  dislikes: string[];
  worldName: string;
  worldSetting: string;
  worldRules: string;
  worldKeyEvents: string;
  userAddress: string;
  selfAddress: string;
  catchphrases: string[];
  forbiddenWords: string[];
  emotionDefault: string;
  triggerRules: TriggerRule[];
}

interface MemoryFormState {
  kind: MemoryKind;
  content: string;
  importance: number;
  pinned: boolean;
}

// ── Default values ─────────────────────────────────────────────────────────────

function defaultForm(): ProfileFormState {
  return {
    personaSummary: "",
    personalityTraits: [],
    speakingStyle: "",
    backstory: "",
    valuesBeliefs: "",
    quirks: "",
    likes: [],
    dislikes: [],
    worldName: "",
    worldSetting: "",
    worldRules: "",
    worldKeyEvents: "",
    userAddress: "你",
    selfAddress: "我",
    catchphrases: [],
    forbiddenWords: [],
    emotionDefault: "",
    triggerRules: [],
  };
}

function defaultMemoryForm(): MemoryFormState {
  return { kind: "fact", content: "", importance: 3, pinned: false };
}

function profileToForm(p: CharacterProfile): ProfileFormState {
  return {
    personaSummary: p.personaSummary ?? "",
    personalityTraits: p.personalityTraits ?? [],
    speakingStyle: p.speakingStyle ?? "",
    backstory: p.backstory ?? "",
    valuesBeliefs: p.valuesBeliefs ?? "",
    quirks: p.quirks ?? "",
    likes: p.likes ?? [],
    dislikes: p.dislikes ?? [],
    worldName: p.worldName ?? "",
    worldSetting: p.worldSetting ?? "",
    worldRules: p.worldRules ?? "",
    worldKeyEvents: p.worldKeyEvents ?? "",
    userAddress: p.userAddress,
    selfAddress: p.selfAddress,
    catchphrases: p.catchphrases ?? [],
    forbiddenWords: p.forbiddenWords ?? [],
    emotionDefault: p.emotionDefault ?? "",
    triggerRules: p.triggerRules ?? [],
  };
}

function formToUpdate(form: ProfileFormState): CharacterProfileUpdate {
  return {
    personaSummary: form.personaSummary || null,
    personalityTraits: form.personalityTraits.length > 0 ? form.personalityTraits : null,
    speakingStyle: form.speakingStyle || null,
    backstory: form.backstory || null,
    valuesBeliefs: form.valuesBeliefs || null,
    quirks: form.quirks || null,
    likes: form.likes.length > 0 ? form.likes : null,
    dislikes: form.dislikes.length > 0 ? form.dislikes : null,
    worldName: form.worldName || null,
    worldSetting: form.worldSetting || null,
    worldRules: form.worldRules || null,
    worldKeyEvents: form.worldKeyEvents || null,
    userAddress: form.userAddress || "你",
    selfAddress: form.selfAddress || "我",
    catchphrases: form.catchphrases.length > 0 ? form.catchphrases : null,
    forbiddenWords: form.forbiddenWords.length > 0 ? form.forbiddenWords : null,
    emotionDefault: form.emotionDefault || null,
    triggerRules: form.triggerRules.length > 0 ? form.triggerRules : null,
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Inline chip editor for string[] fields */
function ChipInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
      e.preventDefault();
      const tag = draft.trim();
      if (!value.includes(tag)) onChange([...value, tag]);
      setDraft("");
    }
    if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <label className="profile-field">
      <span>{label}</span>
      <div className="chip-wrap">
        {value.map((tag) => (
          <span key={tag} className="chip">
            {tag}
            <button
              type="button"
              className="chip-remove"
              aria-label={`删除 ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="chip-input"
          value={draft}
          placeholder={value.length === 0 ? (placeholder ?? "输入后按 Enter 添加") : ""}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </label>
  );
}

/** Importance selector 1–5 */
function ImportanceSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="importance-selector" aria-label="重要程度">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`importance-dot ${value >= n ? "active" : ""}`}
          onClick={() => onChange(n)}
          aria-label={`重要程度 ${n}`}
        />
      ))}
    </div>
  );
}

/** Trigger rules editor */
function TriggerRulesEditor({
  value,
  onChange,
}: {
  value: TriggerRule[];
  onChange: (next: TriggerRule[]) => void;
}) {
  function addRule() {
    onChange([...value, { trigger: "", reaction: "" }]);
  }
  function removeRule(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function updateRule(idx: number, field: keyof TriggerRule, text: string) {
    onChange(value.map((r, i) => (i === idx ? { ...r, [field]: text } : r)));
  }

  return (
    <div className="profile-field">
      <span>特殊反应规则</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
        {value.map((rule, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <input
              className="profile-input"
              style={{ flex: 1 }}
              placeholder="触发条件（如：提到家人）"
              value={rule.trigger}
              onChange={(e) => updateRule(idx, "trigger", e.target.value)}
            />
            <span style={{ paddingTop: 6, color: "var(--text-muted)", fontSize: 12 }}>→</span>
            <input
              className="profile-input"
              style={{ flex: 2 }}
              placeholder="角色的反应"
              value={rule.reaction}
              onChange={(e) => updateRule(idx, "reaction", e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => removeRule(idx)}
            >
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          style={{ alignSelf: "flex-start", fontSize: 11 }}
          onClick={addRule}
        >
          + 添加规则
        </button>
      </div>
    </div>
  );
}

/** Memory kind display label */
function kindLabel(kind: MemoryKind): string {
  const map: Record<MemoryKind, string> = {
    fact: "事实",
    event: "事件",
    relationship: "关系",
    preference: "偏好",
  };
  return map[kind] ?? kind;
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  characterId: string;
}

export function CharacterProfileWorkspace({ characterId }: Props) {
  const activeCharacterRef = useRef(characterId);
  const previewRequestIdRef = useRef(0);

  const [subTab, setSubTab] = useState<ProfileSubTab>("persona");
  const [form, setForm] = useState<ProfileFormState>(defaultForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // Memories
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [newMemoryForm, setNewMemoryForm] = useState<MemoryFormState>(defaultMemoryForm());
  const [addingMemory, setAddingMemory] = useState(false);
  const [memoryMessage, setMemoryMessage] = useState<string | null>(null);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editMemoryForm, setEditMemoryForm] = useState<MemoryFormState>(defaultMemoryForm());
  const [showAddForm, setShowAddForm] = useState(false);

  // Preview
  const [preview, setPreview] = useState<{ prompt: string; estimatedTokens: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Load profile
  useEffect(() => {
    activeCharacterRef.current = characterId;
    previewRequestIdRef.current += 1;
    setSubTab("persona");
    setForm(defaultForm());
    setLoading(true);
    setSaving(false);
    setMessage(null);
    setIsError(false);
    setPreview(null);
    setPreviewLoading(false);
    setShowPreview(false);
    setMemories([]);
    setMemoriesLoading(false);
    setNewMemoryForm(defaultMemoryForm());
    setAddingMemory(false);
    setMemoryMessage(null);
    setEditingMemoryId(null);
    setEditMemoryForm(defaultMemoryForm());
    setShowAddForm(false);
    const controller = new AbortController();

    fetchProfile(characterId, controller.signal)
      .then((profile) => {
        if (controller.signal.aborted) return;
        setForm(profile ? profileToForm(profile) : defaultForm());
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setForm(defaultForm());
        setLoading(false);
      });

    return () => controller.abort();
  }, [characterId]);

  // Load memories when on memory tab
  useEffect(() => {
    if (subTab !== "memory") return;
    setMemoriesLoading(true);
    const controller = new AbortController();

    fetchMemories(characterId, controller.signal)
      .then((items) => {
        setMemories(items);
        setMemoriesLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setMemoryMessage("记忆加载失败，请稍后重试");
        setMemoriesLoading(false);
      });

    return () => controller.abort();
  }, [characterId, subTab]);

  function setField<K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    setIsError(false);
    try {
      const updated = await saveProfile(characterId, formToUpdate(form));
      setForm(profileToForm(updated));
      setMessage("人设已保存。");
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof ProfileApiError ? err.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }, [characterId, form]);

  const handlePreview = useCallback(async () => {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    const requestCharacterId = characterId;
    const draft = formToUpdate(form);

    setPreviewLoading(true);
    setShowPreview(true);
    setPreview(null);
    try {
      const data = await previewSystemPrompt(characterId, draft);
      if (
        previewRequestIdRef.current !== requestId
        || activeCharacterRef.current !== requestCharacterId
      ) {
        return;
      }
      setPreview({ prompt: data.prompt, estimatedTokens: data.estimatedTokens });
    } catch {
      if (
        previewRequestIdRef.current !== requestId
        || activeCharacterRef.current !== requestCharacterId
      ) {
        return;
      }
      setPreview(null);
    } finally {
      if (
        previewRequestIdRef.current !== requestId
        || activeCharacterRef.current !== requestCharacterId
      ) {
        return;
      }
      setPreviewLoading(false);
    }
  }, [characterId, form]);

  // Memory handlers
  const handleAddMemory = useCallback(async () => {
    if (!newMemoryForm.content.trim()) return;
    setAddingMemory(true);
    setMemoryMessage(null);
    try {
      const payload: MemoryCreate = {
        kind: newMemoryForm.kind,
        content: newMemoryForm.content.trim(),
        importance: newMemoryForm.importance,
        pinned: newMemoryForm.pinned,
      };
      const created = await createMemory(characterId, payload);
      setMemories((prev) => [created, ...prev]);
      setNewMemoryForm(defaultMemoryForm());
      setShowAddForm(false);
    } catch (err) {
      setMemoryMessage(err instanceof ProfileApiError ? err.message : "添加失败，请稍后重试");
    } finally {
      setAddingMemory(false);
    }
  }, [characterId, newMemoryForm]);

  const handleDeleteMemory = useCallback(async (memoryId: string) => {
    try {
      await deleteMemory(characterId, memoryId);
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
    } catch (err) {
      setMemoryMessage(err instanceof ProfileApiError ? err.message : "删除失败，请稍后重试");
    }
  }, [characterId]);

  const handleSaveEditMemory = useCallback(async () => {
    if (!editingMemoryId) return;
    try {
      const updated = await updateMemory(characterId, editingMemoryId, {
        kind: editMemoryForm.kind,
        content: editMemoryForm.content.trim(),
        importance: editMemoryForm.importance,
        pinned: editMemoryForm.pinned,
      });
      setMemories((prev) => prev.map((m) => (m.id === editingMemoryId ? updated : m)));
      setEditingMemoryId(null);
    } catch (err) {
      setMemoryMessage(err instanceof ProfileApiError ? err.message : "更新失败，请稍后重试");
    }
  }, [characterId, editingMemoryId, editMemoryForm]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const SUB_TABS: { id: ProfileSubTab; label: string }[] = [
    { id: "persona", label: "人物设定" },
    { id: "world", label: "世界观" },
    { id: "interaction", label: "交互设定" },
    { id: "memory", label: "记忆" },
  ];

  if (loading) {
    return (
      <div className="status-block">
        <span className="status-chip">正在加载人设档案...</span>
      </div>
    );
  }

  return (
    <div className="profile-workspace">
      {/* Sub-tab bar */}
      <div className="profile-subtabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`profile-subtab-btn ${subTab === t.id ? "active" : ""}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="profile-content">

        {/* ── 人物设定 ─────────────────────────────────────────────────────── */}
        {subTab === "persona" && (
          <div className="profile-form">
            <label className="profile-field">
              <span>一句话人设 <small>（最多 120 字，作为 System Prompt 首段）</small></span>
              <textarea
                className="profile-textarea"
                rows={2}
                maxLength={120}
                placeholder="例：温柔却有些腹黑的魔法少女，总是用反问句说话。"
                value={form.personaSummary}
                onChange={(e) => setField("personaSummary", e.target.value)}
              />
            </label>

            <ChipInput
              label="性格特质"
              value={form.personalityTraits}
              onChange={(v) => setField("personalityTraits", v)}
              placeholder="输入特质后按 Enter，如：温柔、腹黑"
            />

            <label className="profile-field">
              <span>说话风格</span>
              <textarea
                className="profile-textarea"
                rows={2}
                placeholder="例：习惯用反问句，喜欢在句尾加「呢」，说话简短有力。"
                value={form.speakingStyle}
                onChange={(e) => setField("speakingStyle", e.target.value)}
              />
            </label>

            <label className="profile-field">
              <span>背景故事</span>
              <textarea
                className="profile-textarea"
                rows={4}
                placeholder="角色的出身、经历、重要事件……"
                value={form.backstory}
                onChange={(e) => setField("backstory", e.target.value)}
              />
            </label>

            <label className="profile-field">
              <span>价值观 / 信念</span>
              <textarea
                className="profile-textarea"
                rows={2}
                placeholder="例：相信世界是公平的，痛恨虚伪。"
                value={form.valuesBeliefs}
                onChange={(e) => setField("valuesBeliefs", e.target.value)}
              />
            </label>

            <label className="profile-field">
              <span>癖好 / 小习惯</span>
              <textarea
                className="profile-textarea"
                rows={2}
                placeholder="例：紧张时会把头发绕在手指上。"
                value={form.quirks}
                onChange={(e) => setField("quirks", e.target.value)}
              />
            </label>

            <ChipInput
              label="喜欢"
              value={form.likes}
              onChange={(v) => setField("likes", v)}
              placeholder="输入后按 Enter"
            />

            <ChipInput
              label="厌恶"
              value={form.dislikes}
              onChange={(v) => setField("dislikes", v)}
              placeholder="输入后按 Enter"
            />
          </div>
        )}

        {/* ── 世界观 ────────────────────────────────────────────────────────── */}
        {subTab === "world" && (
          <div className="profile-form">
            <label className="profile-field">
              <span>世界名称</span>
              <input
                className="profile-input"
                placeholder="例：艾拉纳大陆"
                value={form.worldName}
                onChange={(e) => setField("worldName", e.target.value)}
              />
            </label>

            <label className="profile-field">
              <span>世界背景</span>
              <textarea
                className="profile-textarea"
                rows={5}
                placeholder="描述这个世界的整体设定、氛围、文明水平……"
                value={form.worldSetting}
                onChange={(e) => setField("worldSetting", e.target.value)}
              />
            </label>

            <label className="profile-field">
              <span>世界规则</span>
              <textarea
                className="profile-textarea"
                rows={3}
                placeholder="魔法体系、科技限制、特殊法则……"
                value={form.worldRules}
                onChange={(e) => setField("worldRules", e.target.value)}
              />
            </label>

            <label className="profile-field">
              <span>关键历史事件</span>
              <textarea
                className="profile-textarea"
                rows={3}
                placeholder="影响世界格局的重大事件……"
                value={form.worldKeyEvents}
                onChange={(e) => setField("worldKeyEvents", e.target.value)}
              />
            </label>
          </div>
        )}

        {/* ── 交互设定 ──────────────────────────────────────────────────────── */}
        {subTab === "interaction" && (
          <div className="profile-form">
            <div style={{ display: "flex", gap: 16 }}>
              <label className="profile-field" style={{ flex: 1 }}>
                <span>自称</span>
                <input
                  className="profile-input"
                  placeholder="我 / 本小姐 / 吾…"
                  value={form.selfAddress}
                  onChange={(e) => setField("selfAddress", e.target.value)}
                />
              </label>
              <label className="profile-field" style={{ flex: 1 }}>
                <span>称呼用户</span>
                <input
                  className="profile-input"
                  placeholder="你 / 主人 / 笨蛋…"
                  value={form.userAddress}
                  onChange={(e) => setField("userAddress", e.target.value)}
                />
              </label>
            </div>

            <label className="profile-field">
              <span>情感基调</span>
              <input
                className="profile-input"
                placeholder="例：温柔体贴 / 傲娇冷淡 / 元气活泼"
                value={form.emotionDefault}
                onChange={(e) => setField("emotionDefault", e.target.value)}
              />
            </label>

            <ChipInput
              label="口癖"
              value={form.catchphrases}
              onChange={(v) => setField("catchphrases", v)}
              placeholder="例：「是这样吗？」"
            />

            <ChipInput
              label="禁用词"
              value={form.forbiddenWords}
              onChange={(v) => setField("forbiddenWords", v)}
              placeholder="角色绝对不会说的词"
            />

            <TriggerRulesEditor
              value={form.triggerRules}
              onChange={(v) => setField("triggerRules", v)}
            />
          </div>
        )}

        {/* ── 记忆 ──────────────────────────────────────────────────────────── */}
        {subTab === "memory" && (
          <div className="memory-section">
            <div className="memory-header">
              <p className="detail-placeholder" style={{ margin: 0 }}>
                长期记忆会在每次对话中优先注入到 System Prompt。重要程度越高、标记为「常驻」的记忆越优先。
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowAddForm(!showAddForm);
                  setNewMemoryForm(defaultMemoryForm());
                }}
              >
                {showAddForm ? "取消" : "+ 新增记忆"}
              </button>
            </div>

            {/* Add form */}
            {showAddForm && (
              <div className="memory-add-form">
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div className="profile-field" style={{ flex: 1, margin: 0 }}>
                    <select
                      className="profile-input"
                      value={newMemoryForm.kind}
                      onChange={(e) =>
                        setNewMemoryForm((f) => ({ ...f, kind: e.target.value as MemoryKind }))
                      }
                    >
                      <option value="fact">事实</option>
                      <option value="event">事件</option>
                      <option value="relationship">关系</option>
                      <option value="preference">偏好</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 2 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>重要程度</span>
                    <ImportanceSelector
                      value={newMemoryForm.importance}
                      onChange={(v) => setNewMemoryForm((f) => ({ ...f, importance: v }))}
                    />
                  </div>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "var(--text-muted)",
                      paddingTop: 6,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={newMemoryForm.pinned}
                      onChange={(e) =>
                        setNewMemoryForm((f) => ({ ...f, pinned: e.target.checked }))
                      }
                    />
                    常驻
                  </label>
                </div>
                <textarea
                  className="profile-textarea"
                  rows={2}
                  maxLength={300}
                  placeholder="用自然语言描述，最多 300 字"
                  value={newMemoryForm.content}
                  onChange={(e) =>
                    setNewMemoryForm((f) => ({ ...f, content: e.target.value }))
                  }
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={addingMemory || !newMemoryForm.content.trim()}
                  onClick={handleAddMemory}
                >
                  {addingMemory ? "添加中..." : "添加记忆"}
                </button>
              </div>
            )}

            {memoryMessage && (
              <p className="dna-message">{memoryMessage}</p>
            )}

            {memoriesLoading ? (
              <div className="status-block">
                <span className="status-chip">加载记忆中...</span>
              </div>
            ) : memories.length === 0 ? (
              <p className="dataset-empty-note">还没有记忆。添加后会在对话中自动注入。</p>
            ) : (
              <ul className="memory-list">
                {memories.map((mem) => (
                  <li key={mem.id} className={`memory-item ${mem.pinned ? "pinned" : ""}`}>
                    {editingMemoryId === mem.id ? (
                      // Edit mode
                      <div className="memory-edit-form">
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <select
                            className="profile-input"
                            value={editMemoryForm.kind}
                            onChange={(e) =>
                              setEditMemoryForm((f) => ({
                                ...f,
                                kind: e.target.value as MemoryKind,
                              }))
                            }
                          >
                            <option value="fact">事实</option>
                            <option value="event">事件</option>
                            <option value="relationship">关系</option>
                            <option value="preference">偏好</option>
                          </select>
                          <ImportanceSelector
                            value={editMemoryForm.importance}
                            onChange={(v) => setEditMemoryForm((f) => ({ ...f, importance: v }))}
                          />
                          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                            <input
                              type="checkbox"
                              checked={editMemoryForm.pinned}
                              onChange={(e) =>
                                setEditMemoryForm((f) => ({ ...f, pinned: e.target.checked }))
                              }
                            />
                            常驻
                          </label>
                        </div>
                        <textarea
                          className="profile-textarea"
                          rows={2}
                          maxLength={300}
                          value={editMemoryForm.content}
                          onChange={(e) =>
                            setEditMemoryForm((f) => ({ ...f, content: e.target.value }))
                          }
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: 11 }}
                            onClick={handleSaveEditMemory}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 11 }}
                            onClick={() => setEditingMemoryId(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      // View mode
                      <>
                        <div className="memory-item-meta">
                          <span className="memory-kind-badge">{kindLabel(mem.kind)}</span>
                          {mem.pinned && <span className="memory-pinned-badge">常驻</span>}
                          <span className="memory-importance">
                            {"●".repeat(mem.importance)}{"○".repeat(5 - mem.importance)}
                          </span>
                          {mem.hitCount > 0 && (
                            <span className="memory-hit-count">命中 {mem.hitCount} 次</span>
                          )}
                        </div>
                        <p className="memory-content">{mem.content}</p>
                        <div className="memory-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 11 }}
                            onClick={() => {
                              setEditingMemoryId(mem.id);
                              setEditMemoryForm({
                                kind: mem.kind,
                                content: mem.content,
                                importance: mem.importance,
                                pinned: mem.pinned,
                              });
                            }}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 11 }}
                            onClick={() => handleDeleteMemory(mem.id)}
                          >
                            删除
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Save bar (for persona/world/interaction tabs) */}
      {subTab !== "memory" && (
        <div className="profile-save-bar">
          {message && (
            <p className={`profile-message ${isError ? "error" : "success"}`}>{message}</p>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePreview}
              disabled={previewLoading}
            >
              {previewLoading ? "生成中..." : "预览 System Prompt"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "保存中..." : "保存人设"}
            </button>
          </div>
        </div>
      )}

      {/* System Prompt Preview panel */}
      {showPreview && (
        <div className="profile-preview-panel">
          <div className="profile-preview-header">
            <span>System Prompt 预览</span>
            {preview && (
              <span className="profile-token-count">
                约 {preview.estimatedTokens} tokens / 1500
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 11 }}
              onClick={() => setShowPreview(false)}
            >
              关闭
            </button>
          </div>
          {previewLoading ? (
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>组装中...</p>
          ) : preview ? (
            <pre className="profile-preview-text">{preview.prompt}</pre>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
              预览生成失败，请稍后重试。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
