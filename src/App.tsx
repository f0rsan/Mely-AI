import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchCharacterList, type CharacterListItem } from "./api/characters";
import {
  createMockTask,
  createTaskStream,
  type TaskConnectionState,
  type TaskSnapshot,
} from "./api/tasks";
import { GenerationWorkbenchPage } from "./components/GenerationWorkbenchPage";
import { TaskProgressList } from "./components/TaskProgressList";

type ViewState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: CharacterListItem[] };

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
          <p className="character-link">进入角色详情空壳</p>
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

export default function App() {
  const [viewState, setViewState] = useState<ViewState>({ kind: "loading" });
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterListItem | null>(null);
  const [createHint, setCreateHint] = useState("");
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [taskConnection, setTaskConnection] = useState<TaskConnectionState>("disconnected");
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [creatingMode, setCreatingMode] = useState<"success" | "failure" | null>(null);

  const canRunMockTask = viewState.kind === "ready";

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

  if (selectedCharacter) {
    return (
      <main className="app-shell">
        <section className="library-card detail-shell" aria-labelledby="detail-title">
          <button className="back-button" type="button" onClick={() => setSelectedCharacter(null)}>
            返回角色库
          </button>
          <h1 id="detail-title">角色详情（空壳）</h1>
          <p className="lead">
            {selectedCharacter.name}
            <span className="detail-note">（ID: {selectedCharacter.id}）</span>
          </p>
          <GenerationWorkbenchPage
            characterId={selectedCharacter.id}
            characterName={selectedCharacter.name}
          />
        </section>
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
            onOpenDetail={setSelectedCharacter}
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
