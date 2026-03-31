import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { EngineStatusBadge } from "./EngineStatusBadge";

const fetchMock = vi.fn();

function buildStatus(overrides: Record<string, unknown> = {}) {
  return {
    state: "stopped",
    restartCount: 0,
    errorMessage: null,
    pid: null,
    ...overrides,
  };
}

function buildStatusResponse(status: Record<string, unknown>, message = "") {
  return { status, message };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("renders stopped state with start button", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildStatus({ state: "stopped" }),
  });

  render(<EngineStatusBadge pollIntervalMs={60000} />);

  await screen.findByText("图像引擎未启动");
  expect(screen.getByRole("button", { name: "启动图像引擎" })).toBeEnabled();
});

test("renders running state with stop button", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildStatus({ state: "running", pid: 1234 }),
  });

  render(<EngineStatusBadge pollIntervalMs={60000} />);

  await screen.findByText("图像引擎运行中");
  expect(screen.getByRole("button", { name: "停止图像引擎" })).toBeEnabled();
});

test("renders failed state with Chinese error message", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () =>
      buildStatus({
        state: "failed",
        restartCount: 4,
        errorMessage: "图像引擎多次崩溃后仍无法恢复，请检查 GPU 驱动是否正常",
      }),
  });

  render(<EngineStatusBadge pollIntervalMs={60000} />);

  await screen.findByText("图像引擎启动失败");
  expect(
    screen.getByText("图像引擎多次崩溃后仍无法恢复，请检查 GPU 驱动是否正常")
  ).toBeInTheDocument();
});

test("clicking start button calls startEngine and optimistically updates to starting", async () => {
  const user = userEvent.setup();

  // Initial poll → stopped
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildStatus({ state: "stopped" }),
    })
    // startEngine call → 202 starting
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildStatusResponse(buildStatus({ state: "starting" }), "图像引擎启动指令已发送"),
    });

  render(<EngineStatusBadge pollIntervalMs={60000} />);

  await screen.findByText("图像引擎未启动");
  await user.click(screen.getByRole("button", { name: "启动图像引擎" }));

  await screen.findByText("图像引擎启动中…");
});

test("clicking stop button calls stopEngine", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildStatus({ state: "running", pid: 999 }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildStatusResponse(buildStatus({ state: "stopped" }), "图像引擎已停止"),
    });

  render(<EngineStatusBadge pollIntervalMs={60000} />);

  await screen.findByText("图像引擎运行中");
  await user.click(screen.getByRole("button", { name: "停止图像引擎" }));

  await screen.findByText("图像引擎未启动");
});

test("shows GPU mutex error message in Chinese when start is blocked", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildStatus({ state: "stopped" }),
    })
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        detail: "训练任务正在运行中，无法启动图像引擎，请等待训练完成后再试",
      }),
    });

  render(<EngineStatusBadge pollIntervalMs={60000} />);

  await screen.findByText("图像引擎未启动");
  await user.click(screen.getByRole("button", { name: "启动图像引擎" }));

  await waitFor(() => {
    expect(
      screen.getByText("训练任务正在运行中，无法启动图像引擎，请等待训练完成后再试")
    ).toBeInTheDocument();
  });
});
