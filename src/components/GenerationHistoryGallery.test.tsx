import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { GenerationHistoryGallery } from "./GenerationHistoryGallery";

const fetchMock = vi.fn();

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "gen-1",
    characterId: "char-1",
    costumeId: "costume-1",
    outputPath: "/tmp/.mely/characters/char-1/generations/gen-1.png",
    paramsSnapshot: {
      assembledPrompt: "hoshino_mika, pink hair, 在咖啡馆",
      negativePrompt: "",
      width: 1024,
      height: 1024,
      steps: 28,
      sampler: "DPM++ 2M Karras",
      cfgScale: 3.5,
      seed: 42,
      loraWeight: 0.85,
    },
    tags: ["封面图"],
    createdAt: "2026-03-31T00:00:00Z",
    ...overrides,
  };
}

const costumes = [
  { id: "costume-1", name: "基础造型" },
  { id: "costume-2", name: "活动造型" },
];

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("shows loading state initially", () => {
  fetchMock.mockReturnValue(new Promise(() => {}));

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText("正在加载历史记录…")).toBeInTheDocument();
});

test("renders thumbnail grid after records load", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      items: [buildRecord(), buildRecord({ id: "gen-2", paramsSnapshot: { assembledPrompt: "在海边", width: 512, height: 512, steps: 20, sampler: "Euler a", cfgScale: 7, seed: null, loraWeight: 0.8 } })],
    }),
  });

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  const grid = await screen.findByRole("list", { name: "生成历史缩略图" });
  expect(within(grid).getAllByRole("listitem")).toHaveLength(2);
});

test("shows 暂无生成记录 for empty list", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items: [] }),
  });

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  await screen.findByText("暂无生成记录");
});

test("shows error message when fetch fails", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("历史记录加载失败，请稍后重试。");
});

test("clicking a thumbnail opens detail modal", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items: [buildRecord()] }),
  });

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  await screen.findByRole("list", { name: "生成历史缩略图" });
  await user.click(screen.getByRole("button", { name: /查看生成记录 gen-1/ }));

  const dialog = screen.getByRole("dialog", { name: "生成详情" });
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByText("基础造型")).toBeInTheDocument();
  expect(within(dialog).getByText("42")).toBeInTheDocument();
});

test("closing modal removes it from DOM", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items: [buildRecord()] }),
  });

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  await screen.findByRole("list", { name: "生成历史缩略图" });
  await user.click(screen.getByRole("button", { name: /查看生成记录 gen-1/ }));
  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("onRegenerate callback called with correct params", async () => {
  const user = userEvent.setup();
  const onRegenerate = vi.fn();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items: [buildRecord()] }),
  });

  render(
    <GenerationHistoryGallery
      characterId="char-1"
      costumes={costumes}
      onRegenerate={onRegenerate}
    />,
  );

  await screen.findByRole("list", { name: "生成历史缩略图" });
  await user.click(screen.getByRole("button", { name: /查看生成记录 gen-1/ }));
  await user.click(screen.getByRole("button", { name: "用此参数重新生成" }));

  expect(onRegenerate).toHaveBeenCalledWith(
    expect.objectContaining({
      costumeId: "costume-1",
      assembledPrompt: "hoshino_mika, pink hair, 在咖啡馆",
      seed: 42,
      steps: 28,
    }),
  );
  // Modal should close after regenerate.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("costume filter hides records from other costumes", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      items: [
        buildRecord({ id: "gen-1", costumeId: "costume-1" }),
        buildRecord({ id: "gen-2", costumeId: "costume-2", paramsSnapshot: { assembledPrompt: "活动造型场景", width: 512, height: 512, steps: 20, sampler: "Euler a", cfgScale: 7, seed: null, loraWeight: 0.8 } }),
      ],
    }),
  });

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  await screen.findByRole("list", { name: "生成历史缩略图" });
  expect(within(screen.getByRole("list", { name: "生成历史缩略图" })).getAllByRole("listitem")).toHaveLength(2);

  await user.selectOptions(screen.getByRole("combobox", { name: "按造型筛选" }), "costume-1");

  expect(within(screen.getByRole("list", { name: "生成历史缩略图" })).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /查看生成记录 gen-1/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /查看生成记录 gen-2/ })).not.toBeInTheDocument();
});

test("tag filter shows only matching records", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      items: [
        buildRecord({ id: "gen-1", tags: ["封面图"] }),
        buildRecord({ id: "gen-2", tags: ["表情包"], paramsSnapshot: { assembledPrompt: "表情包场景", width: 512, height: 512, steps: 20, sampler: "Euler a", cfgScale: 7, seed: null, loraWeight: 0.8 } }),
      ],
    }),
  });

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  await screen.findByRole("list", { name: "生成历史缩略图" });

  await user.selectOptions(screen.getByRole("combobox", { name: "按标签筛选" }), "封面图");

  const items = within(screen.getByRole("list", { name: "生成历史缩略图" })).getAllByRole("listitem");
  expect(items).toHaveLength(1);
  expect(screen.getByRole("button", { name: /查看生成记录 gen-1/ })).toBeInTheDocument();
});

test("record count shows correctly after filtering", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      items: [
        buildRecord({ id: "gen-1", tags: ["封面图"] }),
        buildRecord({ id: "gen-2", tags: ["表情包"], paramsSnapshot: { assembledPrompt: "b", width: 512, height: 512, steps: 20, sampler: "Euler a", cfgScale: 7, seed: null, loraWeight: 0.8 } }),
        buildRecord({ id: "gen-3", tags: ["封面图"], paramsSnapshot: { assembledPrompt: "c", width: 512, height: 512, steps: 20, sampler: "Euler a", cfgScale: 7, seed: null, loraWeight: 0.8 } }),
      ],
    }),
  });

  render(
    <GenerationHistoryGallery characterId="char-1" costumes={costumes} />,
  );

  await screen.findByText("共 3 条记录");

  await user.selectOptions(screen.getByRole("combobox", { name: "按标签筛选" }), "封面图");

  expect(screen.getByText("共 2 条记录")).toBeInTheDocument();
});
