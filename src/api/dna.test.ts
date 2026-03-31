import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  CharacterDnaApiError,
  fetchCharacterDnaSuggestions,
  saveCharacterDna,
} from "./dna";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function buildSuggestions() {
  return {
    characterId: "char-1",
    source: "manual_default",
    fields: {
      hairColor: {
        label: "发色",
        recommended: "黑色",
        recommendedPrompt: "black hair",
        options: [
          { value: "黑色", prompt: "black hair" },
          { value: "银色", prompt: "silver hair" },
        ],
      },
      eyeColor: {
        label: "瞳色",
        recommended: "棕色",
        recommendedPrompt: "brown eyes",
        options: [
          { value: "棕色", prompt: "brown eyes" },
          { value: "红色", prompt: "red eyes" },
        ],
      },
      skinTone: {
        label: "肤色",
        recommended: "白皙",
        recommendedPrompt: "fair skin",
        options: [
          { value: "白皙", prompt: "fair skin" },
          { value: "小麦色", prompt: "tan skin" },
        ],
      },
      bodyType: {
        label: "体型",
        recommended: "纤细",
        recommendedPrompt: "slim body",
        options: [
          { value: "纤细", prompt: "slim body" },
          { value: "匀称", prompt: "proportional body" },
        ],
      },
      style: {
        label: "风格",
        recommended: "二次元",
        recommendedPrompt: "anime style",
        options: [
          { value: "二次元", prompt: "anime style" },
          { value: "写实", prompt: "realistic style" },
        ],
      },
    },
    autoPromptPreview: "black hair, brown eyes, fair skin, slim body, anime style",
    wd14: {
      available: false,
      modelId: null,
      reason: "WD14 模型未就绪，已使用手动建议值。",
      tags: [],
    },
  };
}

test("loads dna suggestions", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildSuggestions(),
  });

  const data = await fetchCharacterDnaSuggestions("char-1");
  expect(data.fields.hairColor.recommended).toBe("黑色");
  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/api/characters/char-1/dna/suggestions",
    { signal: undefined },
  );
});

test("saves dna payload via put", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: "char-1",
      name: "角色",
      createdAt: "2026-03-28T00:00:00Z",
      fingerprint: null,
      dna: {
        hairColor: "银色",
        eyeColor: "红色",
        skinTone: "白皙",
        bodyType: "纤细",
        style: "写实",
        extraTags: [],
        autoPrompt: "silver hair, red eyes, fair skin, slim body, realistic style",
      },
      visual: null,
      voice: null,
    }),
  });

  await saveCharacterDna("char-1", {
    hairColor: "银色",
    eyeColor: "红色",
    skinTone: "白皙",
    bodyType: "纤细",
    style: "写实",
  });

  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:8000/api/characters/char-1/dna");
  expect(options.method).toBe("PUT");
  expect(options.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(options.body as string)).toMatchObject({
    hairColor: "银色",
    eyeColor: "红色",
    skinTone: "白皙",
    bodyType: "纤细",
    style: "写实",
  });
});

test("throws chinese api detail when save fails", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({ detail: "DNA 保存失败，请稍后重试" }),
  });

  await expect(
    saveCharacterDna("char-1", {
      hairColor: "银色",
      eyeColor: "红色",
      skinTone: "白皙",
      bodyType: "纤细",
      style: "写实",
    }),
  ).rejects.toMatchObject({
    name: "CharacterDnaApiError",
    status: 400,
    message: "DNA 保存失败，请稍后重试",
  } satisfies Partial<CharacterDnaApiError>);
});
