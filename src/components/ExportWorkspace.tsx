import { useEffect, useState } from "react";

import {
  type ExportAcceptedResponse,
  type ExportListResponse,
  type ProofExportResponse,
  type ProofVerifyResponse,
  exportCharacterPdf,
  fetchExports,
  fetchProofChain,
  getExportDownloadUrl,
  verifyProofChain,
} from "../api/exports";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportSubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "submitted"; response: ExportAcceptedResponse }
  | { kind: "failed"; message: string };

type ProofVerifyState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "done"; result: ProofVerifyResponse }
  | { kind: "failed"; message: string };

interface Props {
  characterId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("zh-CN");
  } catch {
    return isoString;
  }
}

type StatusBadgeProps = {
  status: "pending" | "generating" | "completed" | "failed";
};

function StatusBadge({ status }: StatusBadgeProps) {
  const map: Record<typeof status, { label: string; className: string }> = {
    pending: { label: "等待中", className: "bg-gray-600 text-gray-200" },
    generating: { label: "生成中", className: "bg-blue-600 text-white" },
    completed: { label: "已完成", className: "bg-green-600 text-white" },
    failed: { label: "失败", className: "bg-red-600 text-white" },
  };

  const { label, className } = map[status];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExportWorkspace({ characterId }: Props) {
  // --- Section 1: PDF export ---
  const [submitState, setSubmitState] = useState<ExportSubmitState>({ kind: "idle" });
  const [exportList, setExportList] = useState<ExportListResponse | null>(null);
  const [exportListError, setExportListError] = useState<string | null>(null);

  // --- Section 2: Proof chain ---
  const [proofChain, setProofChain] = useState<ProofExportResponse | null>(null);
  const [proofChainError, setProofChainError] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<ProofVerifyState>({ kind: "idle" });

  // Load export history
  async function loadExports() {
    setExportListError(null);
    try {
      const result = await fetchExports(characterId);
      setExportList(result);
    } catch (err) {
      setExportListError(
        err instanceof Error ? err.message : "导出记录获取失败，请稍后重试"
      );
    }
  }

  // Load proof chain
  async function loadProofChain() {
    setProofChainError(null);
    try {
      const result = await fetchProofChain(characterId);
      setProofChain(result);
    } catch (err) {
      setProofChainError(
        err instanceof Error ? err.message : "创作证明链获取失败，请稍后重试"
      );
    }
  }

  // On mount load both
  useEffect(() => {
    loadExports();
    loadProofChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  // Handle PDF export submit
  async function handleExportPdf() {
    if (submitState.kind === "submitting") return;
    setSubmitState({ kind: "submitting" });
    try {
      const result = await exportCharacterPdf(characterId);
      setSubmitState({ kind: "submitted", response: result });
      // Reload history after submitting
      await loadExports();
    } catch (err) {
      setSubmitState({
        kind: "failed",
        message: err instanceof Error ? err.message : "设定书导出失败，请稍后重试",
      });
    }
  }

  // Handle proof chain verify
  async function handleVerify() {
    if (verifyState.kind === "verifying") return;
    setVerifyState({ kind: "verifying" });
    try {
      const result = await verifyProofChain(characterId);
      setVerifyState({ kind: "done", result });
    } catch (err) {
      setVerifyState({
        kind: "failed",
        message: err instanceof Error ? err.message : "证明链验证失败，请稍后重试",
      });
    }
  }

  const isSubmitting = submitState.kind === "submitting";

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* ------------------------------------------------------------------ */}
      {/* Section 1 — 设定书导出                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="border border-gray-700 rounded-lg p-4 bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">设定书导出</h3>

        <div className="flex flex-col gap-3">
          {/* Export button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isSubmitting}
              className="text-sm px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700 transition-colors"
            >
              {isSubmitting ? "提交中…" : "导出设定书 PDF"}
            </button>

            {/* Submitted feedback */}
            {submitState.kind === "submitted" && (
              <span className="text-sm text-green-400">
                任务已提交（任务 ID：{submitState.response.taskId}）
              </span>
            )}

            {/* Error feedback */}
            {submitState.kind === "failed" && (
              <span className="text-sm text-red-400">{submitState.message}</span>
            )}
          </div>

          {/* Export history */}
          <div>
            <p className="text-xs text-gray-500 mb-2">导出历史</p>

            {exportListError && (
              <p className="text-sm text-red-400">{exportListError}</p>
            )}

            {!exportListError && exportList === null && (
              <p className="text-sm text-gray-500 py-2 text-center">正在加载…</p>
            )}

            {!exportListError && exportList !== null && exportList.items.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">暂无导出记录</p>
            )}

            {!exportListError && exportList !== null && exportList.items.length > 0 && (
              <div className="flex flex-col gap-2">
                {exportList.items.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center gap-3 border border-gray-700 rounded-lg px-3 py-2 bg-gray-800"
                  >
                    <StatusBadge status={record.status} />

                    <span className="text-xs text-gray-400 flex-1 min-w-0">
                      {formatDate(record.createdAt)}
                    </span>

                    <span className="text-xs text-gray-500">
                      {formatFileSize(record.fileSize)}
                    </span>

                    {record.status === "completed" && (
                      <a
                        href={getExportDownloadUrl(record.id)}
                        download
                        className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 shrink-0"
                      >
                        下载
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2 — 创作证明链                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="border border-gray-700 rounded-lg p-4 bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">创作证明链</h3>

        <div className="flex flex-col gap-3">
          {/* Proof chain summary */}
          {proofChainError && (
            <p className="text-sm text-red-400">{proofChainError}</p>
          )}

          {!proofChainError && proofChain === null && (
            <p className="text-sm text-gray-500">正在加载证明链…</p>
          )}

          {!proofChainError && proofChain !== null && (
            <p className="text-sm text-gray-300">
              共{" "}
              <span className="font-semibold text-white">{proofChain.total}</span>{" "}
              条创作证明
            </p>
          )}

          {/* Verify button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifyState.kind === "verifying"}
              className="text-sm px-4 py-2 rounded bg-gray-700 text-gray-200 disabled:opacity-50 hover:bg-gray-600 transition-colors"
            >
              {verifyState.kind === "verifying" ? "验证中…" : "验证证明链"}
            </button>

            {/* Verify result */}
            {verifyState.kind === "done" && verifyState.result.isValid && (
              <span className="text-sm text-green-400">✓ 证明链验证通过</span>
            )}

            {verifyState.kind === "done" && !verifyState.result.isValid && (
              <span className="text-sm text-red-400">
                ✗ 验证失败：{verifyState.result.errorMessage ?? "证明链完整性异常"}
              </span>
            )}

            {verifyState.kind === "failed" && (
              <span className="text-sm text-red-400">{verifyState.message}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
