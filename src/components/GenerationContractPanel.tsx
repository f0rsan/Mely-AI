import { useEffect, useState } from "react";

import {
  createMockGenerationJob,
  fetchGenerationWorkbenchContract,
  mergeTaskIntoGenerationJob,
  type GenerationMockJob,
  type GenerationWorkbenchContract,
} from "../api/generations";
import { createTaskStream, type TaskConnectionState } from "../api/tasks";

type ContractState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; contract: GenerationWorkbenchContract };

export function GenerationContractPanel({
  characterId,
  characterName,
}: {
  characterId: string;
  characterName: string;
}) {
  const [state, setState] = useState<ContractState>({ kind: "loading" });
  const [job, setJob] = useState<GenerationMockJob | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [taskConnection, setTaskConnection] = useState<TaskConnectionState>("connecting");

  useEffect(() => {
    const abortController = new AbortController();
    setState({ kind: "loading" });

    void fetchGenerationWorkbenchContract(characterId, abortController.signal)
      .then((contract) => {
        setState({ kind: "ready", contract });
      })
      .catch((error: Error) => {
        setState({
          kind: "error",
          message:
            error.message === "GENERATION_CONTRACT_UNAVAILABLE"
              ? "生成工作台契约加载失败，请稍后重试。"
              : error.message,
        });
      });

    return () => {
      abortController.abort();
    };
  }, [characterId]);

  useEffect(() => {
    const disconnect = createTaskStream(
      (event) => {
        setJob((current) => {
          if (current === null || event.task.id !== current.taskId) {
            return current;
          }

          return mergeTaskIntoGenerationJob(current, event.task);
        });
      },
      setTaskConnection,
    );

    return () => {
      disconnect();
    };
  }, []);

  async function handleSubmitMockJob() {
    if (state.kind !== "ready") {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await createMockGenerationJob({
        characterId,
        costumeId: state.contract.selectedCostumeId,
        scenePrompt: "契约验证场景：在直播封面中微笑看向镜头",
        negativePrompt: "",
        width: state.contract.parameterDefaults.width,
        height: state.contract.parameterDefaults.height,
        steps: state.contract.parameterDefaults.steps,
        sampler: state.contract.parameterDefaults.sampler,
        cfgScale: state.contract.parameterDefaults.cfgScale,
        seed: state.contract.parameterDefaults.seed,
        loraWeight: state.contract.parameterDefaults.loraWeight,
        tags: state.contract.tagOptions.slice(0, 1),
      });

      setJob(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交契约验证任务失败，请稍后重试。";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <section className="generation-contract-panel">
        <h2>生成主链路契约</h2>
        <p>正在加载 {characterName} 的生成契约...</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="generation-contract-panel">
        <h2>生成主链路契约</h2>
        <p className="generation-contract-error">{state.message}</p>
      </section>
    );
  }

  const { contract } = state;

  return (
    <section className="generation-contract-panel" aria-labelledby="generation-contract-title">
      <div className="generation-contract-header">
        <div>
          <p className="eyebrow">M2-B</p>
          <h2 id="generation-contract-title">生成主链路契约</h2>
        </div>
        <span className={`task-connection task-connection-${taskConnection}`}>
          {taskConnection === "connected" ? "任务流已连接" : "任务流连接中"}
        </span>
      </div>

      <p className="generation-contract-lead">
        这一层先固定“能不能生成、要提交什么、进度怎么返回”，真实图像引擎将在后续叶子任务接入。
      </p>

      <div className="generation-contract-grid">
        <article className="generation-contract-card">
          <h3>生成就绪状态</h3>
          <p className={contract.canGenerate ? "generation-ready" : "generation-blocked"}>
            {contract.canGenerate ? "该角色已满足生成前置条件。" : contract.blockingReason}
          </p>
          <h4>可用造型</h4>
          <ul className="generation-contract-list">
            {contract.costumes.map((costume) => (
              <li key={costume.id}>
                <span>{costume.name}</span>
                {costume.isDefault ? "（默认）" : ""}
              </li>
            ))}
          </ul>
        </article>

        <article className="generation-contract-card">
          <h3>Prompt 来源</h3>
          <dl className="generation-contract-definition">
            <div>
              <dt>DNA Prompt</dt>
              <dd>{contract.promptSources.dnaPrompt || "暂无"}</dd>
            </div>
            <div>
              <dt>触发词</dt>
              <dd>{contract.promptSources.triggerWord || "暂无"}</dd>
            </div>
            <div>
              <dt>造型附加</dt>
              <dd>{contract.promptSources.costumePrompt || "暂无"}</dd>
            </div>
          </dl>
        </article>

        <article className="generation-contract-card">
          <h3>默认参数</h3>
          <dl className="generation-contract-definition">
            <div>
              <dt>尺寸</dt>
              <dd>
                {contract.parameterDefaults.width} × {contract.parameterDefaults.height}
              </dd>
            </div>
            <div>
              <dt>Steps</dt>
              <dd>{contract.parameterDefaults.steps}</dd>
            </div>
            <div>
              <dt>Sampler</dt>
              <dd>{contract.parameterDefaults.sampler}</dd>
            </div>
            <div>
              <dt>CFG</dt>
              <dd>{contract.parameterDefaults.cfgScale}</dd>
            </div>
            <div>
              <dt>LoRA 权重</dt>
              <dd>{contract.parameterDefaults.loraWeight}</dd>
            </div>
          </dl>
          <p className="generation-contract-tags">默认用途标签：{contract.tagOptions.join(" / ")}</p>
        </article>
      </div>

      <div className="generation-contract-actions">
        <button
          className="btn btn-primary"
          type="button"
          onClick={handleSubmitMockJob}
          disabled={!contract.canGenerate || submitting}
        >
          提交契约验证任务
        </button>
        {submitError ? <p className="generation-contract-error">{submitError}</p> : null}
      </div>

      {job ? (
        <div className="generation-job-card">
          <p className="generation-job-title">当前契约任务</p>
          <p>{job.scenePrompt}</p>
          <p>阶段：{job.stage}</p>
          <p>
            进度：<span>{job.progress}%</span>
          </p>
          <p>{job.error ?? job.message ?? "等待任务更新..."}</p>
        </div>
      ) : null}
    </section>
  );
}
