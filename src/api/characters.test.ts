import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createCharacter } from "./characters";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("createCharacter calls create endpoint and maps returned detail into list item", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: "char-100",
      name: "新角色",
      createdAt: "2026-04-07T10:00:00Z",
      fingerprint: null,
      dna: null,
      visual: null,
      voice: null,
    }),
  });

  const created = await createCharacter("新角色");

  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "新角色" }),
  });
  expect(created).toEqual({
    id: "char-100",
    name: "新角色",
    createdAt: "2026-04-07T10:00:00Z",
    fingerprint: null,
  });
});

test("createCharacter prefers backend chinese detail message", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ detail: "角色名称不能为空" }),
  });

  await expect(createCharacter("")).rejects.toThrow("角色名称不能为空");
});

test("createCharacter falls back to default chinese message when detail is missing", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: "bad request" }),
  });

  await expect(createCharacter("新角色")).rejects.toThrow("创建角色失败，请重试");
});
