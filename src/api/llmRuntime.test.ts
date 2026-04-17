import { afterEach, expect, test, vi } from "vitest";
import { fetchLLMRuntimeReadiness } from "./llmRuntime";

afterEach(() => {
  vi.restoreAllMocks();
});

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
