import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createCharacter, fetchCharacterList, type CharacterListItem } from "./api/characters";
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
import { openLLMRuntime } from "./api/llmRuntime";
import { fetchSetupStatus, type SetupStatus } from "./api/setup";
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
import { CharacterProfileWorkspace } from "./components/CharacterProfileWorkspace";
import { CoverArt } from "./components/CoverArt";
import { NavSidebar, type NavPage } from "./components/NavSidebar";
import { EngineStatusBadge } from "./components/EngineStatusBadge";
import { TTSEngineStatusBadge } from "./components/TTSEngineStatusBadge";
import { getCharAccent } from "./utils/charAccent";
import {
  createDatasetFilesFromMockCandidates,
  generateTextToCharacterCandidatesMock,
  type TextToCharacterCandidate,
} from "./mocks/textToCharacter";

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: CharacterListItem[] };

type DatasetPreviewItem = {
  name: string;
  sizeLabel: string;
  previewUrl: string;
};

type DetailTab = "dna" | "visual" | "llm" | "generation" | "voice" | "profile";
type LLMInitialSubTab = "chat" | null;

type DnaFormState = Record<DnaFieldKey, string>;

type TextToCharacterStatus = "idle" | "loading" | "success" | "empty" | "error";
type CapabilityTone = "ready" | "setup" | "limited";

type HomeCapability = {
  title: string;
  tone: CapabilityTone;
  summary: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DNA_FIELD_KEYS: DnaFieldKey[] = ["hairColor", "eyeColor", "skinTone", "bodyType", "style"];
const SHOULD_AUTO_LOAD_SETUP = import.meta.env.MODE !== "test";
const STARTUP_RETRY_ATTEMPTS = SHOULD_AUTO_LOAD_SETUP ? 12 : 3;
const STARTUP_RETRY_DELAY_MS = import.meta.env.MODE === "test" ? 1 : 500;

// ── Pure helpers ──────────────────────────────────────────────────────────────

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
  if (!normalized) return "";
  if (!field) return normalized;
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
  if (Number.isNaN(parsed.getTime())) return "创建时间未知";
  return parsed.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
  if (value === "light") return "轻量";
  if (value === "standard") return "标准";
  if (value === "fine") return "精细";
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
  if (state === "connected") return "实时推送已连接";
  if (state === "connecting") return "实时推送连接中";
  return "实时推送未连接";
}

function extractDatasetErrorMessage(error: unknown): string {
  if (error instanceof DatasetApiError) return error.message;
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "数据集评估失败，请稍后重试。";
}

function extractDnaErrorMessage(error: unknown): string {
  if (error instanceof CharacterDnaApiError || error instanceof CharacterDetailApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "DNA 加载失败，请稍后重试。";
}

function extractTextToCharacterErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "候选图生成失败，这是 Mock 通道错误，请稍后重试。";
}

function extractSetupErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "环境状态检测失败，请稍后重试。";
}

function resolveCapabilityToneLabel(tone: CapabilityTone): string {
  if (tone === "ready") return "可直接使用";
  if (tone === "setup") return "准备后可用";
  return "当前仅流程验证";
}

function resolveCapabilityToneStyle(tone: CapabilityTone): React.CSSProperties {
  if (tone === "ready") {
    return {
      color: "#7ee787",
      background: "rgba(35, 134, 54, 0.14)",
      border: "1px solid rgba(35, 134, 54, 0.35)",
    };
  }
  if (tone === "setup") {
    return {
      color: "#f2cc60",
      background: "rgba(187, 128, 9, 0.14)",
      border: "1px solid rgba(187, 128, 9, 0.35)",
    };
  }
  return {
    color: "#ffb86b",
    background: "rgba(191, 90, 18, 0.14)",
    border: "1px solid rgba(191, 90, 18, 0.35)",
  };
}

function buildHomeCapabilities(setupStatus: SetupStatus | null): HomeCapability[] {
  const llmReady =
    setupStatus !== null &&
    setupStatus.llm.installed &&
    setupStatus.llm.running &&
    setupStatus.llm.models.length > 0;

  let llmSummary = "正在检测语言引擎状态。";
  if (setupStatus !== null) {
    if (!setupStatus.llm.installed) {
      llmSummary = "需要先安装 Ollama，完成后再进入 LLM 工作台。";
    } else if (!setupStatus.llm.running) {
      llmSummary = setupStatus.llm.hint ?? "语言引擎尚未启动。";
    } else if (setupStatus.llm.models.length === 0) {
      llmSummary = "语言引擎已启动，但还没有基础模型，请先下载至少 1 个模型。";
    } else {
      llmSummary = `语言引擎已就绪，当前已检测到 ${setupStatus.llm.models.length} 个模型。`;
    }
  }

  const ttsRunning = setupStatus?.ttsEngine.state === "running";

  return [
    {
      title: "角色资料与图片数据集",
      tone: "ready",
      summary: "可以创建角色、编辑角色设定，并上传或整理图片数据集。",
    },
    {
      title: "角色对话",
      tone: llmReady ? "ready" : "setup",
      summary: llmSummary,
    },
    {
      title: "视觉训练",
      tone: "limited",
      summary: "当前只打通预检、入队和状态展示，AI-Toolkit 训练执行器尚未接通。",
    },
    {
      title: "图像生成",
      tone: "limited",
      summary: "当前生成工作台仍是联调合同，只验证流程，不会产出真实图片。",
    },
    {
      title: "声音链路",
      tone: ttsRunning ? "limited" : "setup",
      summary: ttsRunning
        ? "TTS 引擎已运行，可以验证合成链路；声音绑定当前仍是轻量联调。"
        : "需要先启动 TTS 引擎；声音绑定当前只用于验证流程是否跑通。",
    },
  ];
}

function resolveHeroGpuLabel(setupStatus: SetupStatus | null, loading: boolean): string {
  if (loading && setupStatus === null) return "检测中";
  if (setupStatus === null) return "待检测";
  return `${setupStatus.gpu.vramGB.toFixed(1)} GB`;
}

function resolveHeroLlmLabel(setupStatus: SetupStatus | null, loading: boolean): string {
  if (loading && setupStatus === null) return "检测中";
  if (setupStatus === null) return "待检测";
  if (!setupStatus.llm.installed) return "待安装";
  if (!setupStatus.llm.running) return "待启动";
  if (setupStatus.llm.models.length === 0) return "待下载模型";
  return "已就绪";
}

// ── Sub-components ────────────────────────────────────────────────────────────

// DNA workspace (unchanged from original)
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
            <button className="btn btn-secondary" type="button" onClick={onApplySuggestions} disabled={saving}>
              使用建议值
            </button>
            <button className="btn btn-primary" type="button" onClick={onSave} disabled={saving}>
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

// Text-to-character workspace (unchanged from original)
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
          className="btn btn-primary"
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
        <p className="dataset-empty-note">还没有候选图，先输入描述并点击"生成候选图（Mock）"。</p>
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
                      className="btn btn-secondary"
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
              已选择 <strong>{selectedCount}</strong> 张候选图。确认后会回到"数据集评估"并复用 M1C 导入流程。
            </p>
            <button
              className="btn btn-primary"
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

// Voice workspace with sub-tabs
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

// Voice + Costume + Export combined tab
function VoiceAndExportTab({ characterId }: { characterId: string }) {
  const [subTab, setSubTab] = useState<"voice" | "costume" | "export">("voice");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["voice", "costume", "export"] as const).map((t) => (
          <button
            key={t}
            className={`filter-chip ${subTab === t ? "active" : ""}`}
            onClick={() => setSubTab(t)}
            type="button"
          >
            {t === "voice" ? "声音绑定" : t === "costume" ? "造型管理" : "导出设定书"}
          </button>
        ))}
      </div>
      {subTab === "voice" && <VoiceWorkspace characterId={characterId} />}
      {subTab === "costume" && <CostumeWorkspace characterId={characterId} />}
      {subTab === "export" && <ExportWorkspace characterId={characterId} />}
    </div>
  );
}

// Dataset upload section used inside DnaTabContent
type DatasetUploadSectionProps = {
  previews: DatasetPreviewItem[];
  report: DatasetReport | null;
  loadingReport: boolean;
  importing: boolean;
  message: string | null;
  onSelectFiles: (files: FileList | null) => void;
  onStartImport: () => void;
};

function DatasetUploadSection({
  previews,
  report,
  loadingReport,
  importing,
  message,
  onSelectFiles,
  onStartImport,
}: DatasetUploadSectionProps) {
  return (
    <>
      <p className="detail-placeholder">
        批量导入训练图片后，系统会生成质量评分、角度覆盖分析和改进建议，可直接供下游模块复用。
      </p>

      <div className="dataset-upload-panel">
        <label className="btn btn-secondary" htmlFor="dataset-file-input">
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
          className="btn btn-primary"
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
        <p className="dataset-empty-note">还没有导入训练图片，先选择图片后点击"开始评估"。</p>
      )}
    </>
  );
}

// DNA tab — merges DNA form + dataset evaluation + text-to-character
type DnaTabContentProps = {
  suggestions: CharacterDnaSuggestions | null;
  dnaLoading: boolean;
  dnaSaving: boolean;
  dnaMessage: string | null;
  dnaForm: DnaFormState;
  dnaPromptPreview: string;
  previews: DatasetPreviewItem[];
  report: DatasetReport | null;
  loadingReport: boolean;
  importing: boolean;
  datasetMessage: string | null;
  textPrompt: string;
  textStatus: TextToCharacterStatus;
  textStatusMessage: string | null;
  textCandidates: TextToCharacterCandidate[];
  textSelectedCandidateIds: string[];
  textAddingToDataset: boolean;
  onDnaFieldChange: (field: DnaFieldKey, value: string) => void;
  onApplyDnaSuggestions: () => void;
  onSaveDna: () => void;
  onSelectFiles: (files: FileList | null) => void;
  onStartImport: () => void;
  onTextPromptChange: (value: string) => void;
  onGenerateTextCandidates: () => void;
  onToggleTextCandidate: (candidateId: string) => void;
  onAddTextCandidatesToDataset: () => void;
};

function DnaTabContent({
  suggestions,
  dnaLoading,
  dnaSaving,
  dnaMessage,
  dnaForm,
  dnaPromptPreview,
  previews,
  report,
  loadingReport,
  importing,
  datasetMessage,
  textPrompt,
  textStatus,
  textStatusMessage,
  textCandidates,
  textSelectedCandidateIds,
  textAddingToDataset,
  onDnaFieldChange,
  onApplyDnaSuggestions,
  onSaveDna,
  onSelectFiles,
  onStartImport,
  onTextPromptChange,
  onGenerateTextCandidates,
  onToggleTextCandidate,
  onAddTextCandidatesToDataset,
}: DnaTabContentProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* DNA form */}
      <DnaWorkspace
        suggestions={suggestions}
        loading={dnaLoading}
        saving={dnaSaving}
        message={dnaMessage}
        form={dnaForm}
        promptPreview={dnaPromptPreview}
        onFieldChange={onDnaFieldChange}
        onApplySuggestions={onApplyDnaSuggestions}
        onSave={onSaveDna}
      />

      {/* Dataset section */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <span className="section-label">数据来源 · 训练图片</span>
        </div>
        <DatasetUploadSection
          previews={previews}
          report={report}
          loadingReport={loadingReport}
          importing={importing}
          message={datasetMessage}
          onSelectFiles={onSelectFiles}
          onStartImport={onStartImport}
        />
      </div>

      {/* Text-to-character section */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <span className="section-label">数据来源 · 文字创角</span>
        </div>
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
      </div>
    </div>
  );
}

// Task panel — kept for state compatibility but not rendered in home page
// Intentionally unused in main render; state/handlers are still wired
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
          className="btn btn-primary"
          type="button"
          disabled={!canRunMockTask || creatingMode !== null}
          onClick={() => onStartMockTask("success")}
        >
          启动成功模拟任务
        </button>
        <button
          className="btn btn-secondary"
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

// Character grid with new design classes
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
      {items.map((character, idx) => (
        <button
          key={character.id}
          className="character-card"
          style={{
            "--char-accent": getCharAccent(character.id),
            animation: `cardIn 0.6s ${idx * 0.07}s both cubic-bezier(0.16,1,0.3,1)`,
          } as React.CSSProperties}
          onClick={() => onOpenDetail(character)}
          type="button"
          aria-label={`打开角色 ${character.name}`}
        >
          {/* Cover art placeholder */}
          <CoverArt accent={getCharAccent(character.id)} size="full" />

          <div className="char-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="char-name">{character.name}</div>
                <div className="char-name-en">ID: {character.id.slice(0, 8)}</div>
              </div>
            </div>
            <div className="char-footer">
              <span className="char-time">
                {/* Clock icon */}
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1" />
                  <path d="M5.5 3v2.5l1.8 1.2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {formatCreatedAt(character.createdAt)}
              </span>
              <span className="char-open-hint">
                打开
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>
        </button>
      ))}

      {/* Create new character card */}
      <button className="create-card" type="button" onClick={onCreate} aria-label="创建新角色入口">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 30 }}>
          <div className="create-plus-icon">
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
              <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="create-label">创建新角色</div>
            <div className="create-sub">上传参考图或文字描述</div>
          </div>
        </div>
      </button>
    </div>
  );
}

function CapabilityCard({ capability }: { capability: HomeCapability }) {
  return (
    <article
      style={{
        padding: "16px 18px",
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(10,12,16,0.78)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>{capability.title}</strong>
        <span
          style={{
            ...resolveCapabilityToneStyle(capability.tone),
            borderRadius: 999,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {resolveCapabilityToneLabel(capability.tone)}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
        {capability.summary}
      </p>
    </article>
  );
}

type HomeReadinessPanelProps = {
  setupStatus: SetupStatus | null;
  loading: boolean;
  error: string | null;
  expanded: boolean;
  runtimeOpening: boolean;
  actionMessage: string | null;
  latestCharacter: CharacterListItem | null;
  onCreateCharacter: () => void;
  onOpenLatestCharacter: () => void;
  onToggleExpanded: () => void;
  onRefresh: () => void;
  onOpenLLMRuntime: () => void;
};

function HomeReadinessPanel({
  setupStatus,
  loading,
  error,
  expanded,
  runtimeOpening,
  actionMessage,
  latestCharacter,
  onCreateCharacter,
  onOpenLatestCharacter,
  onToggleExpanded,
  onRefresh,
  onOpenLLMRuntime,
}: HomeReadinessPanelProps) {
  const capabilities = buildHomeCapabilities(setupStatus);
  const llmNeedsInstall = setupStatus !== null && !setupStatus.llm.installed;
  const llmNeedsStart = setupStatus !== null && setupStatus.llm.installed && !setupStatus.llm.running;
  const llmNeedsModel =
    setupStatus !== null &&
    setupStatus.llm.installed &&
    setupStatus.llm.running &&
    setupStatus.llm.models.length === 0;

  return (
    <section
      aria-label="首次体验与环境状态"
      style={{
        marginBottom: 24,
        padding: 24,
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.08)",
        background:
          "linear-gradient(145deg, rgba(11,14,19,0.94), rgba(19,25,36,0.92) 58%, rgba(26,18,20,0.88))",
        boxShadow: "0 22px 80px rgba(0,0,0,0.24)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 760 }}>
          <span className="section-label">首次体验</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.15 }}>先走一条真实可用的最小路径</h2>
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 14,
                lineHeight: 1.7,
                color: "var(--text-secondary)",
              }}
            >
              推荐顺序：先创建角色，再补齐角色设定，然后进入 LLM 工作台。图像生成和视觉训练目前还不是可交付主路径，下面会直接告诉你哪些能力已经能用，哪些还只是流程联调。
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {latestCharacter ? (
            <button className="btn btn-primary" type="button" onClick={onOpenLatestCharacter}>
              打开最近角色的 LLM 工作台
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={onCreateCharacter}>
              创建第一个角色
            </button>
          )}
          <button className="btn btn-secondary" type="button" onClick={onToggleExpanded}>
            {expanded ? "收起环境与设置" : "环境与设置"}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onRefresh}>
            重新检测
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 12,
        }}
      >
        <article
          style={{
            padding: "14px 16px",
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>本地后端</span>
          <strong style={{ display: "block", marginTop: 8, fontSize: 20 }}>
            {loading && setupStatus === null ? "检测中" : setupStatus?.backend.status === "ok" ? "已连接" : "待确认"}
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            {setupStatus?.backend.dataRoot ? `数据目录：${setupStatus.backend.dataRoot}` : "等待环境检测结果。"}
          </p>
        </article>

        <article
          style={{
            padding: "14px 16px",
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>GPU / 显存</span>
          <strong style={{ display: "block", marginTop: 8, fontSize: 20 }}>
            {loading && setupStatus === null ? "检测中" : setupStatus ? `${setupStatus.gpu.vramGB.toFixed(1)} GB` : "待检测"}
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            {setupStatus?.gpu.recommendation ?? "检测完成后会给出模式建议。"}
          </p>
        </article>

        <article
          style={{
            padding: "14px 16px",
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>语言引擎</span>
          <strong style={{ display: "block", marginTop: 8, fontSize: 20 }}>
            {loading && setupStatus === null
              ? "检测中"
              : setupStatus === null
                ? "待检测"
                : !setupStatus.llm.installed
                  ? "未安装"
                  : !setupStatus.llm.running
                    ? "未启动"
                    : setupStatus.llm.models.length === 0
                      ? "缺少模型"
                      : "已就绪"}
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            {setupStatus === null
              ? "检测完成后会显示 Ollama 与模型状态。"
              : !setupStatus.llm.installed
                ? "需要先安装 Ollama。"
                : !setupStatus.llm.running
                  ? setupStatus.llm.hint ?? "语言引擎尚未启动。"
                  : setupStatus.llm.models.length === 0
                    ? "请至少下载 1 个基础模型后再进入角色对话。"
                    : `已检测到 ${setupStatus.llm.models.length} 个模型。`}
          </p>
        </article>
      </div>

      {loading ? (
        <div className="status-block" style={{ margin: 0 }}>
          <span className="status-chip">正在检测安装后环境状态...</span>
        </div>
      ) : null}

      {error ? (
        <div className="status-block" style={{ margin: 0 }}>
          <span className="status-message">{error}</span>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="status-block" style={{ margin: 0 }}>
          <span className="status-message">{actionMessage}</span>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {capabilities.map((capability) => (
          <CapabilityCard key={capability.title} capability={capability} />
        ))}
      </div>

      {expanded ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          <section
            style={{
              padding: "16px 18px",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>语言引擎设置</h3>
              <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                当前主路径优先依赖 Ollama。装好 Ollama 并下载基础模型后，就能先把角色设定和角色对话走通。
              </p>
            </div>
            {setupStatus ? (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                {setupStatus.llm.hint ?? `版本：${setupStatus.llm.version ?? "未知"} · 平台：${setupStatus.llm.platform}`}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {llmNeedsInstall ? (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => window.open("https://ollama.com/download", "_blank")}
                >
                  查看 Ollama 安装指引
                </button>
              ) : null}
              {llmNeedsStart ? (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={onOpenLLMRuntime}
                  disabled={runtimeOpening}
                >
                  {runtimeOpening ? "启动中..." : "启动语言引擎"}
                </button>
              ) : null}
              {llmNeedsModel ? (
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  下一步：进入任意角色的 LLM 工作台，在“模型库”里下载基础模型。
                </span>
              ) : null}
            </div>
          </section>

          {setupStatus !== null ? (
            <>
              <section
                style={{
                  padding: "16px 18px",
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: 15 }}>图像引擎</h3>
                  <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                    当前可以检测和启动图像引擎，但图像生成工作台本身仍是联调流程，不建议把它当作首条主路径。
                  </p>
                </div>
                <EngineStatusBadge pollIntervalMs={8000} />
              </section>

              <section
                style={{
                  padding: "16px 18px",
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: 15 }}>语音引擎</h3>
                  <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                    语音链路支持检测和启动 TTS 引擎；声音绑定当前仍是轻量联调，适合先验证流程，不适合作为完整成品路径。
                  </p>
                </div>
                <TTSEngineStatusBadge pollIntervalMs={8000} />
              </section>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// Empty state with new classes
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="empty-state" aria-live="polite">
      <div className="empty-icon" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M16 6l2.5 7.5L26 16l-7.5 2.5L16 26l-2.5-7.5L6 16l7.5-2.5L16 6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
      <h2>还没有角色</h2>
      <p>创建你的第一个角色，后续就能在同一角色档案下持续创作。</p>
      <button className="btn btn-primary" type="button" onClick={onCreate}>
        创建你的第一个角色
      </button>
    </section>
  );
}

// ── Tab icons for detail sidebar ──────────────────────────────────────────────

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M8 1.5L4 8h3.5L7 12.5 10.5 5.5H7L8 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function DnaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 1.5v11M9 1.5v11M5 4.5h4M5 7h4M5 9.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="5" cy="5.5" r="1" stroke="currentColor" strokeWidth="0.9" />
      <path d="M1.5 10l3.5-3.5 2.5 2.5 2.5-3.5 2 2.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GenerateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5 5l2.5 2.5L10 5M5 7.5l2.5 2.5L10 7.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3.5 5.5v3M6 3.5v7M8.5 5v4M11 4v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2 12c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  // ── State — preserve all original state variables ──
  const [viewState, setViewState] = useState<ViewState>({ kind: "loading" });
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterListItem | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalName, setCreateModalName] = useState("");
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [createModalBusy, setCreateModalBusy] = useState(false);
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
  const [detailTab, setDetailTab] = useState<DetailTab>("llm");
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
  const [llmInitialSubTab, setLlmInitialSubTab] = useState<LLMInitialSubTab>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [setupActionMessage, setSetupActionMessage] = useState<string | null>(null);
  const [openingLLMRuntime, setOpeningLLMRuntime] = useState(false);

  // New state for home page UI
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("全部");

  // Ref for injecting --char-accent on detail page
  const detailRef = useRef<HTMLDivElement>(null);
  const hasLoadedSetupRef = useRef(false);

  const canRunMockTask = viewState.kind === "ready";
  const dnaPromptPreview = useMemo(
    () => buildDnaPromptPreview(dnaForm, dnaSuggestions),
    [dnaForm, dnaSuggestions],
  );

  // ── Callbacks — all original logic preserved ───────────────────────────────

  const loadCharacters = useCallback(async () => {
    setViewState({ kind: "loading" });
    try {
      const data = await fetchCharacterList();
      setViewState({ kind: "ready", items: data.items });
    } catch {
      setViewState({ kind: "error" });
    }
  }, []);

  const loadSetupState = useCallback(async () => {
    setSetupLoading(true);
    setSetupError(null);
    try {
      const next = await fetchSetupStatus();
      setSetupStatus(next);
      setSetupActionMessage(null);
    } catch (error) {
      setSetupError(extractSetupErrorMessage(error));
    } finally {
      setSetupLoading(false);
    }
  }, []);

  const handleCreateEntry = useCallback(() => {
    setCreateModalOpen(true);
    setCreateModalName("");
    setCreateModalError(null);
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
    setDetailTab("llm");
    setLlmInitialSubTab(null);
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

  const handleOpenHomeSetup = useCallback(() => {
    setSetupExpanded(true);
    setSelectedCharacter(null);
    setDetailTab("llm");
    setLlmInitialSubTab(null);
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

    if (!hasLoadedSetupRef.current && !setupLoading) {
      hasLoadedSetupRef.current = true;
      void loadSetupState();
    }
  }, [clearDatasetSelection, loadSetupState, resetTextToCharacterState, setupLoading]);

  const handleOpenCharacter = useCallback((
    character: CharacterListItem,
    tab: DetailTab = "llm",
    initialSubTab: LLMInitialSubTab = null,
  ) => {
    setSelectedCharacter(character);
    setDetailTab(tab);
    setLlmInitialSubTab(initialSubTab);
    setDatasetMessage(null);
    setDnaSuggestions(null);
    setDnaForm(createEmptyDnaForm());
    setDnaMessage(null);
    setDnaLoading(false);
    setDnaSaving(false);
    setDnaLoadedCharacterId(null);
    resetTextToCharacterState();
  }, [resetTextToCharacterState]);

  const handleStartHomeLLMRuntime = useCallback(async () => {
    setOpeningLLMRuntime(true);
    setSetupActionMessage(null);
    try {
      await openLLMRuntime();
      await loadSetupState();
      setSetupActionMessage("语言引擎启动指令已发送，请等待几秒后再次确认。");
    } catch (error) {
      setSetupActionMessage(extractSetupErrorMessage(error));
    } finally {
      setOpeningLLMRuntime(false);
    }
  }, [loadSetupState]);

  const handleConfirmCreate = useCallback(async () => {
    if (createModalBusy) return;

    const normalizedName = createModalName.trim();
    if (normalizedName.length === 0) {
      setCreateModalError("请输入角色名称");
      return;
    }

    setCreateModalBusy(true);
    setCreateModalError(null);
    try {
      const created = await createCharacter(normalizedName);
      setViewState((current) => {
        if (current.kind !== "ready") return current;
        return {
          kind: "ready",
          items: [created, ...current.items.filter((item) => item.id !== created.id)],
        };
      });
      setCreateModalOpen(false);
      setCreateModalName("");
      handleOpenCharacter(created, "llm", "chat");
    } catch (error) {
      if (error instanceof Error && error.message.trim().length > 0) {
        setCreateModalError(error.message);
      } else {
        setCreateModalError("创建失败，请重试");
      }
    } finally {
      setCreateModalBusy(false);
    }
  }, [createModalBusy, createModalName, handleOpenCharacter]);

  const handleSelectDatasetFiles = useCallback(
    (files: FileList | null) => {
      setDatasetMessage(null);
      clearDatasetSelection();

      if (files === null || files.length === 0) return;

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
    if (selectedCharacter === null || datasetFiles.length === 0) return;

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
    setDnaForm((current) => ({ ...current, [field]: value }));
    setDnaMessage(null);
  }, []);

  const handleApplyDnaSuggestions = useCallback(() => {
    if (dnaSuggestions === null) return;
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
    if (selectedCharacter === null) return;

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
    if (selectedCharacter === null || textSelectedCandidateIds.length === 0) return;

    const selectedCandidates = textCandidates.filter((candidate) =>
      textSelectedCandidateIds.includes(candidate.id),
    );
    if (selectedCandidates.length === 0) return;

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
      `已将 ${selectedCandidates.length} 张 Mock 候选图加入数据集，请继续点击"开始评估"进入 M1C 流程。`,
    );
    setDetailTab("dna");

    setTextStatus("success");
    setTextStatusMessage("候选图已加入数据集，可在数据集页继续评估。");
    setTextAddingToDataset(false);
  }, [
    clearDatasetSelection,
    selectedCharacter,
    textCandidates,
    textSelectedCandidateIds,
  ]);

  // Nav handler for NavSidebar
  // NavSidebar only emits "home" or "detail"; "detail" is a no-op (already on detail page)
  const handleNav = useCallback((page: NavPage) => {
    if (page === "home") {
      handleBackToLibrary();
    }
  }, [handleBackToLibrary]);

  // ── Effects — all original effects preserved ───────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const loadCharactersWithRetry = async () => {
      setViewState({ kind: "loading" });

      for (let attempt = 0; attempt < STARTUP_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const data = await fetchCharacterList();
          if (cancelled) return;
          setViewState({ kind: "ready", items: data.items });
          return;
        } catch {
          if (attempt === STARTUP_RETRY_ATTEMPTS - 1) {
            if (!cancelled) {
              setViewState({ kind: "error" });
            }
            return;
          }
          await delay(STARTUP_RETRY_DELAY_MS);
        }
      }
    };

    void loadCharactersWithRetry();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!SHOULD_AUTO_LOAD_SETUP || viewState.kind !== "ready" || hasLoadedSetupRef.current) return;
    hasLoadedSetupRef.current = true;

    let cancelled = false;

    const loadSetupStateWithRetry = async () => {
      for (let attempt = 0; attempt < STARTUP_RETRY_ATTEMPTS; attempt += 1) {
        try {
          setSetupLoading(true);
          setSetupError(null);
          const next = await fetchSetupStatus();
          if (cancelled) return;
          setSetupStatus(next);
          setSetupActionMessage(null);
          return;
        } catch (error) {
          if (attempt === STARTUP_RETRY_ATTEMPTS - 1) {
            if (!cancelled) {
              setSetupError(extractSetupErrorMessage(error));
            }
            return;
          }
          await delay(STARTUP_RETRY_DELAY_MS);
        } finally {
          if (!cancelled) {
            setSetupLoading(false);
          }
        }
      }
    };

    void loadSetupStateWithRetry();

    return () => {
      cancelled = true;
    };
  }, [viewState.kind]);

  useEffect(() => {
    if (viewState.kind === "ready" && viewState.items.length === 0) {
      setSetupExpanded(true);
    }
  }, [viewState]);

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
    if (selectedCharacter === null || detailTab !== "dna") {
      setDatasetLoadingReport(false);
      setDatasetMessage(null);
      setDatasetReport(null);
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
        if (error instanceof DatasetApiError && error.status === 404) return;
        setDatasetMessage(extractDatasetErrorMessage(error));
      })
      .finally(() => {
        setDatasetLoadingReport(false);
      });

    return () => {
      controller.abort();
    };
  }, [detailTab, selectedCharacter]);

  useEffect(() => {
    if (selectedCharacter === null || detailTab !== "dna") return;

    if (dnaLoadedCharacterId === selectedCharacter.id && dnaSuggestions !== null) return;

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
        if (error instanceof Error && error.name === "AbortError") return;
        setDnaMessage(extractDnaErrorMessage(error));
      })
      .finally(() => {
        setDnaLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [detailTab, dnaLoadedCharacterId, dnaSuggestions, selectedCharacter]);

  // Inject --char-accent CSS variable on detail page container
  useEffect(() => {
    if (selectedCharacter && detailRef.current) {
      detailRef.current.style.setProperty("--char-accent", getCharAccent(selectedCharacter.id));
    }
  }, [selectedCharacter]);

  // ── Derived values ─────────────────────────────────────────────────────────

  // Filter character list by search + active filter
  const filteredItems = useMemo(() => {
    if (viewState.kind !== "ready") return [];
    let items = viewState.items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (activeFilter === "训练中") {
      items = items.filter((c) => c.isVisualTraining);
    }
    return items;
  }, [viewState, search, activeFilter]);

  const latestCharacter = useMemo(() => {
    if (viewState.kind !== "ready" || viewState.items.length === 0) return null;
    return viewState.items[0];
  }, [viewState]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const currentPage: NavPage = selectedCharacter ? "detail" : "home";
  const charAccent = selectedCharacter ? getCharAccent(selectedCharacter.id) : undefined;

  return (
    <div className="app-shell">
      {/* Left nav rail */}
      <NavSidebar
        page={currentPage}
        onNav={handleNav}
        charName={selectedCharacter?.name ?? null}
        charAccent={charAccent}
      />

      {/* Main content area */}
      <div className="app-content">
        <div
          key={selectedCharacter ? detailTab : "home"}
          style={{ height: "100%", animation: "pageIn 0.35s cubic-bezier(0.16,1,0.3,1)" }}
        >
          {selectedCharacter ? (
            // ── Detail page ──────────────────────────────────────────────────
            <div
              className="page-detail"
              ref={detailRef}
            >
              {/* Left detail sidebar */}
              <div className="detail-sidebar">
                {/* Character card at top */}
                <div className="detail-char-card">
                  <div className="detail-char-cover">
                    <CoverArt accent={getCharAccent(selectedCharacter.id)} size="md" />
                  </div>
                  <div className="detail-char-info">
                    <div className="detail-char-name">{selectedCharacter.name}</div>
                    <div className="detail-char-name-en">ID: {selectedCharacter.id.slice(0, 8)}</div>
                  </div>
                </div>

                {/* Vertical tab buttons */}
                <div className="detail-tabs">
                  {(
                    [
                      { id: "profile",    label: "角色设定",     icon: <ProfileIcon /> },
                      { id: "llm",        label: "LLM 工作台",  icon: <BoltIcon /> },
                      { id: "dna",        label: "角色 DNA",     icon: <DnaIcon /> },
                      { id: "visual",     label: "视觉工作台",   icon: <ImageIcon /> },
                      { id: "generation", label: "生成工作台",   icon: <GenerateIcon /> },
                      { id: "voice",      label: "声音 & 导出",  icon: <VoiceIcon /> },
                    ] as { id: DetailTab; label: string; icon: React.ReactNode }[]
                  ).map((tab, i) => (
                    <button
                      key={tab.id}
                      className={`detail-tab-btn ${detailTab === tab.id ? "active" : ""}`}
                      style={{
                        animationDelay: `${i * 0.04}s`,
                        animation: "slideRight 0.3s both ease-out",
                      }}
                      onClick={() => setDetailTab(tab.id)}
                      type="button"
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                      {detailTab === tab.id && <span className="detail-tab-dot" />}
                    </button>
                  ))}
                </div>

                {/* Back button */}
                <div
                  style={{
                    padding: "10px 14px",
                    borderTop: "1px solid var(--border-subtle)",
                    marginTop: "auto",
                  }}
                >
                  <button
                    className="btn btn-secondary"
                    style={{ width: "100%", fontSize: 11, marginBottom: 8 }}
                    onClick={handleOpenHomeSetup}
                    type="button"
                  >
                    环境与设置
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ width: "100%", fontSize: 11 }}
                    onClick={handleBackToLibrary}
                    type="button"
                  >
                    ← 返回角色库
                  </button>
                </div>
              </div>

              {/* Right content panel */}
              <div className="detail-content">
                <div key={detailTab} style={{ animation: "pageIn 0.35s ease-out" }}>
                  {detailTab === "profile" ? (
                    <CharacterProfileWorkspace characterId={selectedCharacter.id} />
                  ) : detailTab === "llm" ? (
                    <LLMWorkspace
                      characterId={selectedCharacter.id}
                      characterName={selectedCharacter.name}
                      initialSubTab={llmInitialSubTab ?? undefined}
                    />
                  ) : detailTab === "dna" ? (
                    <DnaTabContent
                      suggestions={dnaSuggestions}
                      dnaLoading={dnaLoading}
                      dnaSaving={dnaSaving}
                      dnaMessage={dnaMessage}
                      dnaForm={dnaForm}
                      dnaPromptPreview={dnaPromptPreview}
                      previews={datasetPreviews}
                      report={datasetReport}
                      loadingReport={datasetLoadingReport}
                      importing={datasetImporting}
                      datasetMessage={datasetMessage}
                      textPrompt={textPrompt}
                      textStatus={textStatus}
                      textStatusMessage={textStatusMessage}
                      textCandidates={textCandidates}
                      textSelectedCandidateIds={textSelectedCandidateIds}
                      textAddingToDataset={textAddingToDataset}
                      onDnaFieldChange={handleDnaFieldChange}
                      onApplyDnaSuggestions={handleApplyDnaSuggestions}
                      onSaveDna={handleSaveDna}
                      onSelectFiles={handleSelectDatasetFiles}
                      onStartImport={handleStartDatasetImport}
                      onTextPromptChange={handleTextPromptChange}
                      onGenerateTextCandidates={handleGenerateTextCandidates}
                      onToggleTextCandidate={handleToggleTextCandidate}
                      onAddTextCandidatesToDataset={handleAddTextCandidatesToDataset}
                    />
                  ) : detailTab === "visual" ? (
                    <VisualWorkspace characterId={selectedCharacter.id} />
                  ) : detailTab === "generation" ? (
                    <GenerationWorkbenchPage
                      characterId={selectedCharacter.id}
                      characterName={selectedCharacter.name}
                    />
                  ) : detailTab === "voice" ? (
                    <VoiceAndExportTab characterId={selectedCharacter.id} />
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            // ── Home page ─────────────────────────────────────────────────────
            <div className="page-home">
              {/* Hero section */}
              <div style={{ marginBottom: 28, animation: "fadeIn 0.4s ease-out" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 24,
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div>
                    <h1 className="hero-title">
                      <span>你的角色，</span>
                      <br />
                      <span className="hero-title-gradient">永远是同一个人。</span>
                    </h1>
                    <p className="hero-lead">
                      绑定 LoRA、声音指纹与外貌参数，一切创作自动保持跨场景一致性。
                    </p>
                  </div>

                  {/* GPU status badge */}
                  <div className="gpu-badge">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M6.5 1L3 7h3l-.5 4L9 5H6l.5-4z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
                    </svg>
                    <span>显存估算</span>
                    <span className="gpu-badge-value">{resolveHeroGpuLabel(setupStatus, setupLoading)}</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 3.5h8M2 6h8M2 8.5h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                    </svg>
                    <span>语言引擎 {resolveHeroLlmLabel(setupStatus, setupLoading)}</span>
                  </div>
                </div>

                {/* Toolbar — search + filter chips */}
                <div className="toolbar">
                  <div className="search-input-wrap">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    <input
                      className="search-input"
                      placeholder="搜索角色…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="搜索角色"
                    />
                  </div>

                  {["全部", "训练中"].map((f) => (
                    <button
                      key={f}
                      className={`filter-chip ${activeFilter === f ? "active" : ""}`}
                      onClick={() => setActiveFilter(f)}
                      type="button"
                    >
                      {f === "训练中" && <span className="filter-dot" />}
                      {f}
                    </button>
                  ))}

                  <button
                    className={`filter-chip ${setupExpanded ? "active" : ""}`}
                    onClick={() => setSetupExpanded((current) => !current)}
                    type="button"
                  >
                    环境与设置
                  </button>
                </div>
              </div>

              {viewState.kind === "ready" ? (
                <HomeReadinessPanel
                  setupStatus={setupStatus}
                  loading={setupLoading}
                  error={setupError}
                  expanded={setupExpanded}
                  runtimeOpening={openingLLMRuntime}
                  actionMessage={setupActionMessage}
                  latestCharacter={latestCharacter}
                  onCreateCharacter={handleCreateEntry}
                  onOpenLatestCharacter={() => {
                    if (latestCharacter !== null) {
                      handleOpenCharacter(latestCharacter, "llm", "chat");
                    }
                  }}
                  onToggleExpanded={() => setSetupExpanded((current) => !current)}
                  onRefresh={() => void loadSetupState()}
                  onOpenLLMRuntime={() => void handleStartHomeLLMRuntime()}
                />
              ) : null}

              {/* Loading state */}
              {viewState.kind === "loading" ? (
                <div className="status-block" role="status" aria-live="polite">
                  <span className="status-chip">正在加载角色库...</span>
                </div>
              ) : null}

              {/* Error state */}
              {viewState.kind === "error" ? (
                <div className="status-block" role="status" aria-live="polite">
                  <span className="status-message">角色列表加载失败，请重试</span>
                  <button className="btn btn-secondary" type="button" onClick={loadCharacters}>
                    重试加载
                  </button>
                </div>
              ) : null}

              {/* Empty state */}
              {viewState.kind === "ready" && viewState.items.length === 0 ? (
                <EmptyState onCreate={handleCreateEntry} />
              ) : null}

              {/* Character grid */}
              {viewState.kind === "ready" && viewState.items.length > 0 ? (
                <CharacterGrid
                  items={filteredItems}
                  onOpenDetail={handleOpenCharacter}
                  onCreate={handleCreateEntry}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Create character modal */}
      {createModalOpen ? (
        <div
          className="modal-overlay"
          onClick={() => {
            if (createModalBusy) return;
            setCreateModalOpen(false);
            setCreateModalError(null);
          }}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="create-modal-title" className="modal-title">创建角色</h2>
            <p className="modal-subtitle">创建后会自动进入 LLM 工作台；如果语言引擎还没准备好，页面会直接提示你下一步该做什么。</p>
            <form
              className="modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleConfirmCreate();
              }}
            >
              <label htmlFor="create-modal-name">角色名称</label>
              <input
                className="modal-input"
                id="create-modal-name"
                type="text"
                value={createModalName}
                onChange={(event) => setCreateModalName(event.target.value)}
                placeholder="例如：星野ミカ"
                disabled={createModalBusy}
                autoFocus
              />
              {createModalError ? <p className="modal-error">{createModalError}</p> : null}
              <div className="modal-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    if (createModalBusy) return;
                    setCreateModalOpen(false);
                    setCreateModalError(null);
                  }}
                  disabled={createModalBusy}
                >
                  取消
                </button>
                <button className="btn btn-primary" type="submit" disabled={createModalBusy}>
                  {createModalBusy ? "创建中..." : "创建"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
