import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../api/visualDatasets", () => ({
  listVisualDatasets: vi.fn(),
}));

vi.mock("../api/visualTraining", () => ({
  startVisualTraining: vi.fn(),
  cancelVisualTraining: vi.fn(),
  getVisualTrainingJob: vi.fn(),
  listVisualTrainingJobs: vi.fn(),
}));

vi.mock("../api/tasks", () => ({
  createTaskStream: vi.fn(),
}));

import { createTaskStream, type TaskEvent } from "../api/tasks";
import { listVisualDatasets } from "../api/visualDatasets";
import { getVisualTrainingJob, listVisualTrainingJobs } from "../api/visualTraining";
import { VisualTrainingPanel } from "./VisualTrainingPanel";

const mockCreateTaskStream = vi.mocked(createTaskStream);
const mockListVisualDatasets = vi.mocked(listVisualDatasets);
const mockGetVisualTrainingJob = vi.mocked(getVisualTrainingJob);
const mockListVisualTrainingJobs = vi.mocked(listVisualTrainingJobs);

const baseDataset = {
  id: "dataset-1",
  characterId: "char-1",
  name: "角色图片",
  imageCount: 24,
  qualityScore: 0.72,
  qualityIssues: [],
  createdAt: "2026-04-01T00:00:00Z",
};

const baseJob = {
  id: "job-1",
  characterId: "char-1",
  datasetIds: ["dataset-1"],
  mode: "standard" as const,
  baseCheckpoint: "flux",
  triggerWord: "mely_char",
  status: "training",
  progress: 0.4,
  currentStep: 40,
  totalSteps: 100,
  etaSeconds: 180,
  loraPath: null,
  sampleImages: [],
  errorMessage: null,
  queueTaskId: "queue-1",
  createdAt: "2026-04-01T00:00:00Z",
  startedAt: "2026-04-01T00:01:00Z",
  completedAt: null,
};

beforeEach(() => {
  mockListVisualDatasets.mockResolvedValue([baseDataset]);
  mockGetVisualTrainingJob.mockResolvedValue(baseJob);
  mockListVisualTrainingJobs.mockResolvedValue([baseJob]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("shows lightweight notice and logs when single job detail refresh fails", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  let streamCallback: ((event: TaskEvent) => Promise<void> | void) | null = null;

  mockGetVisualTrainingJob.mockRejectedValueOnce(new Error("detail refresh failed"));
  mockCreateTaskStream.mockImplementation((cb) => {
    streamCallback = cb;
    return vi.fn();
  });

  render(<VisualTrainingPanel characterId="char-1" />);
  await waitFor(() => expect(streamCallback).not.toBeNull());
  await waitFor(() => {
    expect(screen.getByText(/job-1/)).toBeInTheDocument();
  });

  await streamCallback!({
    event: "task_updated",
    task: {
      id: "job-1",
      name: "visual-training-char-1",
      status: "running",
      progress: 41,
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
    "[VisualTrainingPanel] Failed to refresh job details",
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

  mockListVisualTrainingJobs.mockResolvedValueOnce([baseJob]).mockRejectedValueOnce(
    new Error("list refresh failed"),
  );
  mockCreateTaskStream.mockImplementation((cb) => {
    streamCallback = cb;
    return vi.fn();
  });

  render(<VisualTrainingPanel characterId="char-1" />);
  await waitFor(() => expect(streamCallback).not.toBeNull());

  await streamCallback!({
    event: "task_updated",
    task: {
      id: "job-2",
      name: "visual-training-char-1",
      status: "running",
      progress: 12,
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
    "[VisualTrainingPanel] Failed to refresh job list",
    expect.objectContaining({
      step: "refresh_job_list",
      characterId: "char-1",
      taskId: "job-2",
    }),
  );
});
