import { afterEach, expect, test, vi } from "vitest";
import { fetchLLMRuntime, fetchLLMRuntimeReadiness } from "./llmRuntime";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createAbortablePendingFetch() {
  return vi.fn().mockImplementation((_input: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        reject(error);
      };
      init?.signal?.addEventListener("abort", abort, { once: true });
    });
  });
}

test("maps readiness 404 to a packaged-backend mismatch message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not Found" }),
    }),
  );

  await expect(fetchLLMRuntimeReadiness()).rejects.toThrow(/安装包里的后端版本过旧/);
});

test("preserves explicit backend detail for readiness errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: "训练运行时管理器尚未初始化，请稍后重试。" }),
    }),
  );

  await expect(fetchLLMRuntimeReadiness()).rejects.toThrow(
    "训练运行时管理器尚未初始化，请稍后重试。",
  );
});

test("fails fast when runtime status fetch stalls", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", createAbortablePendingFetch());

  const promise = fetchLLMRuntime();
  const expectation = expect(promise).rejects.toThrow("语言引擎状态检测超时，请稍后重试。");
  await vi.advanceTimersByTimeAsync(8_100);
  await expectation;
});

test("fails fast when readiness fetch stalls", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", createAbortablePendingFetch());

  const promise = fetchLLMRuntimeReadiness();
  const expectation = expect(promise).rejects.toThrow("训练环境状态检测超时，请稍后重试。");
  await vi.advanceTimersByTimeAsync(60_100);
  await expectation;
});
