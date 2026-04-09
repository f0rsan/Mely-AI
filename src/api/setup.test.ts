import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { fetchSetupStatus } from "./setup";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("returns setup status when backend payload is valid", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      backend: {
        status: "ok",
        dataRoot: "C:/Users/demo/.mely",
        databaseInitialized: true,
      },
      gpu: {
        vramGB: 8,
        source: "env",
        result: "ok",
        recommendedMode: "standard",
        target3070Ready: true,
        fineTuneReady: false,
        recommendation: "符合 RTX 3070 8GB 目标基线，建议先从标准视觉流程开始。",
      },
      llm: {
        installed: true,
        running: false,
        version: "0.6.0",
        minimumVersion: "0.3.10",
        platform: "win32-amd64",
        models: [],
        hint: "语言引擎未启动，请点击启动按钮后重试。",
      },
      imageEngine: {
        state: "stopped",
        restartCount: 0,
        errorMessage: null,
        pid: null,
      },
      ttsEngine: {
        state: "failed",
        restartCount: 1,
        errorMessage: "TTS 引擎启动失败",
        pid: null,
      },
    }),
  });

  const result = await fetchSetupStatus();

  expect(result.gpu.vramGB).toBe(8);
  expect(result.llm.installed).toBe(true);
  expect(result.imageEngine.state).toBe("stopped");
});

test("throws a chinese error when setup endpoint is unavailable", async () => {
  fetchMock.mockRejectedValueOnce(new Error("network down"));

  await expect(fetchSetupStatus()).rejects.toThrow("环境状态检测失败，请确认本地后端已经启动。");
});
