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
}));

vi.mock("../api/tasks", () => ({
  createTaskStream: vi.fn(),
}));

import { listLLMDatasets } from "../api/llmDatasets";
import {
  getLLMTrainingJob,
  listLLMTrainingJobs,
  startLLMTraining,
} from "../api/llmTraining";
import { type TaskEvent, createTaskStream } from "../api/tasks";
import { LLMTrainingPanel } from "./LLMTrainingPanel";

const mockListDatasets = vi.mocked(listLLMDatasets);
const mockGetLLMTrainingJob = vi.mocked(getLLMTrainingJob);
const mockListLLMTrainingJobs = vi.mocked(listLLMTrainingJobs);
const mockStartLLMTraining = vi.mocked(startLLMTraining);
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
  adapterPath: null,
  ggufPath: null,
  errorMessage: null,
  queueTaskId: "queue-1",
  createdAt: "2026-04-01T00:00:00Z",
  startedAt: "2026-04-01T00:01:00Z",
  completedAt: null,
};

beforeEach(() => {
  mockListDatasets.mockResolvedValue([baseDataset]);
  mockGetLLMTrainingJob.mockResolvedValue(baseJob);
  mockListLLMTrainingJobs.mockResolvedValue([baseJob]);
  mockStartLLMTraining.mockResolvedValue(baseJob);
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

test("shows both 3b and 7b as selectable training base models", async () => {
  render(<LLMTrainingPanel characterId="char-1" />);

  await screen.findByLabelText("基础模型");
  expect(screen.getByRole("option", { name: /Qwen2\.5 3B/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Qwen2\.5 7B/ })).toBeInTheDocument();
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
