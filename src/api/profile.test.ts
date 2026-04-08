import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  fetchProfile,
  previewSystemPrompt,
  type CharacterProfileUpdate,
  ProfileApiError,
} from "./profile";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("fetchProfile returns null on 404", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ detail: "该角色尚未建立人设档案" }),
  });

  const result = await fetchProfile("char-empty");
  expect(result).toBeNull();
});

test("previewSystemPrompt sends draft payload", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      prompt: "草稿预览内容",
      estimatedTokens: 123,
      hasProfile: true,
      memoryCount: 1,
    }),
  });

  const draft: CharacterProfileUpdate = {
    personaSummary: "未保存草稿",
    speakingStyle: "简短自然",
    userAddress: "你",
    selfAddress: "我",
  };

  const result = await previewSystemPrompt("char-1", draft);

  expect(result.prompt).toBe("草稿预览内容");
  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/characters/char-1/profile/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    },
  );
});

test("previewSystemPrompt throws chinese detail when backend rejects", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: async () => ({ detail: "预览生成失败，请稍后重试" }),
  });

  await expect(
    previewSystemPrompt("char-1", {
      personaSummary: "草稿",
      userAddress: "你",
      selfAddress: "我",
    }),
  ).rejects.toMatchObject({
    name: "ProfileApiError",
    status: 500,
    message: "预览生成失败，请稍后重试",
  } satisfies Partial<ProfileApiError>);
});
