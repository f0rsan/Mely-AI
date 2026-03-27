import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";

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
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("renders backend health details after a successful fetch", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildHealthResponse(),
  });

  render(<App />);

  expect(screen.getByText("正在连接后端...")).toBeInTheDocument();

  await screen.findByText("后端连接正常");
  expect(screen.getByText("/tmp/.mely-test")).toBeInTheDocument();
  expect(screen.getByText("/tmp/.mely-test/db/mely.db")).toBeInTheDocument();
});

test("shows a Chinese retry flow when the backend request fails", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockRejectedValueOnce(new Error("network down"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildHealthResponse(),
    });

  render(<App />);

  await screen.findByText("后端未启动，请重试");

  await user.click(screen.getByRole("button", { name: "重试连接" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  await screen.findByText("后端连接正常", { selector: ".value.success" });
});

test("shows a dedicated Chinese state when local bootstrap fails", async () => {
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

  render(<App />);

  await screen.findByText("本地初始化失败");
  expect(screen.getByText("/tmp/.mely-test")).toBeInTheDocument();
  expect(screen.getByText("/tmp/.mely-test/db/mely.db")).toBeInTheDocument();
  expect(screen.getByText("请检查数据目录权限后重试")).toBeInTheDocument();
});
