import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CharacterDetailApiError, fetchCharacterDetail } from "./characterDetail";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("loads character detail payload", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: "char-1",
      name: "角色A",
      createdAt: "2026-03-28T00:00:00Z",
      fingerprint: null,
      dna: null,
      visual: null,
      voice: null,
    }),
  });

  const detail = await fetchCharacterDetail("char-1");
  expect(detail.id).toBe("char-1");
  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/characters/char-1", {
    signal: undefined,
  });
});

test("throws api detail in chinese when request fails", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ detail: "角色不存在" }),
  });

  await expect(fetchCharacterDetail("not-found")).rejects.toMatchObject({
    name: "CharacterDetailApiError",
    status: 404,
    message: "角色不存在",
  } satisfies Partial<CharacterDetailApiError>);
});
