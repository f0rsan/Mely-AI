import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { assemblePrompt } from "./prompt";

const fetchMock = vi.fn();

function buildResponse(overrides: Record<string, unknown> = {}) {
  return {
    assembled: "hoshino_mika, pink hair, school uniform, 在咖啡馆里看书",
    tokenCount: 8,
    wasOverridden: false,
    components: [
      { source: "trigger_word", label: "LoRA 触发词", content: "hoshino_mika", active: true },
      { source: "dna_prompt", label: "角色 DNA", content: "pink hair", active: true },
      { source: "costume_prompt", label: "造型词", content: "school uniform", active: true },
      { source: "scene_prompt", label: "场景描述", content: "在咖啡馆里看书", active: true },
    ],
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

test("assemblePrompt sends POST with correct payload", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildResponse(),
  });

  await assemblePrompt({
    scenePrompt: "在咖啡馆里看书",
    dnaPrompt: "pink hair",
    triggerWord: "hoshino_mika",
    costumePrompt: "school uniform",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/prompt/assemble",
    expect.objectContaining({ method: "POST" })
  );
});

test("assemblePrompt returns assembled prompt and components", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildResponse(),
  });

  const result = await assemblePrompt({ scenePrompt: "在咖啡馆里看书" });

  expect(result.assembled).toContain("hoshino_mika");
  expect(result.tokenCount).toBe(8);
  expect(result.wasOverridden).toBe(false);
  expect(result.components).toHaveLength(4);
});

test("assemblePrompt returns override response", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () =>
      buildResponse({
        assembled: "my custom prompt",
        wasOverridden: true,
        components: [
          { source: "override", label: "用户自定义", content: "my custom prompt", active: true },
        ],
      }),
  });

  const result = await assemblePrompt({
    scenePrompt: "anything",
    overridePrompt: "my custom prompt",
  });

  expect(result.wasOverridden).toBe(true);
  expect(result.assembled).toBe("my custom prompt");
});

test("assemblePrompt throws PROMPT_SERVICE_UNAVAILABLE on network error", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

  await expect(assemblePrompt({ scenePrompt: "test" })).rejects.toThrow(
    "PROMPT_SERVICE_UNAVAILABLE"
  );
});

test("assemblePrompt throws Chinese detail message on 422", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ detail: "请求参数不合法，请检查后重试" }),
  });

  await expect(assemblePrompt({ scenePrompt: "" })).rejects.toThrow(
    "请求参数不合法，请检查后重试"
  );
});
