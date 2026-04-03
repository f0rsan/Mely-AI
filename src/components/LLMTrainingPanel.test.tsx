import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { getLLMTrainingJob, listLLMTrainingJobs } from "../api/llmTraining";
import { type TaskEvent, createTaskStream } from "../api/tasks";
import { LLMTrainingPanel } from "./LLMTrainingPanel";

const mockListDatasets = vi.mocked(listLLMDatasets);
const mockGetLLMTrainingJob = vi.mocked(getLLMTrainingJob);
const mockListLLMTrainingJobs = vi.mocked(listLLMTrainingJobs);
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
  baseModel: "qwen2.5-7b",
  status: "training" as const,
  progress: 0.3,
  currentStep: 30,
  totalSteps: 100,
  loss: 1.2345,
  etaSeconds: 120,
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
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
