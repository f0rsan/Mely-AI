import { useCallback, useEffect, useMemo, useState } from "react";

import type { CharacterListItem } from "../api/characters";
import {
  fetchTrainingTask,
  fetchTrainingTasks,
  startTraining,
  type TrainingBusinessStatus,
  type TrainingMode,
  type TrainingQueueStatus,
  type TrainingTaskSnapshot,
} from "../api/training";
import {
  getTrainingMockFrames,
  listTrainingMockScenarios,
  type TrainingMockScenarioId,
} from "../mocks/trainingTimeline";

type SourceMode = "mock" | "api";
type RatingState = "up" | "down";

const BUSINESS_STATUS_LABELS: Record<TrainingBusinessStatus, string> = {
  draft: "草稿",
  queued: "排队中",
  preparing: "准备中",
  training: "训练中",
  sampling: "采样中",
  validating: "验证中",
  completed: "已完成",
  failed: "失败",
  canceled: "已终止",
};

const QUEUE_STATUS_LABELS: Record<TrainingQueueStatus, string> = {
  pending: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "已失败",
};

const VALIDATION_VIEW_LABELS: Record<string, string> = {
  front: "正面",
  three_quarter: "3/4 侧面",
  back: "背面",
  close_up: "特写",
};

function resolveTrainingErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "训练请求失败，请稍后重试。";
  }

  if (error.message === "TRAINING_SERVICE_UNAVAILABLE") {
    return "训练服务暂不可用，请确认后端已启动。";
  }
  if (error.message === "INVALID_TRAINING_RESPONSE") {
    return "训练数据格式异常，请稍后重试。";
  }
  if (error.message.trim().length > 0) {
    return error.message;
  }
  return "训练请求失败，请稍后重试。";
}

function resolveViewLabel(view: string | undefined): string {
  if (!view) {
    return "未命名视角";
  }
  return VALIDATION_VIEW_LABELS[view] ?? view;
}

function formatEta(etaSeconds: number | null): string {
  if (etaSeconds === null) {
    return "以最新状态消息为准";
  }
  if (etaSeconds <= 0) {
    return "即将完成";
  }
  const minutes = Math.floor(etaSeconds / 60);
  const seconds = etaSeconds % 60;
  if (minutes <= 0) {
    return `${seconds} 秒`;
  }
  return `${minutes} 分 ${seconds} 秒`;
}

function MockImage({ value, label }: { value: string; label: string }) {
  if (!value.startsWith("mock://")) {
    return <img className="training-image" src={value} alt={label} />;
  }

  return (
    <div className="training-image training-image-mock" role="img" aria-label={label}>
      <span>{label}</span>
      <small>{value.replace("mock://", "")}</small>
    </div>
  );
}

type TrainingProgressPanelProps = {
  character: CharacterListItem;
  onOpenDataset?: () => void;
};

export function TrainingProgressPanel({ character, onOpenDataset }: TrainingProgressPanelProps) {
  const mockScenarioOptions = useMemo(() => listTrainingMockScenarios(), []);
  const defaultScenario = (mockScenarioOptions[0]?.id ??
    "success_standard_3070_autodowngrade") as TrainingMockScenarioId;

  const [sourceMode, setSourceMode] = useState<SourceMode>("mock");
  const [mockScenarioId, setMockScenarioId] = useState<TrainingMockScenarioId>(defaultScenario);
  const [mockFrameIndex, setMockFrameIndex] = useState(0);

  const [apiTasks, setApiTasks] = useState<TrainingTaskSnapshot[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [apiCurrentTask, setApiCurrentTask] = useState<TrainingTaskSnapshot | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [ratings, setRatings] = useState<Record<string, RatingState | undefined>>({});
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isRetraining, setIsRetraining] = useState(false);
  const [retrainBlocker, setRetrainBlocker] = useState<string | null>(null);

  const mockFrames = useMemo(() => getTrainingMockFrames(mockScenarioId), [mockScenarioId]);
  const currentMockFrame = mockFrames[Math.min(mockFrameIndex, Math.max(mockFrames.length - 1, 0))];
  const currentTask = sourceMode === "mock" ? currentMockFrame?.task ?? null : apiCurrentTask;
  const etaSeconds = sourceMode === "mock" ? currentMockFrame?.etaSeconds ?? null : null;

  const satisfiedCount = Object.values(ratings).filter((value) => value === "up").length;
  const unsatisfiedCount = Object.values(ratings).filter((value) => value === "down").length;
  const retrainEnabled =
    currentTask !== null &&
    (currentTask.businessStatus === "completed" || currentTask.businessStatus === "failed");

  const loadApiTasks = useCallback(async () => {
    setApiError(null);
    setApiLoading(true);
    try {
      const tasks = await fetchTrainingTasks(character.id);
      setApiTasks(tasks);

      if (tasks.length === 0) {
        setSelectedTaskId(null);
        setApiCurrentTask(null);
        return;
      }

      setSelectedTaskId((current) => {
        if (current && tasks.some((task) => task.id === current)) {
          return current;
        }
        return tasks[0].id;
      });
    } catch (error) {
      setApiError(resolveTrainingErrorMessage(error));
    } finally {
      setApiLoading(false);
    }
  }, [character.id]);

  const loadApiTaskDetail = useCallback(async (taskId: string) => {
    try {
      const detail = await fetchTrainingTask(taskId);
      setApiCurrentTask(detail);
      setApiTasks((current) => {
        const exists = current.some((task) => task.id === detail.id);
        if (exists) {
          return current.map((task) => (task.id === detail.id ? detail : task));
        }
        return [detail, ...current];
      });
      setApiError(null);
    } catch (error) {
      setApiError(resolveTrainingErrorMessage(error));
    }
  }, []);

  const handleNextMockFrame = useCallback(() => {
    setMockFrameIndex((current) => {
      if (mockFrames.length === 0) {
        return 0;
      }
      return Math.min(current + 1, mockFrames.length - 1);
    });
  }, [mockFrames.length]);

  const handleResetMock = useCallback(() => {
    setMockFrameIndex(0);
    setRatings({});
    setActionFeedback(null);
  }, []);

  const handleChangeRating = useCallback((view: string, value: RatingState) => {
    setRatings((current) => ({
      ...current,
      [view]: current[view] === value ? undefined : value,
    }));
    setActionFeedback(null);
    setRetrainBlocker(null);
  }, []);

  const runRetrain = useCallback(
    async (
      targetMode: TrainingMode,
      successMessage: string,
      retrainStepDelta?: number,
    ) => {
      if (!currentTask) {
        setActionFeedback("当前没有可重训的训练任务。");
        return;
      }

      if (sourceMode === "mock") {
        setActionFeedback("Mock 模式仅用于联调演示，未发起真实重训任务。");
        return;
      }

      setIsRetraining(true);
      setActionFeedback(null);

      try {
        const created = await startTraining({
          characterId: character.id,
          mode: targetMode,
          baseModel: currentTask.requestedModel,
          retrainOfTaskId: currentTask.id,
          retrainStepDelta,
        });
        setApiCurrentTask(created);
        setSelectedTaskId(created.id);
        setApiTasks((current) => [created, ...current.filter((task) => task.id !== created.id)]);
        setActionFeedback(successMessage);
        setRetrainBlocker(null);
      } catch (error) {
        setActionFeedback(resolveTrainingErrorMessage(error));
      } finally {
        setIsRetraining(false);
      }
    },
    [character.id, currentTask, sourceMode],
  );

  const handleRetrain = useCallback(async () => {
    const mode = currentTask?.requestedMode ?? "standard";
    await runRetrain(mode, "重训任务已创建，正在排队。");
  }, [currentTask, runRetrain]);

  const handleRetrainWithMoreSteps = useCallback(async () => {
    if (!currentTask) {
      setActionFeedback("当前没有可重训的训练任务。");
      return;
    }

    await runRetrain(currentTask.requestedMode, "已创建同模式增步重训任务，正在排队。", 600);
  }, [currentTask, runRetrain]);

  useEffect(() => {
    setMockFrameIndex(0);
    setRatings({});
    setActionFeedback(null);
    setRetrainBlocker(null);
  }, [mockScenarioId]);

  useEffect(() => {
    if (sourceMode !== "api") {
      return;
    }
    void loadApiTasks();
  }, [loadApiTasks, sourceMode]);

  useEffect(() => {
    if (sourceMode !== "api" || !selectedTaskId) {
      return;
    }

    let canceled = false;
    const poll = async () => {
      await loadApiTaskDetail(selectedTaskId);
      if (canceled) {
        return;
      }
    };

    void poll();

    const timer = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [loadApiTaskDetail, selectedTaskId, sourceMode]);

  const visibleError =
    currentTask?.userVisibleError ??
    (currentTask?.businessStatus === "failed"
      ? currentTask.latestError ?? currentTask.latestMessage
      : null);

  return (
    <section className="training-panel" aria-labelledby="training-title">
      <div className="training-panel-top">
        <div>
          <h2 id="training-title">训练进度与验证</h2>
          <p className="training-panel-subtitle">当前角色：{character.name}</p>
        </div>
        <div className="training-source-switch">
          <button
            className={sourceMode === "mock" ? "source-active" : ""}
            type="button"
            onClick={() => setSourceMode("mock")}
          >
            Mock 联调
          </button>
          <button
            className={sourceMode === "api" ? "source-active" : ""}
            type="button"
            onClick={() => setSourceMode("api")}
          >
            真实 API
          </button>
        </div>
      </div>

      {sourceMode === "mock" ? (
        <div className="training-controls">
          <label className="training-select-label">
            Mock 场景
            <select
              aria-label="Mock 场景"
              value={mockScenarioId}
              onChange={(event) => setMockScenarioId(event.target.value as TrainingMockScenarioId)}
            >
              {mockScenarioOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={handleResetMock}>
            重置场景
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleNextMockFrame}>
            下一帧
          </button>
          <span className="training-frame-meta">
            帧进度 {Math.min(mockFrameIndex + 1, Math.max(mockFrames.length, 1))} / {Math.max(mockFrames.length, 1)}
          </span>
        </div>
      ) : (
        <div className="training-controls">
          <button type="button" className="btn btn-secondary" onClick={() => void loadApiTasks()}>
            刷新任务
          </button>
          {apiTasks.length > 0 ? (
            <label className="training-select-label">
              任务列表
              <select
                aria-label="任务列表"
                value={selectedTaskId ?? ""}
                onChange={(event) => setSelectedTaskId(event.target.value)}
              >
                {apiTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.id} · {BUSINESS_STATUS_LABELS[task.businessStatus]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="training-frame-meta">当前角色暂无训练任务</span>
          )}
        </div>
      )}

      {apiLoading && sourceMode === "api" ? <p className="training-inline-hint">正在读取训练任务...</p> : null}
      {apiError && sourceMode === "api" ? <p className="training-error-banner">{apiError}</p> : null}

      {currentTask ? (
        <>
          <div className="training-progress-card">
            <div className="training-progress-top">
              <p>业务状态：{BUSINESS_STATUS_LABELS[currentTask.businessStatus]}</p>
              <p>队列状态：{QUEUE_STATUS_LABELS[currentTask.queueStatus]}</p>
            </div>
            <p className="training-current-stage">当前阶段：{currentTask.currentStage}</p>
            <div
              className="training-progress-track"
              role="progressbar"
              aria-label="训练进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={currentTask.progress}
            >
              <span className="training-progress-fill" style={{ width: `${currentTask.progress}%` }} />
            </div>
            <div className="training-progress-meta">
              <span>{currentTask.progress}%</span>
              <span>预计剩余时间：{formatEta(etaSeconds)}</span>
            </div>
            <p className="training-latest-message">{currentTask.latestMessage ?? "等待状态更新..."}</p>
          </div>

          {visibleError ? <p className="training-error-banner">{visibleError}</p> : null}

          <section className="training-section">
            <div className="training-section-top">
              <h3>采样图时间线</h3>
              <span>固定节点：20 / 40 / 60 / 80 / 100</span>
            </div>
            {currentTask.samplePreviews.length === 0 ? (
              <p className="training-inline-hint">尚未产出采样图，训练推进后会自动显示。</p>
            ) : (
              <ul className="sample-grid" aria-live="polite">
                {currentTask.samplePreviews.map((sample) => {
                  const progressLabel = `${sample.progress ?? 0}%`;
                  return (
                    <li key={`${sample.image}-${progressLabel}`}>
                      <MockImage value={sample.image} label={`采样图 ${progressLabel}`} />
                      <p>{progressLabel}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="training-section">
            <div className="training-section-top">
              <h3>验证图</h3>
              <span>正面 / 3-4侧面 / 背面 / 特写</span>
            </div>
            {currentTask.validationImages.length === 0 ? (
              <p className="training-inline-hint">验证图会在训练完成后自动生成。</p>
            ) : (
              <>
                <ul className="validation-grid" aria-live="polite">
                  {currentTask.validationImages.map((image, index) => {
                    const viewLabel = resolveViewLabel(image.view);
                    const ratingKey = image.view ?? `${index}`;
                    const rating = ratings[ratingKey];

                    return (
                      <li key={`${image.image}-${ratingKey}`}>
                        <MockImage value={image.image} label={viewLabel} />
                        <p>{viewLabel}</p>
                        <div className="validation-actions">
                          <button
                            type="button"
                            aria-label={`${viewLabel} 满意`}
                            className={rating === "up" ? "rating-active-up" : ""}
                            onClick={() => handleChangeRating(ratingKey, "up")}
                          >
                            满意
                          </button>
                          <button
                            type="button"
                            aria-label={`${viewLabel} 不满意`}
                            className={rating === "down" ? "rating-active-down" : ""}
                            onClick={() => handleChangeRating(ratingKey, "down")}
                          >
                            不满意
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="training-inline-hint">
                  满意 {satisfiedCount} 张，不满意 {unsatisfiedCount} 张
                </p>
                {unsatisfiedCount > 0 ? (
                  <div className="training-advice-card">
                    <p className="training-advice-title">有不满意结果，建议立即重训优化</p>
                    <p className="training-inline-hint">
                      建议增加训练步数后重训，并补充缺失角度参考图。
                    </p>
                    <div className="training-advice-actions">
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => void handleRetrainWithMoreSteps()}
                        disabled={isRetraining || !retrainEnabled}
                      >
                        增加训练步数后重训
                      </button>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => {
                          onOpenDataset?.();
                        }}
                      >
                        去补充参考图
                      </button>
                    </div>
                    {retrainBlocker ? <p className="training-error-banner">{retrainBlocker}</p> : null}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </>
      ) : (
        <p className="training-inline-hint">当前暂无训练状态可展示。</p>
      )}

      <div className="training-retrain-row">
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void handleRetrain()}
          disabled={isRetraining || !retrainEnabled}
        >
          一键重训
        </button>
        {currentTask && !retrainEnabled ? (
          <p className="training-inline-hint">训练结束后可使用重训功能。</p>
        ) : null}
        {actionFeedback ? <p className="training-inline-hint">{actionFeedback}</p> : null}
      </div>
    </section>
  );
}
