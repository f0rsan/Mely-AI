import { useCallback, useEffect, useState } from "react";
import { fetchHealth, type HealthResponse } from "./api/health";

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; data: HealthResponse }
  | { kind: "backendUnavailable" }
  | { kind: "bootstrapFailed"; data: HealthResponse }
  | { kind: "serviceError" };

function StatusGrid({
  statusLabel,
  statusTone,
  data,
  detailLabel,
  detailValue,
  migrationFallback,
}: {
  statusLabel: string;
  statusTone: "success" | "error";
  data: HealthResponse;
  detailLabel: string;
  detailValue: string;
  migrationFallback: string;
}) {
  const migrations =
    data.database.appliedMigrations?.length && data.database.appliedMigrations.length > 0
      ? data.database.appliedMigrations.join("、")
      : migrationFallback;

  return (
    <div className="status-grid" role="status" aria-live="polite">
      <div className="status-tile">
        <p className="label">状态</p>
        <p className={`value ${statusTone}`}>{statusLabel}</p>
      </div>
      <div className="status-tile">
        <p className="label">数据目录</p>
        <p className="value">{data.dataRoot ?? "未创建"}</p>
      </div>
      <div className="status-tile">
        <p className="label">数据库</p>
        <p className="value">{data.database.path ?? "未创建"}</p>
      </div>
      <div className="status-tile">
        <p className="label">{detailLabel}</p>
        <p className="value">{detailValue}</p>
      </div>
      <div className="status-tile">
        <p className="label">迁移</p>
        <p className="value">{migrations}</p>
      </div>
    </div>
  );
}

function AppStatus({
  state,
  onRetry,
}: {
  state: ViewState;
  onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <div className="status-block" role="status" aria-live="polite">
        <span className="status-chip">正在连接后端...</span>
        <span className="status-hint">首次启动会检查本地数据目录和数据库。</span>
      </div>
    );
  }

  if (state.kind === "backendUnavailable") {
    return (
      <div className="status-block" role="status" aria-live="polite">
        <span className="status-message">后端未启动，请重试</span>
        <button className="retry-button" type="button" onClick={onRetry}>
          重试连接
        </button>
      </div>
    );
  }

  if (state.kind === "serviceError") {
    return (
      <div className="status-block" role="status" aria-live="polite">
        <span className="status-message">后端状态异常，请重试</span>
        <button className="retry-button" type="button" onClick={onRetry}>
          重试连接
        </button>
      </div>
    );
  }

  if (state.kind === "bootstrapFailed") {
    return (
      <>
        <StatusGrid
          statusLabel="本地初始化失败"
          statusTone="error"
          data={state.data}
          detailLabel="建议"
          detailValue="请检查数据目录权限后重试"
          migrationFallback="未执行"
        />
        <div className="action-row">
          <button className="retry-button" type="button" onClick={onRetry}>
            重试连接
          </button>
        </div>
      </>
    );
  }

  return (
    <StatusGrid
      statusLabel="后端连接正常"
      statusTone="success"
      data={state.data}
      detailLabel="服务"
      detailValue="API 已就绪"
      migrationFallback="已初始化"
    />
  );
}

export default function App() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });

    try {
      const data = await fetchHealth();
      if (data.status === "ok") {
        setState({ kind: "ready", data });
        return;
      }

      if (data.error === "bootstrap_failed" || data.database.error === "bootstrap_failed") {
        setState({ kind: "bootstrapFailed", data });
        return;
      }

      setState({ kind: "serviceError" });
    } catch (error) {
      if (error instanceof Error && error.message === "BACKEND_UNAVAILABLE") {
        setState({ kind: "backendUnavailable" });
        return;
      }

      setState({ kind: "serviceError" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="app-shell">
      <section className="status-card" aria-labelledby="app-title">
        <p className="eyebrow">Mely AI</p>
        <h1 id="app-title">角色工作台</h1>
        <p className="lead">
          本地优先的角色创作桌面应用。启动后先连接后端，再进入角色库。
        </p>
        <AppStatus state={state} onRetry={load} />
      </section>
    </main>
  );
}
