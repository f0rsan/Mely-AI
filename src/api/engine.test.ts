import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { fetchEngineStatus, startEngine, stopEngine } from "./engine";

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

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("fetchEngineStatus returns stopped state on fresh backend", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildStatus(),
  });

  const result = await fetchEngineStatus();

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/engine/status",
    { signal: undefined }
  );
  expect(result.state).toBe("stopped");
  expect(result.restartCount).toBe(0);
  expect(result.errorMessage).toBeNull();
});

test("startEngine returns 202 with starting state", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: buildStatus({ state: "starting" }),
      message: "图像引擎启动指令已发送",
    }),
  });

  const result = await startEngine();

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/engine/start",
    { method: "POST", signal: undefined }
  );
  expect(result.status.state).toBe("starting");
  expect(result.message).toBe("图像引擎启动指令已发送");
});

test("startEngine throws Chinese message when GPU mutex conflict (409)", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({
      detail: "训练任务正在运行中，无法启动图像引擎，请等待训练完成后再试",
    }),
  });

  await expect(startEngine()).rejects.toThrow("训练任务正在运行中");
});

test("startEngine throws ENGINE_SERVICE_UNAVAILABLE on network error", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

  await expect(startEngine()).rejects.toThrow("ENGINE_SERVICE_UNAVAILABLE");
});

test("stopEngine returns 200 with stopped state", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: buildStatus({ state: "stopped" }),
      message: "图像引擎已停止",
    }),
  });

  const result = await stopEngine();

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/engine/stop",
    { method: "POST", signal: undefined }
  );
  expect(result.status.state).toBe("stopped");
  expect(result.message).toBe("图像引擎已停止");
});

test("fetchEngineStatus returns failed state with Chinese error message", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () =>
      buildStatus({
        state: "failed",
        restartCount: 4,
        errorMessage: "图像引擎多次崩溃后仍无法恢复，请检查 GPU 驱动是否正常",
      }),
  });

  const result = await fetchEngineStatus();

  expect(result.state).toBe("failed");
  expect(result.restartCount).toBe(4);
  expect(result.errorMessage).toContain("崩溃");
});
