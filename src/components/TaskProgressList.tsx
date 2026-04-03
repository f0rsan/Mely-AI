import type { TaskSnapshot } from "../api/tasks";

const STATUS_LABELS: Record<TaskSnapshot["status"], string> = {
  pending: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "已失败",
};

export function TaskProgressList({
  tasks,
  emptyHint = "暂无任务，点击上方按钮开始验证。",
}: {
  tasks: TaskSnapshot[];
  emptyHint?: string;
}) {
  if (tasks.length === 0) {
    return <p className="task-empty">{emptyHint}</p>;
  }

  return (
    <ul className="task-list" aria-live="polite">
      {tasks.map((task) => (
        <li className="task-item" key={task.id}>
          <div className="task-item-top">
            <p className="task-name">{task.name}</p>
            <span className={`task-state task-state-${task.status}`}>{STATUS_LABELS[task.status]}</span>
          </div>
          <p className="task-meta">{task.error ?? task.message ?? "等待状态更新"}</p>
          <div className="task-progress-row">
            <div
              className="task-progress-track"
              role="progressbar"
              aria-valuenow={task.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${task.name} 进度`}
            >
              <span className="task-progress-fill" style={{ width: `${task.progress}%` }} />
            </div>
            <span className="task-progress-text">{task.progress}%</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
