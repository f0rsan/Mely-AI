import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { fetchHealth } from "./health";

const fetchMock = vi.fn();

function buildHealthResponse(overrides?: Record<string, unknown>) {
  return {
    status: "ok",
    app: "mely-backend",
    dataRoot: "/tmp/.mely-test",
    database: {
      path: "/tmp/.mely-test/db/mely.db",
      initialized: true,
      appliedMigrations: ["0001_initial_schema.sql"],
      error: null,
    },
    services: { api: "running" },
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

test("calls the local backend through an explicit desktop-safe URL", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildHealthResponse(),
  });

  await fetchHealth();

  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/health", {
    signal: undefined,
  });
});

test("returns structured bootstrap errors from non-200 responses", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () =>
      buildHealthResponse({
        status: "error",
        database: {
          path: "/tmp/.mely-test/db/mely.db",
          initialized: false,
          appliedMigrations: [],
          error: "bootstrap_failed",
        },
        error: "bootstrap_failed",
      }),
  });

  const result = await fetchHealth();

  expect(result.status).toBe("error");
  expect(result.error).toBe("bootstrap_failed");
});
