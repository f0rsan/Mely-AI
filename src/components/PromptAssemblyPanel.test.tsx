import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { PromptAssemblyPanel } from "./PromptAssemblyPanel";

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

const DEFAULT_PROPS = {
  dnaPrompt: "pink hair",
  triggerWord: "hoshino_mika",
  costumePrompt: "school uniform",
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

test("renders scene prompt input and no result initially", () => {
  render(<PromptAssemblyPanel {...DEFAULT_PROPS} />);
  expect(screen.getByPlaceholderText(/在直播封面/)).toBeInTheDocument();
  expect(screen.queryByText("组装结果")).not.toBeInTheDocument();
});

test("shows assembled result after typing scene prompt", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => buildResponse(),
  });

  render(<PromptAssemblyPanel {...DEFAULT_PROPS} />);

  await user.type(screen.getByPlaceholderText(/在直播封面/), "在咖啡馆里看书");

  await screen.findByText(/组装结果/);
  expect(
    screen.getByText("hoshino_mika, pink hair, school uniform, 在咖啡馆里看书")
  ).toBeInTheDocument();
});

test("shows component breakdown with labels", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => buildResponse(),
  });

  render(<PromptAssemblyPanel {...DEFAULT_PROPS} />);
  await user.type(screen.getByPlaceholderText(/在直播封面/), "在咖啡馆里看书");

  // Component breakdown labels appear inside the breakdown section.
  const breakdown = await screen.findByText("LoRA 触发词");
  expect(breakdown).toBeInTheDocument();
  expect(screen.getByText("角色 DNA")).toBeInTheDocument();
  expect(screen.getByText("造型词")).toBeInTheDocument();
  // "场景描述" label appears in the breakdown (may appear multiple times — just assert presence).
  expect(screen.getAllByText("场景描述").length).toBeGreaterThanOrEqual(1);
});

test("entering override mode shows textarea with assembled text", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => buildResponse(),
  });

  render(<PromptAssemblyPanel {...DEFAULT_PROPS} />);
  await user.type(screen.getByPlaceholderText(/在直播封面/), "在咖啡馆里看书");
  await screen.findByText(/高级模式/);

  await user.click(screen.getByRole("button", { name: /高级模式/ }));

  expect(screen.getByText(/完整 Prompt/)).toBeInTheDocument();
  const textarea = screen.getAllByRole("textbox").find(
    (el) => (el as HTMLTextAreaElement).value.includes("hoshino_mika")
  );
  expect(textarea).toBeTruthy();
});

test("calls onConfirm with assembled prompt when confirm button clicked", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => buildResponse(),
  });

  const onConfirm = vi.fn();
  render(<PromptAssemblyPanel {...DEFAULT_PROPS} onConfirm={onConfirm} />);
  await user.type(screen.getByPlaceholderText(/在直播封面/), "在咖啡馆里看书");
  await screen.findByRole("button", { name: "使用此 Prompt" });

  await user.click(screen.getByRole("button", { name: "使用此 Prompt" }));

  expect(onConfirm).toHaveBeenCalledWith(
    "hoshino_mika, pink hair, school uniform, 在咖啡馆里看书",
    false
  );
});

test("shows error message on fetch failure", async () => {
  const user = userEvent.setup();
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

  render(<PromptAssemblyPanel {...DEFAULT_PROPS} />);
  await user.type(screen.getByPlaceholderText(/在直播封面/), "x");

  await waitFor(() => {
    expect(screen.getByText("PROMPT_SERVICE_UNAVAILABLE")).toBeInTheDocument();
  });
});
