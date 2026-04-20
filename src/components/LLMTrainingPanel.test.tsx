import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../api/llmDatasets", () => ({
  listLLMDatasets: vi.fn(),
}));

vi.mock("../api/llmTraining", () => ({
  startLLMTraining: vi.fn(),
  cancelLLMTrainingJob: vi.fn(),
  getLLMTrainingJob: vi.fn(),
  listLLMTrainingJobs: vi.fn(),
  openLLMTrainingRunRoot: vi.fn(),
}));

vi.mock("../api/llmRuntime", () => ({
  fetchLLMRuntimeReadiness: vi.fn(),
  openLLMRuntime: vi.fn(),
  repairLLMRuntime: vi.fn(),
}));

vi.mock("../api/llmPull", () => ({
  pullLLMModel: vi.fn(),
}));

vi.mock("../api/tasks", () => ({
  createTaskStream: vi.fn(),
}));

import { listLLMDatasets } from "../api/llmDatasets";
import { pullLLMModel } from "../api/llmPull";
import {
  fetchLLMRuntimeReadiness,
  openLLMRuntime,
  repairLLMRuntime,
  type LLMRuntimeReadiness,
} from "../api/llmRuntime";
import {
  getLLMTrainingJob,
  listLLMTrainingJobs,
  openLLMTrainingRunRoot,
  startLLMTraining,
} from "../api/llmTraining";
import { type TaskEvent, createTaskStream } from "../api/tasks";
import { LLMTrainingPanel } from "./LLMTrainingPanel";

const mockListDatasets = vi.mocked(listLLMDatasets);
const mockGetLLMTrainingJob = vi.mocked(getLLMTrainingJob);
const mockListLLMTrainingJobs = vi.mocked(listLLMTrainingJobs);
const mockOpenLLMTrainingRunRoot = vi.mocked(openLLMTrainingRunRoot);
const mockStartLLMTraining = vi.mocked(startLLMTraining);
const mockFetchLLMRuntimeReadiness = vi.mocked(fetchLLMRuntimeReadiness);
const mockOpenLLMRuntime = vi.mocked(openLLMRuntime);
const mockRepairLLMRuntime = vi.mocked(repairLLMRuntime);
const mockPullLLMModel = vi.mocked(pullLLMModel);
const mockCreateTaskStream = vi.mocked(createTaskStream);

const baseDataset = {
  id: "dataset-1",
  characterId: "char-1",
  name: "角色语料",
  sourceFormat: "mixed" as const,
  itemCount: 120,
  qualityScore: 0.8,
  qualityIssues: [],
  convertedPath: null,
  createdAt: "2026-04-01T00:00:00Z",
};

const baseJob = {
  id: "job-1",
  characterId: "char-1",
  datasetIds: ["dataset-1"],
  mode: "standard" as const,
  baseModel: "qwen2.5:7b-instruct-q4_K_M",
  status: "training" as const,
  progress: 0.3,
  currentStep: 30,
  totalSteps: 100,
  loss: 1.2345,
  etaSeconds: 120,
  stageName: "正在训练",
  checkpointPath: "/tmp/mely/checkpoints/checkpoint-30",
  runRoot: "/tmp/mely/llm_training_runs/job-1",
  adapterPath: null,
  ggufPath: null,
  errorMessage: null,
  queueTaskId: "queue-1",
  createdAt: "2026-04-01T00:00:00Z",
  startedAt: "2026-04-01T00:01:00Z",
  completedAt: null,
};

function makeReadiness(
  overrides: Partial<LLMRuntimeReadiness> = {},
): LLMRuntimeReadiness {
  return {
    state: "ready",
    ready: true,
    message: "训练环境已就绪。",
    blockingReason: null,
    repairable: false,
    actions: [],
    installProgress: {
      active: false,
      percent: 100,
      stage: "completed",
      message: "训练运行时已就绪。",
      startedAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:01:00Z",
      attempt: 1,
      errorMessage: null,
    },
    hardware: {
      gpuModel: "NVIDIA RTX 3070",
      vramGB: 12,
      driverVersion: "551.86",
      cudaVersion: "12.1",
      driverCompatibility: "ok",
      cudaCompatibility: "ok",
      diskFreeGB: 100,
      diskRequiredGB: 12,
      source: "env",
      supportedModes: ["light", "standard", "fine"],
    },
    checks: {},
    ...overrides,
  };
}

beforeEach(() => {
  mockListDatasets.mockResolvedValue([baseDataset]);
  mockGetLLMTrainingJob.mockResolvedValue(baseJob);
  mockListLLMTrainingJobs.mockResolvedValue([baseJob]);
  mockOpenLLMTrainingRunRoot.mockResolvedValue(undefined);
  mockStartLLMTraining.mockResolvedValue(baseJob);
  mockFetchLLMRuntimeReadiness.mockResolvedValue(makeReadiness());
  mockOpenLLMRuntime.mockResolvedValue(undefined);
  mockRepairLLMRuntime.mockResolvedValue(
    makeReadiness({
      state: "installing_runtime",
      ready: false,
      message: "训练运行时正在安装/修复，请稍候。",
      blockingReason: "训练运行时正在安装中，请等待完成后重试。",
      repairable: true,
      installProgress: {
        active: true,
        percent: 35,
        stage: "bootstrap",
        message: "正在安装训练运行时…",
        startedAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-01T00:00:20Z",
        attempt: 1,
        errorMessage: null,
      },
    }),
  );
  mockPullLLMModel.mockResolvedValue(undefined);
  mockCreateTaskStream.mockImplementation(() => vi.fn());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("defaults training base model to qwen2.5:3b", async () => {
  render(<LLMTrainingPanel characterId="char-1" />);

  const selector = await screen.findByLabelText("基础模型");
  expect(selector).toHaveValue("qwen2.5:3b");
});

test("initial readiness check enables auto-fix for packaged runtime preparation", async () => {
  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByLabelText("基础模型");

  expect(mockFetchLLMRuntimeReadiness.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      mode: "standard",
      baseModel: "qwen2.5:3b",
      autoFix: true,
    }),
  );
});

test("shows readiness missing runtime and can install training environment", async () => {
  mockFetchLLMRuntimeReadiness.mockResolvedValueOnce(
    makeReadiness({
      state: "missing_runtime",
      ready: false,
      message: "训练运行时尚未安装。",
      blockingReason: "训练运行时缺失，请先执行“修复训练环境”。",
      repairable: true,
    }),
  );

  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByText("训练运行时未安装");
  fireEvent.click(screen.getByRole("button", { name: "安装训练环境" }));

  await waitFor(() => {
    expect(mockRepairLLMRuntime).toHaveBeenCalledTimes(1);
  });
});

test("shows readiness missing ollama and can open ollama action", async () => {
  mockFetchLLMRuntimeReadiness.mockResolvedValueOnce(
    makeReadiness({
      state: "missing_ollama",
      ready: false,
      message: "语言引擎未就绪。",
      blockingReason: "未检测到语言引擎，请先安装并启动 Ollama。",
    }),
  );

  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByText("Ollama 未安装或未启动");
  fireEvent.click(screen.getByRole("button", { name: "安装/启动 Ollama" }));

  await waitFor(() => {
    expect(mockOpenLLMRuntime).toHaveBeenCalledTimes(1);
  });
});

test("shows pulling state when downloading base model", async () => {
  mockFetchLLMRuntimeReadiness.mockResolvedValue(
    makeReadiness({
      state: "missing_inference_model",
      ready: false,
      message: "推理基础模型未就绪。",
      blockingReason: "基础模型“qwen2.5:3b”尚未在 Ollama 中就绪。请先下载完成后再训练。",
    }),
  );

  let resolvePull: (() => void) | null = null;
  mockPullLLMModel.mockImplementation(async (_modelName, onEvent) => {
    onEvent({ status: "downloading", phase: "正在下载", percent: 42 });
    await new Promise<void>((resolve) => {
      resolvePull = resolve;
    });
  });

  render(<LLMTrainingPanel characterId="char-1" />);
  await screen.findByText("基础模型尚未下载");

  fireEvent.click(screen.getByRole("button", { name: "下载基础模型" }));
  await screen.findByText("正在拉取 qwen2.5:3b");

  expect(mockPullLLMModel).toHaveBeenCalledWith(
    "qwen2.5:3b",
    expect.any(Function),
  );

  resolvePull?.();
});

test("downloads the selected base model when the user switches model", async () => {
  mockFetchLLMRuntimeReadiness.mockResolvedValue(
    makeReadiness({
      state: "missing_inference_model",
      ready: false,
      message: "推理基础模型未就绪。",
      blockingReason:
        "基础模型“qwen2.5:7b-instruct-q4_K_M”尚未在 Ollama 中就绪。请先下载完成后再训练。",
    }),
  );

  render(<LLMTrainingPanel characterId="char-1" />);
  const selector = await screen.findByLabelText("基础模型");
  fireEvent.change(selector, { target: { value: "qwen2.5:7b-instruct-q4_K_M" } });

  await screen.findByText("基础模型尚未下载");
  fireEvent.click(screen.getByRole("button", { name: "下载基础模型" }));

  await waitFor(() => {
    expect(mockPullLLMModel).toHaveBeenCalledWith(
      "qwen2.5:7b-instruct-q4_K_M",
      expect.any(Function),
    );
  });
});

test("shows preparing training base snapshot status", async () => {
  mockFetchLLMRuntimeReadiness.mockResolvedValueOnce(
    makeReadiness({
      state: "preparing_training_base_snapshot",
      ready: false,
      message: "正在准备训练模型基础权重。",
      blockingReason: "正在准备训练模型基础权重，请稍后重试。",
      installProgress: {
        active: true,
        percent: 80,
        stage: "snapshot",
        message: "正在恢复训练基础权重快照…",
        startedAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-01T00:00:20Z",
        attempt: 1,
        errorMessage: null,
      },
    }),
  );

  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByText("正在准备训练基础模型");
  expect(screen.getByText(/正在恢复训练基础权重快照/)).toBeInTheDocument();
});

test("disables fine mode on 8GB and shows reason", async () => {
  mockListLLMTrainingJobs.mockResolvedValueOnce([]);
  mockFetchLLMRuntimeReadiness.mockResolvedValueOnce(
    makeReadiness({
      hardware: {
        gpuModel: "NVIDIA RTX 3070",
        vramGB: 8,
        driverVersion: "551.86",
        cudaVersion: "12.1",
        driverCompatibility: "ok",
        cudaCompatibility: "ok",
        diskFreeGB: 100,
        diskRequiredGB: 12,
        source: "env",
        supportedModes: ["light", "standard"],
      },
    }),
  );

  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByText(/精细模式至少需要 12GB/);
  expect(screen.getByRole("button", { name: /standard/i })).toBeEnabled();
  const fineButton = screen.getByRole("button", { name: /fine/i });
  expect(fineButton).toBeDisabled();
});

test("shows unsupported platform without fine-mode vram warning", async () => {
  mockListLLMTrainingJobs.mockResolvedValueOnce([]);
  mockFetchLLMRuntimeReadiness.mockResolvedValueOnce(
    makeReadiness({
      state: "unsupported",
      ready: false,
      message: "当前系统不支持本机训练。",
      blockingReason: "当前系统为 macOS，LLM 微调运行时仅支持 Windows + NVIDIA GPU。",
      hardware: {
        gpuModel: "Apple GPU",
        vramGB: 8,
        driverVersion: null,
        cudaVersion: null,
        driverCompatibility: "unknown",
        cudaCompatibility: "unknown",
        diskFreeGB: 100,
        diskRequiredGB: 12,
        source: "env",
        supportedModes: [],
      },
    }),
  );

  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByText(/仅支持 Windows/);
  expect(screen.queryByText(/精细模式至少需要 12GB/)).not.toBeInTheDocument();
});

test("sends baseModel in start training payload", async () => {
  const queuedJob = {
    ...baseJob,
    id: "job-2",
    status: "queued" as const,
    progress: 0,
    currentStep: 0,
    totalSteps: 0,
    loss: null,
    etaSeconds: null,
    queueTaskId: "queue-2",
    startedAt: null,
  };
  mockListLLMTrainingJobs.mockResolvedValueOnce([]);
  mockStartLLMTraining.mockResolvedValueOnce(queuedJob);

  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByText("角色语料");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "开始训练" }));

  await waitFor(() => {
    expect(mockStartLLMTraining).toHaveBeenCalledWith(
      "char-1",
      expect.objectContaining({
        datasetIds: ["dataset-1"],
        mode: "standard",
        baseModel: "qwen2.5:3b",
      }),
    );
  });
});

test("shows step, total steps, loss, and ETA in active training card", async () => {
  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByText("当前 step");
  expect(screen.getByText("当前阶段")).toBeInTheDocument();
  expect(screen.getByText("最近 checkpoint")).toBeInTheDocument();
  expect(screen.getByText("总步数")).toBeInTheDocument();
  expect(screen.getByText("loss")).toBeInTheDocument();
  expect(screen.getByText("ETA")).toBeInTheDocument();
  expect(screen.getByText("正在训练")).toBeInTheDocument();
  expect(screen.getByText("/tmp/mely/checkpoints/checkpoint-30")).toBeInTheDocument();
  expect(screen.getByText("30")).toBeInTheDocument();
  expect(screen.getByText("100")).toBeInTheDocument();
  expect(screen.getByText("1.2345")).toBeInTheDocument();
  expect(screen.getByText("约 2 分钟")).toBeInTheDocument();
});

test("opens run root from training panel", async () => {
  render(<LLMTrainingPanel characterId="char-1" />);

  const buttons = await screen.findAllByRole("button", { name: "打开运行目录" });
  fireEvent.click(buttons[0]);

  await waitFor(() => {
    expect(mockOpenLLMTrainingRunRoot).toHaveBeenCalledWith("job-1");
  });
});

test("shows registration-retry hint area when backend returns retry message", async () => {
  mockListLLMTrainingJobs.mockResolvedValueOnce([
    {
      ...baseJob,
      id: "job-2",
      status: "completed",
      progress: 1,
      currentStep: 100,
      totalSteps: 100,
      etaSeconds: null,
      errorMessage: "模型注册失败，稍后会自动重试",
      completedAt: "2026-04-01T00:20:00Z",
    },
  ]);

  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByText("模型注册待重试");
  expect(screen.getByText("模型注册失败，稍后会自动重试")).toBeInTheDocument();
});

test("shows lightweight notice and logs when single job detail refresh fails", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  let streamCallback: ((event: TaskEvent) => Promise<void> | void) | null = null;

  mockGetLLMTrainingJob.mockRejectedValueOnce(new Error("detail refresh failed"));
  mockCreateTaskStream.mockImplementation((cb) => {
    streamCallback = cb;
    return vi.fn();
  });

  render(<LLMTrainingPanel characterId="char-1" />);
  await waitFor(() => expect(streamCallback).not.toBeNull());
  await waitFor(() => {
    expect(screen.getByText(/job-1/)).toBeInTheDocument();
  });

  await streamCallback!({
    event: "task_updated",
    task: {
      id: "job-1",
      name: "llm-training-char-1",
      status: "running",
      progress: 33,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:01Z",
      message: null,
      error: null,
    },
  });

  await waitFor(() => {
    expect(screen.getByText("任务详情刷新失败，状态可能稍有延迟")).toBeInTheDocument();
  });
  expect(consoleSpy).toHaveBeenCalledWith(
    "[LLMTrainingPanel] Failed to refresh job details",
    expect.objectContaining({
      step: "refresh_job_detail",
      characterId: "char-1",
      jobId: "job-1",
    }),
  );
});

test("shows lightweight notice and logs when job list refresh fails", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  let streamCallback: ((event: TaskEvent) => Promise<void> | void) | null = null;

  mockListLLMTrainingJobs.mockResolvedValueOnce([baseJob]).mockRejectedValueOnce(
    new Error("list refresh failed"),
  );
  mockCreateTaskStream.mockImplementation((cb) => {
    streamCallback = cb;
    return vi.fn();
  });

  render(<LLMTrainingPanel characterId="char-1" />);
  await waitFor(() => expect(streamCallback).not.toBeNull());

  await streamCallback!({
    event: "task_updated",
    task: {
      id: "job-2",
      name: "llm-training-char-1",
      status: "running",
      progress: 10,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:01Z",
      message: null,
      error: null,
    },
  });

  await waitFor(() => {
    expect(screen.getByText("训练列表刷新失败，稍后会自动重试")).toBeInTheDocument();
  });
  expect(consoleSpy).toHaveBeenCalledWith(
    "[LLMTrainingPanel] Failed to refresh job list",
    expect.objectContaining({
      step: "refresh_job_list",
      characterId: "char-1",
      taskId: "job-2",
    }),
  );
});
