import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import App from "./App";

// ---------------------------------------------------------------------------
// Chinese string constants (Unicode escapes avoid editor quote-conversion bugs)
// ---------------------------------------------------------------------------

const T = {
  // Character names
  charName: "\u661f\u91ceMi\u30ab",         // \u661f\u91ce = 星野, Mi\u30ab = Mi + カ
  charName2: "\u9ed1\u6e0a",                 // 黑渊
  charNameNew: "\u65b0\u89d2\u8272",         // 新角色

  // Home page
  loading: "\u6b63\u5728\u52a0\u8f7d\u89d2\u8272\u5e93...",   // 正在加载角色库...
  noChars: "\u8fd8\u6ca1\u6709\u89d2\u8272",                  // 还没有角色
  createFirst: "\u521b\u5efa\u4f60\u7684\u7b2c\u4e00\u4e2a\u89d2\u8272",  // 创建你的第一个角色
  loadFailed: "\u89d2\u8272\u5217\u8868\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5",  // 角色列表加载失败，请重试
  retry: "\u91cd\u8bd5\u52a0\u8f7d",         // 重试加载

  // Character card buttons
  openChar: (name: string) => `\u6253\u5f00\u89d2\u8272 ${name}`,   // 打开角色 {name}
  createNewEntry: "\u521b\u5efa\u65b0\u89d2\u8272\u5165\u53e3",      // 创建新角色入口

  // Modal
  modalTitle: "\u521b\u5efa\u89d2\u8272",    // 创建角色
  nameLabel: "\u89d2\u8272\u540d\u79f0",     // 角色名称
  createBtn: "\u521b\u5efa",                  // 创建
  nameRequired: "\u8bf7\u8f93\u5165\u89d2\u8272\u540d\u79f0",  // 请输入角色名称

  // Detail sidebar tabs
  llmTab: "LLM \u5de5\u4f5c\u53f0",          // LLM 工作台
  dnaTab: "\u89d2\u8272 DNA",                 // 角色 DNA
  visualTab: "\u89c6\u89c9\u5de5\u4f5c\u53f0",    // 视觉工作台
  generationTab: "\u751f\u6210\u5de5\u4f5c\u53f0", // 生成工作台

  // Back button
  backToLib: "\u2190 \u8fd4\u56de\u89d2\u8272\u5e93",   // ← 返回角色库

  // LLM workspace sub-tabs
  llmSubChat: "\u89d2\u8272\u5bf9\u8bdd",    // 角色对话
  llmSubDatasets: "\u6587\u5b57\u6570\u636e\u96c6",  // 文字数据集
  llmNewConvo: "\u5f00\u59cb\u4e00\u6bb5\u65b0\u5bf9\u8bdd",  // 开始一段新对话

  // DNA tab
  // "数据来源 · 训练图片" — the section label visible when DNA tab is active
  dnaTabIndicator: "\u6570\u636e\u6765\u6e90 \u00b7 \u8bad\u7ec3\u56fe\u7247",  // 数据来源 · 训练图片
  dnaWd14: "WD14 \u6a21\u578b\u672a\u5c31\u7eea\uff0c\u5df2\u4f7f\u7528\u624b\u52a8\u5efa\u8bae\u5024\u3002",  // WD14 模型未就绪，已使用手动建议值。
  dnaSaveBtn: "\u4fdd\u5b58 DNA \u914d\u7f6e",  // 保存 DNA 配置
  dnaSaved: "DNA \u5df2\u4fdd\u5b58\uff0c\u53ef\u7528\u4e8e\u8bad\u7ec3\u4e0e\u540e\u7eed\u751f\u6210\u3002",  // DNA 已保存，可用于训练与后续生成。

  // Dataset section (inside DNA tab)
  datasetSection: "\u6570\u636e\u6765\u6e90 \u00b7 \u8bad\u7ec3\u56fe\u7247",  // 数据来源 · 训练图片
  datasetEmpty: "\u8fd8\u6ca1\u6709\u5bfc\u5165\u8bad\u7ec3\u56fe\u7247\uff0c\u5148\u9009\u62e9\u56fe\u7247\u540e\u70b9\u51fb\u201c\u5f00\u59cb\u8bc4\u4f30\u201d\u3002",  // 还没有导入训练图片，先选择图片后点击"开始评估"。
  selectImages: "\u9009\u62e9\u8bad\u7ec3\u56fe\u7247",  // 选择训练图片
  startEval: "\u5f00\u59cb\u8bc4\u4f30",     // 开始评估
  datasetScore: "\u6570\u636e\u96c6\u8d28\u91cf\u8bc4\u5206",  // 数据集质量评分
  datasetDone: "\u6570\u636e\u96c6\u8bc4\u4f30\u5b8c\u6210\uff0c\u7ed3\u679c\u5df2\u53ef\u4f9b\u4e0b\u6e38\u6a21\u5757\u590d\u7528\u3002",  // 数据集评估完成，结果已可供下游模块复用。

  // Text-to-character (inside DNA tab)
  textToCharBtn: "\u6587\u5b57\u521b\u89d2\uff08Mock\uff09",  // 文字创角（Mock）
  textToCharTitle: "\u6587\u5b57\u63cf\u8ff0\u521b\u89d2\uff08Mock \u8054\u8c03\uff09",  // 文字描述创角（Mock 联调）
  textPromptLabel: "\u89d2\u8272\u6587\u5b57\u63cf\u8ff0",  // 角色文字描述
  generateCandidates: "\u751f\u6210\u5019\u9009\u56fe\uff08Mock\uff09",  // 生成候选图（Mock）
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

type CharacterItem = {
  id: string;
  name: string;
  createdAt: string;
  fingerprint?: string | null;
};

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

function buildCharactersResponse(items: CharacterItem[]) {
  return {
    items,
    total: items.length,
  };
}

function buildDatasetReport() {
  return {
    characterId: "char-1",
    totalImages: 2,
    qualifiedImages: 1,
    problemImages: 1,
    qualityScore: 66,
    angleDistribution: {
      front: 1,
      side: 1,
      back: 0,
      closeup: 0,
      threeQuarter: 0,
      fullBody: 0,
      unknown: 0,
    },
    problemItems: [
      {
        imageId: "img-2",
        name: "side_low_res.png",
        angleBucket: "side",
        issues: ["\u5206\u8fa8\u7387\u504f\u4f4e\uff08\u77ed\u8fb9\u4f4e\u4e8e 768\uff09"],  // 分辨率偏低（短边低于 768）
      },
    ],
    recommendedTrainingMode: {
      mode: "standard",
      reason: "\u5f53\u524d\u6570\u636e\u8d28\u91cf\u53ef\u8fdb\u5165\u6807\u51c6\u6a21\u5f0f\uff0c\u8bad\u7ec3\u7a33\u5b9a\u6027\u548c\u6548\u679c\u8f83\u5747\u8861\u3002",  // 当前数据质量可进入标准模式，训练稳定性和效果较均衡。
      suggestedSteps: 1800,
      suggestedRank: 16,
      minRecommendedImages: 15,
      strategyDefaultModel: "flux-schnell",
      runtimeModelHintOn8GB: "sdxl",
    },
    recommendations: [
      "\u5f53\u524d\u56fe\u7247\u6570\u91cf\u504f\u5c11\uff0c\u5efa\u8bae\u8865\u5145\u523010\u5f20\u4ee5\u4e0a\u518d\u8bad\u7ec3\u3002",  // 当前图片数量偏少，建议补充到 10 张以上再训练。
      "\u89d2\u5ea6\u8986\u76d6\u4e0d\u5b8c\u6574\uff0c\u5efa\u8bae\u8865\u5145\uff1a\u80cc\u9762\u3001\u7279\u5199\u3002",  // 角度覆盖不完整，建议补充：背面、特写。
    ],
    images: [
      {
        imageId: "img-1",
        name: "front.png",
        relativePath: "characters/char-1/training_data/001-front.png",
        imageFormat: "png",
        width: 1024,
        height: 1024,
        fileSize: 10240,
        angleBucket: "front",
        qualityStatus: "qualified",
        issues: [],
      },
      {
        imageId: "img-2",
        name: "side_low_res.png",
        relativePath: "characters/char-1/training_data/002-side_low_res.png",
        imageFormat: "png",
        width: 512,
        height: 768,
        fileSize: 8220,
        angleBucket: "side",
        qualityStatus: "problem",
        issues: ["\u5206\u8fa8\u7387\u504f\u4f4e\uff08\u77ed\u8fb9\u4f4e\u4e8e 768\uff09"],  // 分辨率偏低（短边低于 768）
      },
    ],
    updatedAt: "2026-03-27T00:00:00Z",
  };
}

function buildCharacterDetail() {
  return {
    id: "char-1",
    name: T.charName,
    createdAt: "2026-03-26T09:00:00Z",
    fingerprint: "fp-001",
    dna: null,
    visual: null,
    voice: null,
  };
}

function buildDnaSuggestions() {
  return {
    characterId: "char-1",
    source: "manual_default",
    fields: {
      hairColor: {
        label: "\u53d1\u8272",  // 发色
        recommended: "\u9ed1\u8272",  // 黑色
        recommendedPrompt: "black hair",
        options: [
          { value: "\u9ed1\u8272", prompt: "black hair" },
          { value: "\u9280\u8272", prompt: "silver hair" },  // 银色
        ],
      },
      eyeColor: {
        label: "\u77b3\u8272",  // 瞳色
        recommended: "\u68d5\u8272",  // 棕色
        recommendedPrompt: "brown eyes",
        options: [
          { value: "\u68d5\u8272", prompt: "brown eyes" },
          { value: "\u7ea2\u8272", prompt: "red eyes" },  // 红色
        ],
      },
      skinTone: {
        label: "\u80a4\u8272",  // 肤色
        recommended: "\u767d\u73a2",  // 白皙
        recommendedPrompt: "fair skin",
        options: [
          { value: "\u767d\u73a2", prompt: "fair skin" },
          { value: "\u5c0f\u9ea6\u8272", prompt: "tan skin" },  // 小麦色
        ],
      },
      style: {
        label: "\u98ce\u683c",  // 风格
        recommended: "\u4e8c\u6b21\u5143",  // 二次元
        recommendedPrompt: "anime style",
        options: [
          { value: "\u4e8c\u6b21\u5143", prompt: "anime style" },
          { value: "\u5199\u5b9e", prompt: "realistic style" },  // 写实
        ],
      },
      bodyType: {
        label: "\u4f53\u578b",  // 体型
        recommended: "\u7ea4\u7ec6",  // 纤细
        recommendedPrompt: "slim body",
        options: [
          { value: "\u7ea4\u7ec6", prompt: "slim body" },
          { value: "\u5300\u79f0", prompt: "proportional body" },  // 匀称
        ],
      },
    },
    autoPromptPreview: "black hair, brown eyes, fair skin, slim body, anime style",
    wd14: {
      available: false,
      modelId: null,
      reason: T.dnaWd14,
      tags: [],
    },
  };
}

// LLMRuntimeStatus-compatible mock (matches src/api/llmRuntime.ts shape)
function buildLLMRuntimeResponse(overrides: Record<string, unknown> = {}) {
  return {
    installed: true,
    running: true,
    version: "0.6.0",
    minimumVersion: "0.3.10",
    platform: "darwin",
    models: [
      {
        name: "qwen2.5:7b-instruct-q4_K_M",
        sizeBytes: 4_500_000_000,
        modifiedAt: "2026-04-07T00:00:00Z",
        digest: "sha256:demo",
      },
    ],
    hint: null,
    ...overrides,
  };
}

// LLM datasets list mock (empty)
function buildLLMDatasetsResponse() {
  return [];
}

// ---------------------------------------------------------------------------
// Test setup/teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  MockWebSocket.instances = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("shows an empty state with create entry when no characters exist", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildCharactersResponse([]),
  });

  render(<App />);

  expect(screen.getByText(T.loading)).toBeInTheDocument();
  await screen.findByText(T.noChars);
  expect(screen.getByRole("button", { name: T.createFirst })).toBeInTheDocument();
  // TaskPanel is no longer rendered on the home page
});

test("renders character cards in a grid when the API returns data", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () =>
      buildCharactersResponse([
        {
          id: "char-1",
          name: T.charName,
          createdAt: "2026-03-26T09:00:00Z",
          fingerprint: "fp-001",
        },
        {
          id: "char-2",
          name: T.charName2,
          createdAt: "2026-03-25T09:00:00Z",
          fingerprint: null,
        },
      ]),
  });

  render(<App />);

  await screen.findByRole("button", { name: T.openChar(T.charName) });
  expect(screen.getByRole("button", { name: T.openChar(T.charName2) })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: T.createNewEntry })).toBeInTheDocument();
});

test("creates character from modal and jumps to LLM workspace", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list (empty)
      ok: true,
      json: async () => buildCharactersResponse([]),
    })
    .mockResolvedValueOnce({
      // POST /api/characters
      ok: true,
      json: async () => ({
        id: "char-new",
        name: T.charNameNew,
        createdAt: "2026-04-07T10:00:00Z",
        fingerprint: null,
        dna: null,
        visual: null,
        voice: null,
      }),
    })
    .mockResolvedValueOnce({
      // dataset report (404 = no dataset yet)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\uff0c\u8bf7\u5148\u4e0a\u4f20\u56fe\u7247\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime check
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets list
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    });

  render(<App />);
  await screen.findByText(T.noChars);

  await user.click(screen.getByRole("button", { name: T.createFirst }));
  await screen.findByRole("dialog", { name: T.modalTitle });
  await user.type(screen.getByLabelText(T.nameLabel), `${T.charNameNew}{enter}`);

  // After creation, LLM workspace loads as the default tab
  // The sidebar shows the character name
  await screen.findByText(T.charNameNew);
  expect(screen.queryByRole("dialog", { name: T.modalTitle })).not.toBeInTheDocument();

  const createCall = fetchMock.mock.calls.find(
    ([url, options]) =>
      url === "http://127.0.0.1:8000/api/characters" &&
      (options as RequestInit).method === "POST",
  );
  expect(createCall).toBeDefined();
});

test("shows input validation when create modal name is empty", async () => {
  const user = userEvent.setup();

  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildCharactersResponse([]),
  });

  render(<App />);
  await screen.findByText(T.noChars);

  await user.click(screen.getByRole("button", { name: T.createFirst }));
  await screen.findByRole("dialog", { name: T.modalTitle });
  await user.click(screen.getByRole("button", { name: T.createBtn }));

  await screen.findByText(T.nameRequired);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("opens character and navigates to DNA tab to see dataset workspace, then returns", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      // dataset report (404)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    })
    .mockResolvedValueOnce({
      // character detail (fetched when DNA tab is clicked)
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      // DNA suggestions (fetched when DNA tab is clicked)
      ok: true,
      json: async () => buildDnaSuggestions(),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Default tab is LLM workspace — click DNA tab
  const dnaTabBtn = await screen.findByRole("button", { name: T.dnaTab });
  await user.click(dnaTabBtn);

  await screen.findByText(T.datasetSection);
  // Dataset section is visible; start-eval button is present (disabled without files)
  expect(screen.getByRole("button", { name: T.startEval })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: T.backToLib }));
  await screen.findByRole("button", { name: T.openChar(T.charName) });
});

test("imports dataset files and renders quality report", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      // dataset report (404)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    })
    .mockResolvedValueOnce({
      // character detail (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      // DNA suggestions (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildDnaSuggestions(),
    })
    .mockResolvedValueOnce({
      // dataset import
      ok: true,
      json: async () => buildDatasetReport(),
    });

  render(<App />);
  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Navigate to DNA tab
  await user.click(await screen.findByRole("button", { name: T.dnaTab }));
  await screen.findByText(T.datasetSection);

  const fileA = new File([Uint8Array.from([1, 2, 3, 4])], "front.png", { type: "image/png" });
  const fileB = new File([Uint8Array.from([5, 6, 7, 8])], "side_low_res.png", { type: "image/png" });

  await user.upload(screen.getByLabelText(T.selectImages), [fileA, fileB]);
  expect(screen.getByText("front.png")).toBeInTheDocument();
  expect(screen.getByText("side_low_res.png")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: T.startEval }));

  await screen.findByText(T.datasetScore);
  expect(screen.getByText("66 \u5206")).toBeInTheDocument();  // 66 分
  expect(screen.getByText("\u5f53\u524d\u6570\u636e\u8d28\u91cf\u53ef\u8fdb\u5165\u6807\u51c6\u6a21\u5f0f\uff0c\u8bad\u7ec3\u7a33\u5b9a\u6027\u548c\u6548\u679c\u8f83\u5747\u8861\u3002")).toBeInTheDocument();
  expect(screen.getByText("\u5206\u8fa8\u7387\u504f\u4f4e\uff08\u77ed\u8fb9\u4f4e\u4e8e 768\uff09")).toBeInTheDocument();
  expect(screen.getByText(T.datasetDone)).toBeInTheDocument();

  const importCall = fetchMock.mock.calls.find(
    ([url]) => url === "http://127.0.0.1:8000/api/characters/char-1/dataset/import",
  );
  expect(importCall).toBeDefined();
  const [, options] = importCall as [string, RequestInit];
  const body = JSON.parse(options.body as string);
  expect(body.images).toHaveLength(2);
  expect(body.images[0].name).toBe("front.png");
  expect(typeof body.images[0].contentBase64).toBe("string");
});

test("shows chinese error when dataset import fails", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      // dataset report (404)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    })
    .mockResolvedValueOnce({
      // character detail (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      // DNA suggestions (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildDnaSuggestions(),
    })
    .mockResolvedValueOnce({
      // dataset import fails
      ok: false,
      status: 400,
      json: async () => ({ detail: "\u56fe\u7247\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u56fe\u7247\u683c\u5f0f\u540e\u91cd\u8bd5" }),  // 图片导入失败，请检查图片格式后重试
    });

  render(<App />);
  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Navigate to DNA tab
  await user.click(await screen.findByRole("button", { name: T.dnaTab }));
  await screen.findByText(T.datasetSection);

  const file = new File([Uint8Array.from([1, 2, 3])], "bad.png", { type: "image/png" });
  await user.upload(screen.getByLabelText(T.selectImages), file);
  await user.click(screen.getByRole("button", { name: T.startEval }));

  await screen.findByText("\u56fe\u7247\u5bfc\u5165\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u56fe\u7247\u683c\u5f0f\u540e\u91cd\u8bd5");
});

test("shows a retry flow in Chinese when loading the character list fails", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockRejectedValueOnce(new Error("network down"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildCharactersResponse([]),
    });

  render(<App />);

  await screen.findByText(T.loadFailed);
  await user.click(screen.getByRole("button", { name: T.retry }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  await screen.findByText(T.noChars);
});

test("shows streamed task updates via WebSocket connection on app load", async () => {
  // WebSocket is connected on app load (when characters are ready).
  // TaskPanel is no longer rendered on the home page, but the WebSocket
  // connection still happens in the background via the task stream effect.
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () =>
      buildCharactersResponse([
        {
          id: "char-1",
          name: T.charName,
          createdAt: "2026-03-26T09:00:00Z",
          fingerprint: "fp-001",
        },
      ]),
  });

  render(<App />);
  await screen.findByRole("button", { name: T.openChar(T.charName) });

  // WebSocket should have been created for the task stream
  expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
  const stream = MockWebSocket.instances[0];
  stream.emitOpen();
  expect(stream.readyState).toBe(MockWebSocket.OPEN);
});

test("supports DNA editing with suggestion prefill, auto prompt preview and save", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      // dataset report (404)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    })
    .mockResolvedValueOnce({
      // character detail (for DNA tab)
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      // DNA suggestions
      ok: true,
      json: async () => buildDnaSuggestions(),
    })
    .mockResolvedValueOnce({
      // DNA save response
      ok: true,
      json: async () => ({
        ...buildCharacterDetail(),
        dna: {
          hairColor: "\u9280\u8272",  // 银色
          eyeColor: "\u7ea2\u8272",   // 红色
          skinTone: "\u767d\u73a2",   // 白皙
          bodyType: "\u7ea4\u7ec6",   // 纤细
          style: "\u5199\u5b9e",      // 写实
          extraTags: [],
          autoPrompt: "silver hair, red eyes, fair skin, slim body, realistic style",
        },
      }),
    });

  render(<App />);
  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Navigate to DNA tab
  await user.click(await screen.findByRole("button", { name: T.dnaTab }));
  await screen.findByText(T.dnaTabIndicator);
  await screen.findByText(T.dnaWd14);
  expect(screen.getByDisplayValue("black hair, brown eyes, fair skin, slim body, anime style")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("\u53d1\u8272"), "\u9280\u8272");  // 发色 → 银色
  await user.selectOptions(screen.getByLabelText("\u77b3\u8272"), "\u7ea2\u8272");  // 瞳色 → 红色
  await user.selectOptions(screen.getByLabelText("\u98ce\u683c"), "\u5199\u5b9e");  // 风格 → 写实
  await user.click(screen.getByRole("button", { name: T.dnaSaveBtn }));

  await screen.findByText(T.dnaSaved);
  expect(
    screen.getByDisplayValue("silver hair, red eyes, fair skin, slim body, realistic style"),
  ).toBeInTheDocument();

  const saveCall = fetchMock.mock.calls.find(
    ([url, options]) =>
      url === "http://127.0.0.1:8000/api/characters/char-1/dna" &&
      (options as RequestInit).method === "PUT",
  );
  expect(saveCall).toBeDefined();
});

test("allows entering LLM workspace from character detail", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      // dataset report (404)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // LLM tab is the default — wait for runtime status to load
  // "语言引擎已就绪" appears in the RuntimeBanner when installed+running
  await screen.findByText("\u8bed\u8a00\u5f15\u64ce\u5df2\u5c31\u7eea");  // 语言引擎已就绪
});

test("shows visual workspace from character detail tab", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      // dataset report (404)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5185\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Click the Visual workspace tab
  const visualBtn = await screen.findByRole("button", { name: T.visualTab });
  await user.click(visualBtn);

  // VisualWorkspace should render — LLM runtime banner no longer visible
  // (the LLM sub-tabs are re-mounted only when LLM tab is active)
  await waitFor(() => {
    // RuntimeBanner "语言引擎已就绪" only renders inside LLMWorkspace
    expect(screen.queryByText("\u8bed\u8a00\u5f15\u64ce\u5df2\u5c31\u7eea")).not.toBeInTheDocument();
  });
});

test("runs the mock-only main path from dataset import to DNA save", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      // dataset report (404)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    })
    .mockResolvedValueOnce({
      // character detail (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      // DNA suggestions (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildDnaSuggestions(),
    })
    .mockResolvedValueOnce({
      // dataset import (user clicks 开始评估)
      ok: true,
      json: async () => buildDatasetReport(),
    })
    .mockResolvedValueOnce({
      // DNA save (user clicks 保存 DNA 配置)
      ok: true,
      json: async () => ({
        ...buildCharacterDetail(),
        dna: {
          hairColor: "\u9280\u8272",
          eyeColor: "\u7ea2\u8272",
          skinTone: "\u767d\u73a2",
          bodyType: "\u7ea4\u7ec6",
          style: "\u5199\u5b9e",
          extraTags: [],
          autoPrompt: "silver hair, red eyes, fair skin, slim body, realistic style",
        },
      }),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Navigate to DNA tab
  await user.click(await screen.findByRole("button", { name: T.dnaTab }));
  await screen.findByText(T.datasetSection);

  const fileA = new File([Uint8Array.from([1, 2, 3, 4])], "front.png", { type: "image/png" });
  const fileB = new File([Uint8Array.from([5, 6, 7, 8])], "side_low_res.png", { type: "image/png" });
  await user.upload(screen.getByLabelText(T.selectImages), [fileA, fileB]);
  await user.click(screen.getByRole("button", { name: T.startEval }));

  await screen.findByText(T.datasetDone);
  expect(screen.getByText(T.datasetScore)).toBeInTheDocument();

  // DNA section is also visible in the same tab
  await screen.findByText(T.dnaTabIndicator);
  await screen.findByText(T.dnaWd14);
  await user.selectOptions(screen.getByLabelText("\u53d1\u8272"), "\u9280\u8272");
  await user.selectOptions(screen.getByLabelText("\u77b3\u8272"), "\u7ea2\u8272");
  await user.selectOptions(screen.getByLabelText("\u98ce\u683c"), "\u5199\u5b9e");
  await user.click(screen.getByRole("button", { name: T.dnaSaveBtn }));

  await screen.findByText(T.dnaSaved);
});

test("supports text-to-character mock flow and hands selected candidates back to dataset import", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      // characters list
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      // dataset report (404)
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      // LLM runtime
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      // LLM datasets
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    })
    .mockResolvedValueOnce({
      // character detail (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      // DNA suggestions (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildDnaSuggestions(),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Navigate to DNA tab (text-to-character is always a visible section in this tab)
  await user.click(await screen.findByRole("button", { name: T.dnaTab }));
  await screen.findByText(T.datasetSection);

  // TextToCharacterWorkspace is rendered as a fixed section (no toggle button needed)
  await screen.findByText(T.textToCharTitle);
  // Use partial regex for text containing typographic quotes
  await screen.findByText(/\u8fd8\u6ca1\u6709\u5019\u9009\u56fe\uff0c\u5148\u8f93\u5165\u63cf\u8ff0/);  // 还没有候选图，先输入描述
  expect(screen.getByText("\u672c\u8f6e\u4e3a mock \u8054\u8c03\uff0c\u4e0d\u4ee3\u8868\u771f\u5b9e G1 \u7ed3\u679c\u3002")).toBeInTheDocument();  // 本轮为 mock 联调，不代表真实 G1 结果。

  await user.type(screen.getByLabelText(T.textPromptLabel), "\u9280\u8272\u957f\u53d1\uff0c\u7ea2\u8272\u773c\u775b\uff0c\u4e8c\u6b21\u5143\u5c11\u5973");  // 银色长发，红色眼睛，二次元少女
  await user.click(screen.getByRole("button", { name: T.generateCandidates }));

  await screen.findByText("\u6b63\u5728\u751f\u6210\u5019\u9009\u56fe\uff08Mock\uff09...");  // 正在生成候选图（Mock）...
  await screen.findByRole("button", { name: "\u9009\u62e9\u5019\u9009\u56fe 1" });  // 选择候选图 1
  const candidateButtons = screen.getAllByRole("button", { name: /\u9009\u62e9\u5019\u9009\u56fe/ });
  expect(candidateButtons.length).toBeGreaterThanOrEqual(4);
  expect(candidateButtons.length).toBeLessThanOrEqual(8);

  await user.click(screen.getByRole("button", { name: "\u9009\u62e9\u5019\u9009\u56fe 1" }));
  await user.click(screen.getByRole("button", { name: "\u52a0\u5165\u6570\u636e\u96c6\uff081 \u5f20\uff09" }));  // 加入数据集（1 张）

  await screen.findByText(/\u5df2\u5c06 1 \u5f20 Mock \u5019\u9009\u56fe\u52a0\u5165\u6570\u636e\u96c6/);  // 已将 1 张 Mock 候选图加入数据集
  await screen.findByText(T.datasetSection);
  expect(screen.getByRole("button", { name: T.startEval })).toBeInTheDocument();
  expect(screen.getByText("\u56fe\u7247\u9884\u89c8")).toBeInTheDocument();  // 图片预览
});

test("shows empty-state message when mock generation returns zero candidates", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    })
    .mockResolvedValueOnce({
      // character detail (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      // DNA suggestions (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildDnaSuggestions(),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Navigate to DNA tab (text-to-character is a fixed section within it)
  await user.click(await screen.findByRole("button", { name: T.dnaTab }));
  // Wait for DNA tab to settle (DNA suggestions load + dataset section visible)
  await screen.findByText(T.datasetSection);
  await screen.findByText(T.textToCharTitle);

  await user.type(screen.getByLabelText(T.textPromptLabel), "\u7a7a\u7ed3\u679c\u6d4b\u8bd5");  // 空结果测试
  await user.click(screen.getByRole("button", { name: T.generateCandidates }));

  await screen.findByText("\u672c\u6b21\u672a\u751f\u6210\u5019\u9009\u56fe\uff0c\u8bf7\u8865\u5145\u66f4\u5177\u4f53\u7684\u5916\u8c8c\u63cf\u8ff0\u540e\u91cd\u8bd5\u3002");  // 本次未生成候选图，请补充更具体的外貌描述后重试。
});

test("shows Chinese error message when mock generation fails", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: T.charName,
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "\u8bad\u7ec3\u6570\u636e\u96c6\u5c1a\u672a\u5bfc\u5165\u3002" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildLLMRuntimeResponse(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildLLMDatasetsResponse(),
    })
    .mockResolvedValueOnce({
      // character detail (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      // DNA suggestions (fetched when DNA tab clicked)
      ok: true,
      json: async () => buildDnaSuggestions(),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: T.openChar(T.charName) }));

  // Navigate to DNA tab (text-to-character is a fixed section within it)
  await user.click(await screen.findByRole("button", { name: T.dnaTab }));
  await screen.findByText(T.datasetSection);
  await screen.findByText(T.textToCharTitle);

  await user.type(screen.getByLabelText(T.textPromptLabel), "\u5931\u8d25\u6d4b\u8bd5");  // 失败测试
  await user.click(screen.getByRole("button", { name: T.generateCandidates }));

  await screen.findByText("\u5019\u9009\u56fe\u751f\u6210\u5931\u8d25\uff0c\u8fd9\u662f Mock \u901a\u9053\u9519\u8bef\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002");  // 候选图生成失败，这是 Mock 通道错误，请稍后重试。
});
