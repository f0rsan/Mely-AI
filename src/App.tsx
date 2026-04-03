import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchCharacterList, type CharacterListItem } from "./api/characters";
import {
  CharacterDetailApiError,
  fetchCharacterDetail,
  type CharacterDetail,
} from "./api/characterDetail";
import {
  CharacterDnaApiError,
  fetchCharacterDnaSuggestions,
  saveCharacterDna,
  type CharacterDnaSuggestions,
  type DnaFieldKey,
  type DnaSuggestionField,
} from "./api/dna";
import {
  DatasetApiError,
  type DatasetReport,
  fetchCharacterDatasetReport,
  importCharacterDataset,
} from "./api/datasets";
import {
  createMockTask,
  createTaskStream,
  type TaskConnectionState,
  type TaskSnapshot,
} from "./api/tasks";
import { GenerationWorkbenchPage } from "./components/GenerationWorkbenchPage";
import { VoiceBindPanel } from "./components/VoiceBindPanel";
import { TTSGeneratePanel } from "./components/TTSGeneratePanel";
import { AudioHistoryGallery } from "./components/AudioHistoryGallery";
import { TaskProgressList } from "./components/TaskProgressList";
import { TrainingProgressPanel } from "./components/TrainingProgressPanel";
import { CostumeWorkspace } from "./components/CostumeWorkspace";
import { ExportWorkspace } from "./components/ExportWorkspace";
import { LLMWorkspace } from "./components/LLMWorkspace";
import { VisualWorkspace } from "./components/VisualWorkspace";
import {
  createDatasetFilesFromMockCandidates,
  generateTextToCharacterCandidatesMock,
  type TextToCharacterCandidate,
} from "./mocks/textToCharacter";

type ViewState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: CharacterListItem[] };

type DatasetPreviewItem = {
  name: string;
  sizeLabel: string;
  previewUrl: string;
};

type DetailTab = "dataset" | "textToCharacter" | "dna" | "training" | "generation" | "voice" | "costume" | "export" | "llm" | "visual";

type DnaFormState = Record<DnaFieldKey, string>;

type TextToCharacterStatus = "idle" | "loading" | "success" | "empty" | "error";

const DNA_FIELD_KEYS: DnaFieldKey[] = ["hairColor", "eyeColor", "skinTone", "bodyType", "style"];

function createEmptyDnaForm(): DnaFormState {
  return {
    hairColor: "",
    eyeColor: "",
    skinTone: "",
    bodyType: "",
    style: "",
  };
}

function resolveDnaFieldLabel(fieldKey: DnaFieldKey): string {
  const labels: Record<DnaFieldKey, string> = {
    hairColor: "发色",
    eyeColor: "瞳色",
    skinTone: "肤色",
    bodyType: "体型",
    style: "风格",
  };
  return labels[fieldKey];
}

function pickDnaValue(fieldKey: DnaFieldKey, detail: CharacterDetail | null): string {
  if (detail?.dna === null || detail?.dna === undefined) {
    return "";
  }

  const value = detail.dna[fieldKey];
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function buildDnaForm(detail: CharacterDetail | null, suggestions: CharacterDnaSuggestions): DnaFormState {
  const next = createEmptyDnaForm();

  for (const key of DNA_FIELD_KEYS) {
    const fromDetail = pickDnaValue(key, detail);
    next[key] = fromDetail || suggestions.fields[key].recommended;
  }

  return next;
}

function resolvePromptToken(field: DnaSuggestionField | undefined, selectedValue: string): string {
  const normalized = selectedValue.trim();
  if (!normalized) {
    return "";
  }

  if (!field) {
    return normalized;
  }

  const matched = field.options.find((option) => option.value === normalized);
  return matched?.prompt ?? normalized;
}

function buildDnaPromptPreview(
  form: DnaFormState,
  suggestions: CharacterDnaSuggestions | null,
): string {
  const tokens = DNA_FIELD_KEYS.map((fieldKey) =>
    resolvePromptToken(suggestions?.fields[fieldKey], form[fieldKey]),
  ).filter((token) => token.length > 0);
  return tokens.join(", ");
}

function formatCreatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "创建时间未知";
  }

  return parsed.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createPreviewUrl(file: File): string {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(file);
  }
  return `preview://${encodeURIComponent(file.name)}-${file.size}`;
}

function revokePreviewUrl(url: string): void {
  if (url.startsWith("blob:") && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

function resolveAngleLabel(value: string): string {
  const labels: Record<string, string> = {
    front: "正面",
    threeQuarter: "3/4 侧",
    side: "侧面",
    back: "背面",
    closeup: "特写",
    fullBody: "全身",
    unknown: "未识别",
  };
  return labels[value] ?? value;
}

function resolveModeLabel(value: string): string {
  if (value === "light") {
    return "轻量";
  }
  if (value === "standard") {
    return "标准";
  }
  if (value === "fine") {
    return "精细";
  }
  return value;
}

function upsertTask(tasks: TaskSnapshot[], nextTask: TaskSnapshot): TaskSnapshot[] {
  const exists = tasks.some((task) => task.id === nextTask.id);
  const merged = exists
    ? tasks.map((task) => (task.id === nextTask.id ? nextTask : task))
    : [nextTask, ...tasks];

  return [...merged].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function resolveConnectionLabel(state: TaskConnectionState): string {
  if (state === "connected") {
    return "实时推送已连接";
  }
  if (state === "connecting") {
    return "实时推送连接中";
  }
  return "实时推送未连接";
}

function extractDatasetErrorMessage(error: unknown): string {
  if (error instanceof DatasetApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "数据集评估失败，请稍后重试。";
}

function extractDnaErrorMessage(error: unknown): string {
  if (error instanceof CharacterDnaApiError || error instanceof CharacterDetailApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "DNA 加载失败，请稍后重试。";
}

function extractTextToCharacterErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "候选图生成失败，这是 Mock 通道错误，请稍后重试。";
}

function CharacterGrid({
  items,
  onOpenDetail,
  onCreate,
}: {
  items: CharacterListItem[];
  onOpenDetail: (character: CharacterListItem) => void;
  onCreate: () => void;
}) {
  return (
    <div className="character-grid">
      {items.map((character) => (
        <button
          key={character.id}
          className="character-card"
          type="button"
          onClick={() => onOpenDetail(character)}
          aria-label={`打开角色 ${character.name}`}
        >
          <p className="character-name">{character.name}</p>
          <p className="character-meta">ID: {character.id}</p>
          <p className="character-meta">创建于 {formatCreatedAt(character.createdAt)}</p>
          <p className="character-link">进入数据集导入与评估</p>
        </button>
      ))}
      <button
        className="create-entry-card"
        type="button"
        aria-label="创建新角色入口"
        onClick={onCreate}
      >
        <span className="create-plus" aria-hidden="true">
          +
        </span>
        <span className="create-title">创建新角色</span>
        <span className="create-subtitle">上传参考图或文字描述</span>
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="empty-state" aria-live="polite">
      <div className="empty-icon" aria-hidden="true">
        ✨
      </div>
      <h2>还没有角色</h2>
      <p>创建你的第一个角色，后续就能在同一角色档案下持续创作。</p>
      <button className="primary-button" type="button" onClick={onCreate}>
        创建你的第一个角色
      </button>
    </section>
  );
}

function TaskPanel({
  canRunMockTask,
  creatingMode,
  taskActionError,
  taskConnection,
  tasks,
  onStartMockTask,
}: {
  canRunMockTask: boolean;
  creatingMode: "success" | "failure" | null;
  taskActionError: string | null;
  taskConnection: TaskConnectionState;
  tasks: TaskSnapshot[];
  onStartMockTask: (mode: "success" | "failure") => void;
}) {
  const connectionLabel = useMemo(() => resolveConnectionLabel(taskConnection), [taskConnection]);

  return (
    <section className="task-panel" aria-labelledby="task-title">
      <div className="task-panel-top">
        <h2 id="task-title">任务队列验证</h2>
        <span className={`task-connection task-connection-${taskConnection}`}>{connectionLabel}</span>
      </div>
      <p className="task-lead">用于验证任务状态流转、进度推送和失败处理，后续下载器可直接复用。</p>
      <div className="task-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!canRunMockTask || creatingMode !== null}
          onClick={() => onStartMockTask("success")}
        >
          启动成功模拟任务
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!canRunMockTask || creatingMode !== null}
          onClick={() => onStartMockTask("failure")}
        >
          启动失败模拟任务
        </button>
      </div>
      {taskActionError ? <p className="task-action-error">{taskActionError}</p> : null}
      <TaskProgressList tasks={tasks} />
    </section>
  );
}

type DatasetWorkspaceProps = {
  character: CharacterListItem;
  activeTab: DetailTab;
  onSwitchTab: (tab: DetailTab) => void;
  previews: DatasetPreviewItem[];
  report: DatasetReport | null;
  loadingReport: boolean;
  importing: boolean;
  message: string | null;
  dnaSuggestions: CharacterDnaSuggestions | null;
  dnaLoading: boolean;
  dnaSaving: boolean;
  dnaMessage: string | null;
  dnaForm: DnaFormState;
  dnaPromptPreview: string;
  textPrompt: string;
  textStatus: TextToCharacterStatus;
  textStatusMessage: string | null;
  textCandidates: TextToCharacterCandidate[];
  textSelectedCandidateIds: string[];
  textAddingToDataset: boolean;
  onDnaFieldChange: (field: DnaFieldKey, value: string) => void;
  onApplyDnaSuggestions: () => void;
  onSaveDna: () => void;
  onTextPromptChange: (value: string) => void;
  onGenerateTextCandidates: () => void;
  onToggleTextCandidate: (candidateId: string) => void;
  onAddTextCandidatesToDataset: () => void;
  onSelectFiles: (files: FileList | null) => void;
  onStartImport: () => void;
  onBack: () => void;
};

type DnaWorkspaceProps = {
  suggestions: CharacterDnaSuggestions | null;
  loading: boolean;
  saving: boolean;
  message: string | null;
  form: DnaFormState;
  promptPreview: string;
  onFieldChange: (field: DnaFieldKey, value: string) => void;
  onApplySuggestions: () => void;
  onSave: () => void;
};

function DnaWorkspace({
  suggestions,
  loading,
  saving,
  message,
  form,
  promptPreview,
  onFieldChange,
  onApplySuggestions,
  onSave,
}: DnaWorkspaceProps) {
  const showForm = suggestions !== null;

  return (
    <section className="dna-section" aria-label="角色 DNA 工作区">
      <p className="detail-placeholder">
        角色 DNA 是后续训练与生成的基础锚点。你可以手动调整五项核心参数，系统会实时生成完整 Prompt 预览。
      </p>

      {loading ? (
        <div className="status-block">
          <span className="status-chip">正在加载 DNA 建议值...</span>
        </div>
      ) : null}

      {suggestions?.wd14.reason ? <p className="dna-source-tip">{suggestions.wd14.reason}</p> : null}

      {showForm ? (
        <>
          <div className="dna-actions">
            <button className="secondary-button" type="button" onClick={onApplySuggestions} disabled={saving}>
              使用建议值
            </button>
            <button className="primary-button" type="button" onClick={onSave} disabled={saving}>
              {saving ? "保存中..." : "保存 DNA 配置"}
            </button>
          </div>

          <div className="dna-grid">
            {DNA_FIELD_KEYS.map((fieldKey) => (
              <label key={fieldKey} className="dna-field">
                <span>{resolveDnaFieldLabel(fieldKey)}</span>
                <select
                  aria-label={resolveDnaFieldLabel(fieldKey)}
                  value={form[fieldKey]}
                  onChange={(event) => onFieldChange(fieldKey, event.target.value)}
                  disabled={saving}
                >
                  {suggestions.fields[fieldKey].options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <label className="dna-prompt-block">
            <span>完整 DNA Prompt</span>
            <textarea aria-label="完整 DNA Prompt" value={promptPreview} readOnly rows={3} />
          </label>
        </>
      ) : (
        <p className="dataset-empty-note">DNA 建议值暂不可用，请稍后重试。</p>
      )}

      {message ? <p className="dna-message">{message}</p> : null}
    </section>
  );
}

type TextToCharacterWorkspaceProps = {
  prompt: string;
  status: TextToCharacterStatus;
  statusMessage: string | null;
  candidates: TextToCharacterCandidate[];
  selectedCandidateIds: string[];
  addingToDataset: boolean;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onToggleCandidate: (candidateId: string) => void;
  onAddToDataset: () => void;
};

function TextToCharacterWorkspace({
  prompt,
  status,
  statusMessage,
  candidates,
  selectedCandidateIds,
  addingToDataset,
  onPromptChange,
  onGenerate,
  onToggleCandidate,
  onAddToDataset,
}: TextToCharacterWorkspaceProps) {
  const selectedCount = selectedCandidateIds.length;
  const hasCandidates = candidates.length > 0;

  return (
    <section className="text-to-character-section" aria-label="文字创角工作区">
      <h2>文字描述创角（Mock 联调）</h2>
      <p className="detail-placeholder">
        输入角色外貌描述后，系统会返回 4–8 张候选图用于联调演示。当前不连接真实 G1 运行时，只用于提前打通页面和状态组织。
      </p>
      <p className="text-to-character-disclaimer">本轮为 mock 联调，不代表真实 G1 结果。</p>

      <label className="text-to-character-input-block">
        <span>角色文字描述</span>
        <textarea
          aria-label="角色文字描述"
          value={prompt}
          rows={4}
          placeholder="例如：银色长发，红色眼睛，二次元少女，直播封面风格。"
          onChange={(event) => onPromptChange(event.target.value)}
          disabled={status === "loading" || addingToDataset}
        />
      </label>

      <div className="text-to-character-actions">
        <button
          className="primary-button"
          type="button"
          onClick={onGenerate}
          disabled={status === "loading" || addingToDataset}
        >
          {status === "loading" ? "生成中..." : "生成候选图（Mock）"}
        </button>
        <span className="text-to-character-contract-note">
          mock 合同：固定 4–8 张候选图，不代表真实生成质量。
        </span>
      </div>

      {status === "loading" ? (
        <div className="status-block">
          <span className="status-chip">正在生成候选图（Mock）...</span>
        </div>
      ) : null}

      {statusMessage ? (
        <p
          className={
            status === "error"
              ? "text-to-character-message text-to-character-message-error"
              : "text-to-character-message"
          }
        >
          {statusMessage}
        </p>
      ) : null}

      {!hasCandidates && status === "idle" ? (
        <p className="dataset-empty-note">还没有候选图，先输入描述并点击“生成候选图（Mock）”。</p>
      ) : null}

      {hasCandidates ? (
        <>
          <section className="text-to-character-grid-section" aria-label="候选图结果">
            <h3>候选图结果</h3>
            <div className="text-to-character-grid">
              {candidates.map((candidate, index) => {
                const selected = selectedCandidateIds.includes(candidate.id);
                return (
                  <article
                    key={candidate.id}
                    className={`text-to-character-card ${selected ? "text-to-character-card-selected" : ""}`}
                  >
                    <img src={candidate.previewDataUrl} alt={`候选图 ${index + 1}`} />
                    <div className="text-to-character-card-meta">
                      <p>{candidate.name}</p>
                      <span>mock 合同版本：{candidate.contractVersion}</span>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      aria-pressed={selected}
                      aria-label={`选择候选图 ${index + 1}`}
                      onClick={() => onToggleCandidate(candidate.id)}
                      disabled={addingToDataset}
                    >
                      {selected ? `取消候选图 ${index + 1}` : `选择候选图 ${index + 1}`}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <div className="text-to-character-footer">
            <p>
              已选择 <strong>{selectedCount}</strong> 张候选图。确认后会回到“数据集评估”并复用 M1C 导入流程。
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={onAddToDataset}
              disabled={selectedCount === 0 || addingToDataset}
            >
              {addingToDataset ? "加入中..." : `加入数据集（${selectedCount} 张）`}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Voice sub-tab workspace
// ---------------------------------------------------------------------------

type VoiceSubTab = "bind" | "generate" | "history";

function VoiceWorkspace({ characterId }: { characterId: string }) {
  const [subTab, setSubTab] = useState<VoiceSubTab>("bind");

  return (
    <div className="flex flex-col gap-0">
      <div className="flex gap-1 border-b border-gray-700 mb-0">
        {(["bind", "generate", "history"] as VoiceSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`text-xs px-3 py-1.5 border-b-2 transition-colors ${
              subTab === t
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
            onClick={() => setSubTab(t)}
          >
            {t === "bind" ? "绑定" : t === "generate" ? "生成" : "历史"}
          </button>
        ))}
      </div>

      {subTab === "bind" && <VoiceBindPanel characterId={characterId} />}
      {subTab === "generate" && (
        <TTSGeneratePanel
          characterId={characterId}
          onViewHistory={() => setSubTab("history")}
        />
      )}
      {subTab === "history" && <AudioHistoryGallery characterId={characterId} />}
    </div>
  );
}

function DatasetWorkspace({
  character,
  activeTab,
  onSwitchTab,
  previews,
  report,
  loadingReport,
  importing,
  message,
  dnaSuggestions,
  dnaLoading,
  dnaSaving,
  dnaMessage,
  dnaForm,
  dnaPromptPreview,
  textPrompt,
  textStatus,
  textStatusMessage,
  textCandidates,
  textSelectedCandidateIds,
  textAddingToDataset,
  onDnaFieldChange,
  onApplyDnaSuggestions,
  onSaveDna,
  onTextPromptChange,
  onGenerateTextCandidates,
  onToggleTextCandidate,
  onAddTextCandidatesToDataset,
  onSelectFiles,
  onStartImport,
  onBack,
}: DatasetWorkspaceProps) {
  const title =
    activeTab === "dataset"
      ? "数据集导入与评估"
      : activeTab === "textToCharacter"
        ? "文字创角（Mock）"
      : activeTab === "dna"
        ? "角色 DNA 配置"
      : activeTab === "generation"
        ? "生成工作台"
      : activeTab === "voice"
        ? "声音绑定"
      : activeTab === "costume"
        ? "造型版本树"
      : activeTab === "export"
        ? "导出设定书"
      : activeTab === "llm"
        ? "LLM 工作台"
      : activeTab === "visual"
        ? "视觉工作台"
        : "训练进度与验证";

  return (
    <section className="library-card detail-shell dataset-shell" aria-labelledby="detail-title">
      <button className="back-button" type="button" onClick={onBack}>
        返回角色库
      </button>
      <h1 id="detail-title">{title}</h1>
      <p className="lead">
        {character.name}
        <span className="detail-note">（ID: {character.id}）</span>
      </p>
      <div className="detail-tab-row" role="tablist" aria-label="角色详情标签">
        <button
          className={`detail-tab-button ${activeTab === "dataset" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("dataset")}
        >
          数据集评估
        </button>
        <button
          className={`detail-tab-button ${activeTab === "textToCharacter" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("textToCharacter")}
        >
          文字创角（Mock）
        </button>
        <button
          className={`detail-tab-button ${activeTab === "dna" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("dna")}
        >
          角色 DNA
        </button>
        <button
          className={`detail-tab-button ${activeTab === "training" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("training")}
        >
          训练进度与验证
        </button>
        <button
          className={`detail-tab-button ${activeTab === "generation" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("generation")}
        >
          生成工作台
        </button>
        <button
          className={`detail-tab-button ${activeTab === "voice" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("voice")}
        >
          声音绑定
        </button>
        <button
          className={`detail-tab-button ${activeTab === "costume" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("costume")}
        >
          造型管理
        </button>
        <button
          className={`detail-tab-button ${activeTab === "export" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("export")}
        >
          导出设定书
        </button>
        <button
          className={`detail-tab-button ${activeTab === "llm" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("llm")}
        >
          LLM 工作台
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#6366f1",
              marginLeft: 5,
              verticalAlign: "middle",
            }}
          />
        </button>
        <button
          className={`detail-tab-button ${activeTab === "visual" ? "detail-tab-active" : ""}`}
          type="button"
          onClick={() => onSwitchTab("visual")}
        >
          视觉工作台
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#10b981",
              marginLeft: 5,
              verticalAlign: "middle",
            }}
          />
        </button>
      </div>

      {activeTab === "dataset" ? (
        <>
          <p className="detail-placeholder">
            批量导入训练图片后，系统会生成质量评分、角度覆盖分析和改进建议，可直接供下游模块复用。
          </p>

          <div className="dataset-upload-panel">
            <label className="secondary-button" htmlFor="dataset-file-input">
              选择训练图片
            </label>
            <input
              id="dataset-file-input"
              className="dataset-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              aria-label="选择训练图片"
              onChange={(event) => onSelectFiles(event.target.files)}
            />
            <button
              className="primary-button"
              type="button"
              onClick={onStartImport}
              disabled={previews.length === 0 || importing}
            >
              {importing ? "评估中..." : "开始评估"}
            </button>
          </div>

          <p className="dataset-upload-meta">
            {previews.length > 0
              ? `已选择 ${previews.length} 张图片，支持批量导入。`
              : "支持 PNG / JPG / WebP，建议导入清晰的多角度图片。"}
          </p>

          {loadingReport ? (
            <div className="status-block">
              <span className="status-chip">正在加载历史评估结果...</span>
            </div>
          ) : null}

          {message ? <p className="dataset-message">{message}</p> : null}

          {previews.length > 0 ? (
            <section className="dataset-preview-section" aria-label="图片预览网格">
              <h2>图片预览</h2>
              <div className="dataset-preview-grid">
                {previews.map((preview) => (
                  <article key={preview.previewUrl} className="dataset-preview-card">
                    <img src={preview.previewUrl} alt={`预览 ${preview.name}`} />
                    <div className="dataset-preview-meta">
                      <p>{preview.name}</p>
                      <span>{preview.sizeLabel}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {report ? (
            <section className="dataset-report" aria-label="数据集评估结果">
              <h2>数据集质量评分</h2>
              <div className="dataset-summary-grid">
                <article className="dataset-summary-card">
                  <span>质量分</span>
                  <strong>{report.qualityScore} 分</strong>
                </article>
                <article className="dataset-summary-card">
                  <span>图片总数</span>
                  <strong>{report.totalImages} 张</strong>
                </article>
                <article className="dataset-summary-card">
                  <span>合格图片</span>
                  <strong>{report.qualifiedImages} 张</strong>
                </article>
                <article className="dataset-summary-card">
                  <span>问题图片</span>
                  <strong>{report.problemImages} 张</strong>
                </article>
              </div>

              <div className="dataset-section-block">
                <h3>角度覆盖度</h3>
                <ul className="dataset-angle-list">
                  {Object.entries(report.angleDistribution)
                    .filter(([, count]) => count > 0)
                    .map(([bucket, count]) => (
                      <li key={bucket}>
                        <span>{resolveAngleLabel(bucket)}</span>
                        <strong>{count} 张</strong>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="dataset-section-block">
                <h3>问题项识别</h3>
                {report.problemItems.length > 0 ? (
                  <ul className="dataset-problem-list">
                    {report.problemItems.map((item) => (
                      <li key={item.imageId}>
                        <p>
                          {item.name}（{resolveAngleLabel(item.angleBucket)}）
                        </p>
                        <span>{item.issues.join("；")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="dataset-empty-note">未检测到问题图片。</p>
                )}
              </div>

              <div className="dataset-section-block">
                <h3>改进建议</h3>
                <ul className="dataset-tip-list">
                  {report.recommendations.map((tip, index) => (
                    <li key={`${tip}-${index}`}>{tip}</li>
                  ))}
                </ul>
              </div>

              <div className="dataset-section-block">
                <h3>推荐训练模式</h3>
                <p className="dataset-mode-line">
                  推荐使用 <strong>{resolveModeLabel(report.recommendedTrainingMode.mode)}</strong> 模式
                  （{report.recommendedTrainingMode.suggestedSteps} steps / rank{" "}
                  {report.recommendedTrainingMode.suggestedRank}）
                </p>
                <p className="dataset-mode-reason">{report.recommendedTrainingMode.reason}</p>
              </div>

              <div className="dataset-section-block">
                <h3>下游复用元信息</h3>
                <pre className="dataset-json">
                  {JSON.stringify(
                    {
                      totalImages: report.totalImages,
                      qualifiedImages: report.qualifiedImages,
                      problemImages: report.problemImages,
                      angleDistribution: report.angleDistribution,
                      problemItems: report.problemItems,
                      recommendedTrainingMode: report.recommendedTrainingMode,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </section>
          ) : (
            <p className="dataset-empty-note">还没有导入训练图片，先选择图片后点击“开始评估”。</p>
          )}
        </>
      ) : activeTab === "textToCharacter" ? (
        <TextToCharacterWorkspace
          prompt={textPrompt}
          status={textStatus}
          statusMessage={textStatusMessage}
          candidates={textCandidates}
          selectedCandidateIds={textSelectedCandidateIds}
          addingToDataset={textAddingToDataset}
          onPromptChange={onTextPromptChange}
          onGenerate={onGenerateTextCandidates}
          onToggleCandidate={onToggleTextCandidate}
          onAddToDataset={onAddTextCandidatesToDataset}
        />
      ) : activeTab === "generation" ? (
        <GenerationWorkbenchPage
          characterId={character.id}
          characterName={character.name}
        />
      ) : activeTab === "voice" ? (
        <VoiceWorkspace characterId={character.id} />
      ) : activeTab === "costume" ? (
        <CostumeWorkspace characterId={character.id} />
      ) : activeTab === "export" ? (
        <ExportWorkspace characterId={character.id} />
      ) : activeTab === "llm" ? (
        <LLMWorkspace characterId={character.id} characterName={character.name} />
      ) : activeTab === "visual" ? (
        <VisualWorkspace characterId={character.id} />
      ) : (
        <>
          {activeTab === "dna" ? (
            <DnaWorkspace
              suggestions={dnaSuggestions}
              loading={dnaLoading}
              saving={dnaSaving}
              message={dnaMessage}
              form={dnaForm}
              promptPreview={dnaPromptPreview}
              onFieldChange={onDnaFieldChange}
              onApplySuggestions={onApplyDnaSuggestions}
              onSave={onSaveDna}
            />
          ) : (
            <TrainingProgressPanel
              character={character}
              onOpenDataset={() => onSwitchTab("dataset")}
            />
          )}
        </>
      )}
    </section>
  );
}

export default function App() {
  const [viewState, setViewState] = useState<ViewState>({ kind: "loading" });
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterListItem | null>(null);
  const [createHint, setCreateHint] = useState("");
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [taskConnection, setTaskConnection] = useState<TaskConnectionState>("disconnected");
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [creatingMode, setCreatingMode] = useState<"success" | "failure" | null>(null);
  const [datasetFiles, setDatasetFiles] = useState<File[]>([]);
  const [datasetPreviews, setDatasetPreviews] = useState<DatasetPreviewItem[]>([]);
  const [datasetReport, setDatasetReport] = useState<DatasetReport | null>(null);
  const [datasetLoadingReport, setDatasetLoadingReport] = useState(false);
  const [datasetImporting, setDatasetImporting] = useState(false);
  const [datasetMessage, setDatasetMessage] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("dataset");
  const [dnaSuggestions, setDnaSuggestions] = useState<CharacterDnaSuggestions | null>(null);
  const [dnaLoading, setDnaLoading] = useState(false);
  const [dnaSaving, setDnaSaving] = useState(false);
  const [dnaMessage, setDnaMessage] = useState<string | null>(null);
  const [dnaForm, setDnaForm] = useState<DnaFormState>(createEmptyDnaForm());
  const [dnaLoadedCharacterId, setDnaLoadedCharacterId] = useState<string | null>(null);
  const [textPrompt, setTextPrompt] = useState("");
  const [textStatus, setTextStatus] = useState<TextToCharacterStatus>("idle");
  const [textStatusMessage, setTextStatusMessage] = useState<string | null>(null);
  const [textCandidates, setTextCandidates] = useState<TextToCharacterCandidate[]>([]);
  const [textSelectedCandidateIds, setTextSelectedCandidateIds] = useState<string[]>([]);
  const [textAddingToDataset, setTextAddingToDataset] = useState(false);

  const canRunMockTask = viewState.kind === "ready";
  const dnaPromptPreview = useMemo(
    () => buildDnaPromptPreview(dnaForm, dnaSuggestions),
    [dnaForm, dnaSuggestions],
  );

  const loadCharacters = useCallback(async () => {
    setViewState({ kind: "loading" });

    try {
      const data = await fetchCharacterList();
      setViewState({ kind: "ready", items: data.items });
    } catch {
      setViewState({ kind: "error" });
    }
  }, []);

  const handleCreateEntry = useCallback(() => {
    setCreateHint("创建角色流程将在后续模块接入。");
  }, []);

  const startMockTask = useCallback(async (mode: "success" | "failure") => {
    setTaskActionError(null);
    setCreatingMode(mode);

    try {
      const created = await createMockTask(mode);
      setTasks((current) => upsertTask(current, created));
    } catch {
      setTaskActionError("模拟任务启动失败，请重试。");
    } finally {
      setCreatingMode(null);
    }
  }, []);

  const clearDatasetSelection = useCallback(() => {
    setDatasetFiles([]);
    setDatasetPreviews((current) => {
      current.forEach((item) => revokePreviewUrl(item.previewUrl));
      return [];
    });
  }, []);

  const resetTextToCharacterState = useCallback(() => {
    setTextPrompt("");
    setTextStatus("idle");
    setTextStatusMessage(null);
    setTextCandidates([]);
    setTextSelectedCandidateIds([]);
    setTextAddingToDataset(false);
  }, []);

  const handleBackToLibrary = useCallback(() => {
    setSelectedCharacter(null);
    setDetailTab("dataset");
    setDatasetMessage(null);
    setDatasetReport(null);
    setDatasetLoadingReport(false);
    setDnaSuggestions(null);
    setDnaForm(createEmptyDnaForm());
    setDnaMessage(null);
    setDnaLoading(false);
    setDnaSaving(false);
    setDnaLoadedCharacterId(null);
    clearDatasetSelection();
    resetTextToCharacterState();
  }, [clearDatasetSelection, resetTextToCharacterState]);

  const handleOpenCharacter = useCallback((character: CharacterListItem) => {
    setSelectedCharacter(character);
    setDetailTab("dataset");
    setDatasetMessage(null);
    setDnaSuggestions(null);
    setDnaForm(createEmptyDnaForm());
    setDnaMessage(null);
    setDnaLoading(false);
    setDnaSaving(false);
    setDnaLoadedCharacterId(null);
    resetTextToCharacterState();
  }, [resetTextToCharacterState]);

  const handleSelectDatasetFiles = useCallback(
    (files: FileList | null) => {
      setDatasetMessage(null);
      clearDatasetSelection();

      if (files === null || files.length === 0) {
        return;
      }

      const nextFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (nextFiles.length === 0) {
        setDatasetMessage("请选择 PNG / JPG / WebP 图片后再试。");
        return;
      }

      setDatasetFiles(nextFiles);
      setDatasetPreviews(
        nextFiles.map((file) => ({
          name: file.name,
          sizeLabel: formatFileSize(file.size),
          previewUrl: createPreviewUrl(file),
        })),
      );
    },
    [clearDatasetSelection],
  );

  const handleStartDatasetImport = useCallback(async () => {
    if (selectedCharacter === null || datasetFiles.length === 0) {
      return;
    }

    setDatasetImporting(true);
    setDatasetMessage(null);

    try {
      const report = await importCharacterDataset(selectedCharacter.id, datasetFiles);
      setDatasetReport(report);
      setDatasetMessage("数据集评估完成，结果已可供下游模块复用。");
    } catch (error) {
      setDatasetMessage(extractDatasetErrorMessage(error));
    } finally {
      setDatasetImporting(false);
    }
  }, [datasetFiles, selectedCharacter]);

  const handleDnaFieldChange = useCallback((field: DnaFieldKey, value: string) => {
    setDnaForm((current) => ({
      ...current,
      [field]: value,
    }));
    setDnaMessage(null);
  }, []);

  const handleApplyDnaSuggestions = useCallback(() => {
    if (dnaSuggestions === null) {
      return;
    }

    setDnaForm((current) => {
      const next = { ...current };
      for (const fieldKey of DNA_FIELD_KEYS) {
        next[fieldKey] = dnaSuggestions.fields[fieldKey].recommended;
      }
      return next;
    });
    setDnaMessage("已应用建议值，你可以继续手动调整。");
  }, [dnaSuggestions]);

  const handleSaveDna = useCallback(async () => {
    if (selectedCharacter === null) {
      return;
    }

    setDnaSaving(true);
    setDnaMessage(null);

    try {
      const detail = await saveCharacterDna(selectedCharacter.id, {
        hairColor: dnaForm.hairColor,
        eyeColor: dnaForm.eyeColor,
        skinTone: dnaForm.skinTone,
        bodyType: dnaForm.bodyType,
        style: dnaForm.style,
      });

      if (detail.dna !== null) {
        setDnaForm({
          hairColor: detail.dna.hairColor ?? "",
          eyeColor: detail.dna.eyeColor ?? "",
          skinTone: detail.dna.skinTone ?? "",
          bodyType: detail.dna.bodyType ?? "",
          style: detail.dna.style ?? "",
        });
      }

      setDnaMessage("DNA 已保存，可用于训练与后续生成。");
    } catch (error) {
      setDnaMessage(extractDnaErrorMessage(error));
    } finally {
      setDnaSaving(false);
    }
  }, [dnaForm, selectedCharacter]);

  const handleTextPromptChange = useCallback((value: string) => {
    setTextPrompt(value);
    if (textStatus !== "loading") {
      setTextStatus("idle");
      setTextStatusMessage(null);
    }
  }, [textStatus]);

  const handleGenerateTextCandidates = useCallback(async () => {
    const prompt = textPrompt.trim();
    if (prompt.length === 0) {
      setTextStatus("error");
      setTextStatusMessage("请输入角色文字描述后再生成。");
      setTextCandidates([]);
      setTextSelectedCandidateIds([]);
      return;
    }

    setTextStatus("loading");
    setTextStatusMessage(null);
    setTextCandidates([]);
    setTextSelectedCandidateIds([]);

    try {
      const result = await generateTextToCharacterCandidatesMock(prompt);
      setTextCandidates(result.candidates);
      setTextSelectedCandidateIds([]);

      if (result.candidates.length === 0) {
        setTextStatus("empty");
        setTextStatusMessage("本次未生成候选图，请补充更具体的外貌描述后重试。");
        return;
      }

      setTextStatus("success");
      setTextStatusMessage(`已生成 ${result.candidates.length} 张候选图（Mock），请选择后加入数据集。`);
    } catch (error) {
      setTextStatus("error");
      setTextCandidates([]);
      setTextSelectedCandidateIds([]);
      setTextStatusMessage(extractTextToCharacterErrorMessage(error));
    }
  }, [textPrompt]);

  const handleToggleTextCandidate = useCallback((candidateId: string) => {
    setTextSelectedCandidateIds((current) =>
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId],
    );
    setTextStatusMessage(null);
  }, []);

  const handleAddTextCandidatesToDataset = useCallback(() => {
    if (selectedCharacter === null || textSelectedCandidateIds.length === 0) {
      return;
    }

    const selectedCandidates = textCandidates.filter((candidate) =>
      textSelectedCandidateIds.includes(candidate.id),
    );
    if (selectedCandidates.length === 0) {
      return;
    }

    setTextAddingToDataset(true);
    clearDatasetSelection();

    const files = createDatasetFilesFromMockCandidates(selectedCandidates);
    setDatasetFiles(files);
    setDatasetPreviews(
      selectedCandidates.map((candidate, index) => ({
        name: files[index].name,
        sizeLabel: formatFileSize(files[index].size),
        previewUrl: candidate.previewDataUrl,
      })),
    );
    setDatasetReport(null);
    setDatasetMessage(
      `已将 ${selectedCandidates.length} 张 Mock 候选图加入数据集，请继续点击“开始评估”进入 M1C 流程。`,
    );
    setDetailTab("dataset");

    setTextStatus("success");
    setTextStatusMessage("候选图已加入数据集，可在数据集页继续评估。");
    setTextAddingToDataset(false);
  }, [
    clearDatasetSelection,
    selectedCharacter,
    textCandidates,
    textSelectedCandidateIds,
  ]);

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);

  useEffect(() => {
    if (!canRunMockTask) {
      setTaskConnection("disconnected");
      return;
    }

    const disconnect = createTaskStream(
      (event) => {
        setTasks((current) => upsertTask(current, event.task));
      },
      setTaskConnection,
    );

    return () => {
      disconnect();
    };
  }, [canRunMockTask]);

  useEffect(() => {
    if (selectedCharacter === null) {
      return;
    }

    setDatasetLoadingReport(true);
    setDatasetMessage(null);
    setDatasetReport(null);
    const controller = new AbortController();

    fetchCharacterDatasetReport(selectedCharacter.id, controller.signal)
      .then((report) => {
        setDatasetReport(report);
      })
      .catch((error) => {
        if (error instanceof DatasetApiError && error.status === 404) {
          return;
        }
        setDatasetMessage(extractDatasetErrorMessage(error));
      })
      .finally(() => {
        setDatasetLoadingReport(false);
      });

    return () => {
      controller.abort();
    };
  }, [selectedCharacter]);

  useEffect(() => {
    if (selectedCharacter === null || detailTab !== "dna") {
      return;
    }

    if (dnaLoadedCharacterId === selectedCharacter.id && dnaSuggestions !== null) {
      return;
    }

    setDnaLoading(true);
    setDnaMessage(null);
    const controller = new AbortController();

    Promise.all([
      fetchCharacterDetail(selectedCharacter.id, controller.signal),
      fetchCharacterDnaSuggestions(selectedCharacter.id, controller.signal),
    ])
      .then(([detail, suggestions]) => {
        setDnaSuggestions(suggestions);
        setDnaForm(buildDnaForm(detail, suggestions));
        setDnaLoadedCharacterId(selectedCharacter.id);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setDnaMessage(extractDnaErrorMessage(error));
      })
      .finally(() => {
        setDnaLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [detailTab, dnaLoadedCharacterId, dnaSuggestions, selectedCharacter]);

  if (selectedCharacter) {
    return (
      <main className="app-shell">
        <DatasetWorkspace
          character={selectedCharacter}
          activeTab={detailTab}
          onSwitchTab={setDetailTab}
          previews={datasetPreviews}
          report={datasetReport}
          loadingReport={datasetLoadingReport}
          importing={datasetImporting}
          message={datasetMessage}
          dnaSuggestions={dnaSuggestions}
          dnaLoading={dnaLoading}
          dnaSaving={dnaSaving}
          dnaMessage={dnaMessage}
          dnaForm={dnaForm}
          dnaPromptPreview={dnaPromptPreview}
          textPrompt={textPrompt}
          textStatus={textStatus}
          textStatusMessage={textStatusMessage}
          textCandidates={textCandidates}
          textSelectedCandidateIds={textSelectedCandidateIds}
          textAddingToDataset={textAddingToDataset}
          onDnaFieldChange={handleDnaFieldChange}
          onApplyDnaSuggestions={handleApplyDnaSuggestions}
          onSaveDna={handleSaveDna}
          onTextPromptChange={handleTextPromptChange}
          onGenerateTextCandidates={handleGenerateTextCandidates}
          onToggleTextCandidate={handleToggleTextCandidate}
          onAddTextCandidatesToDataset={handleAddTextCandidatesToDataset}
          onSelectFiles={handleSelectDatasetFiles}
          onStartImport={handleStartDatasetImport}
          onBack={handleBackToLibrary}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="library-card" aria-labelledby="app-title">
        <header className="library-header">
          <div>
            <p className="eyebrow">Mely AI</p>
            <h1 id="app-title">角色库</h1>
            <p className="lead">以角色为中心管理创作资产，保持跨场景一致性。</p>
          </div>
          <button className="primary-button" type="button" onClick={handleCreateEntry}>
            创建角色
          </button>
        </header>

        {createHint ? <p className="create-hint">{createHint}</p> : null}

        {viewState.kind === "loading" ? (
          <div className="status-block" role="status" aria-live="polite">
            <span className="status-chip">正在加载角色库...</span>
          </div>
        ) : null}

        {viewState.kind === "error" ? (
          <div className="status-block" role="status" aria-live="polite">
            <span className="status-message">角色列表加载失败，请重试</span>
            <button className="secondary-button" type="button" onClick={loadCharacters}>
              重试加载
            </button>
          </div>
        ) : null}

        {viewState.kind === "ready" && viewState.items.length === 0 ? (
          <EmptyState onCreate={handleCreateEntry} />
        ) : null}

        {viewState.kind === "ready" && viewState.items.length > 0 ? (
          <CharacterGrid
            items={viewState.items}
            onOpenDetail={handleOpenCharacter}
            onCreate={handleCreateEntry}
          />
        ) : null}

        {viewState.kind === "ready" ? (
          <TaskPanel
            canRunMockTask={canRunMockTask}
            creatingMode={creatingMode}
            taskActionError={taskActionError}
            taskConnection={taskConnection}
            tasks={tasks}
            onStartMockTask={startMockTask}
          />
        ) : null}
      </section>
    </main>
  );
}
