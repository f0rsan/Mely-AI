import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  fetchMemories,
  fetchProfile,
  previewSystemPrompt,
  saveProfile,
  createMemory,
  deleteMemory,
  updateMemory,
  type CharacterProfile,
  type Memory,
} from "../api/profile";
import { CharacterProfileWorkspace } from "./CharacterProfileWorkspace";

vi.mock("../api/profile", async () => {
  const actual = await vi.importActual<typeof import("../api/profile")>("../api/profile");
  return {
    ...actual,
    fetchProfile: vi.fn(),
    saveProfile: vi.fn(),
    previewSystemPrompt: vi.fn(),
    fetchMemories: vi.fn(),
    createMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
  };
});

function buildProfile(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    characterId: "char-1",
    updatedAt: "2026-04-08T00:00:00Z",
    profileVersion: 1,
    personaSummary: "旧角色设定",
    personalityTraits: ["理性"],
    speakingStyle: "平静语气",
    backstory: "旧背景",
    valuesBeliefs: null,
    quirks: null,
    likes: null,
    dislikes: null,
    worldName: null,
    worldSetting: null,
    worldRules: null,
    worldKeyEvents: null,
    userAddress: "你",
    selfAddress: "我",
    catchphrases: null,
    forbiddenWords: null,
    emotionDefault: null,
    triggerRules: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(fetchMemories).mockResolvedValue([]);
  vi.mocked(saveProfile).mockResolvedValue(buildProfile());
  vi.mocked(createMemory).mockRejectedValue(new Error("not used"));
  vi.mocked(updateMemory).mockRejectedValue(new Error("not used"));
  vi.mocked(deleteMemory).mockRejectedValue(new Error("not used"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("角色切换后，新角色无 profile 时表单会清空", async () => {
  vi.mocked(fetchProfile)
    .mockResolvedValueOnce(buildProfile({ characterId: "char-1", personaSummary: "角色A旧内容" }))
    .mockResolvedValueOnce(null);

  const { rerender } = render(<CharacterProfileWorkspace characterId="char-1" />);

  const summary = await screen.findByPlaceholderText(
    "例：温柔却有些腹黑的魔法少女，总是用反问句说话。",
  ) as HTMLTextAreaElement;
  expect(summary.value).toBe("角色A旧内容");

  rerender(<CharacterProfileWorkspace characterId="char-2" />);

  await waitFor(() => {
    expect((screen.getByPlaceholderText(
      "例：温柔却有些腹黑的魔法少女，总是用反问句说话。",
    ) as HTMLTextAreaElement).value).toBe("");
  });
  expect(screen.queryByDisplayValue("角色A旧内容")).not.toBeInTheDocument();
});

test("未保存编辑后点击预览，会用当前草稿调用预览接口", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchProfile).mockResolvedValueOnce(
    buildProfile({ characterId: "char-1", personaSummary: "数据库旧值" }),
  );
  vi.mocked(previewSystemPrompt).mockResolvedValueOnce({
    prompt: "这里是当前草稿预览",
    estimatedTokens: 256,
    hasProfile: true,
    memoryCount: 0,
  });

  render(<CharacterProfileWorkspace characterId="char-1" />);

  const summary = await screen.findByPlaceholderText(
    "例：温柔却有些腹黑的魔法少女，总是用反问句说话。",
  );
  await user.clear(summary);
  await user.type(summary, "未保存草稿内容");
  await user.click(screen.getByRole("button", { name: "预览 System Prompt" }));

  await waitFor(() => {
    expect(previewSystemPrompt).toHaveBeenCalledWith(
      "char-1",
      expect.objectContaining({
        personaSummary: "未保存草稿内容",
      }),
    );
  });
  expect(await screen.findByText("这里是当前草稿预览")).toBeInTheDocument();
});

test("空 profile 状态展示正常，不会残留上一个角色的人设字段", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchProfile)
    .mockResolvedValueOnce(
      buildProfile({
        characterId: "char-1",
        personaSummary: "角色A人设",
        speakingStyle: "角色A说话风格",
        userAddress: "主人",
      }),
    )
    .mockResolvedValueOnce(null);

  const { rerender } = render(<CharacterProfileWorkspace characterId="char-1" />);

  await screen.findByDisplayValue("角色A人设");
  rerender(<CharacterProfileWorkspace characterId="char-2" />);

  await waitFor(() => {
    expect(screen.queryByDisplayValue("角色A人设")).not.toBeInTheDocument();
  });
  expect(
    screen.queryByDisplayValue("角色A说话风格"),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "交互设定" }));
  expect(
    (screen.getByPlaceholderText("我 / 本小姐 / 吾…") as HTMLInputElement).value,
  ).toBe("我");
  expect(
    (screen.getByPlaceholderText("你 / 主人 / 笨蛋…") as HTMLInputElement).value,
  ).toBe("你");
});

test("预览失败或角色切换后，不会残留旧 preview 内容", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchProfile)
    .mockResolvedValueOnce(buildProfile({ characterId: "char-1" }))
    .mockResolvedValueOnce(null);
  vi.mocked(previewSystemPrompt)
    .mockResolvedValueOnce({
      prompt: "旧预览内容",
      estimatedTokens: 120,
      hasProfile: true,
      memoryCount: 0,
    })
    .mockRejectedValueOnce(new Error("preview failed"));

  const { rerender } = render(<CharacterProfileWorkspace characterId="char-1" />);

  await screen.findByDisplayValue("旧角色设定");
  await user.click(screen.getByRole("button", { name: "预览 System Prompt" }));
  expect(await screen.findByText("旧预览内容")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "预览 System Prompt" }));
  expect(await screen.findByText("预览生成失败，请稍后重试。")).toBeInTheDocument();
  expect(screen.queryByText("旧预览内容")).not.toBeInTheDocument();

  rerender(<CharacterProfileWorkspace characterId="char-2" />);
  await waitFor(() => {
    expect(screen.queryByText("System Prompt 预览")).not.toBeInTheDocument();
  });
  expect(screen.queryByText("旧预览内容")).not.toBeInTheDocument();
});

function buildMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    characterId: "char-1",
    kind: "fact",
    content: "用户喜欢草莓蛋糕",
    importance: 4,
    pinned: false,
    source: "manual",
    createdAt: "2026-04-10T10:00:00Z",
    updatedAt: "2026-04-10T10:00:00Z",
    lastUsedAt: null,
    hitCount: 0,
    ...overrides,
  };
}

test("自动提炼的记忆显示「自动」badge，手动记忆不显示", async () => {
  const user = userEvent.setup();
  vi.mocked(fetchProfile).mockResolvedValue(buildProfile());
  vi.mocked(fetchMemories).mockResolvedValue([
    buildMemory({ id: "mem-auto", source: "auto_extracted", content: "自动提炼内容" }),
    buildMemory({ id: "mem-manual", source: "manual", content: "手动填写内容" }),
  ]);

  render(<CharacterProfileWorkspace characterId="char-1" />);
  await user.click(await screen.findByRole("button", { name: "记忆" }));

  await screen.findByText("自动提炼内容");

  const autoBadges = screen.getAllByText("自动");
  expect(autoBadges).toHaveLength(1);
  expect(screen.queryByText("手动填写内容")).toBeInTheDocument();
});
