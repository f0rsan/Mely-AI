import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import App from "./App";

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
        issues: ["分辨率偏低（短边低于 768）"],
      },
    ],
    recommendedTrainingMode: {
      mode: "standard",
      reason: "当前数据质量可进入标准模式，训练稳定性和效果较均衡。",
      suggestedSteps: 1800,
      suggestedRank: 16,
      minRecommendedImages: 15,
      strategyDefaultModel: "flux-schnell",
      runtimeModelHintOn8GB: "sdxl",
    },
    recommendations: [
      "当前图片数量偏少，建议补充到 10 张以上再训练。",
      "角度覆盖不完整，建议补充：背面、特写。",
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
        issues: ["分辨率偏低（短边低于 768）"],
      },
    ],
    updatedAt: "2026-03-27T00:00:00Z",
  };
}

function buildCharacterDetail() {
  return {
    id: "char-1",
    name: "星野ミカ",
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
      style: {
        label: "风格",
        recommended: "二次元",
        recommendedPrompt: "anime style",
        options: [
          { value: "二次元", prompt: "anime style" },
          { value: "写实", prompt: "realistic style" },
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

test("shows an empty state with create entry when no characters exist", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => buildCharactersResponse([]),
  });

  render(<App />);

  expect(screen.getByText("正在加载角色库...")).toBeInTheDocument();
  await screen.findByText("还没有角色");
  expect(screen.getByRole("button", { name: "创建你的第一个角色" })).toBeInTheDocument();
  expect(screen.getByText("任务队列验证")).toBeInTheDocument();
});

test("renders character cards in a grid when the API returns data", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () =>
      buildCharactersResponse([
        {
          id: "char-1",
          name: "星野ミカ",
          createdAt: "2026-03-26T09:00:00Z",
          fingerprint: "fp-001",
        },
        {
          id: "char-2",
          name: "黑渊",
          createdAt: "2026-03-25T09:00:00Z",
          fingerprint: null,
        },
      ]),
  });

  render(<App />);

  await screen.findByRole("button", { name: "打开角色 星野ミカ" });
  expect(screen.getByRole("button", { name: "打开角色 黑渊" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建新角色入口" })).toBeInTheDocument();
});

test("opens dataset workspace when clicking a character card and allows returning", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("数据集导入与评估");
  expect(screen.getByText("还没有导入训练图片，先选择图片后点击“开始评估”。")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "返回角色库" }));
  await screen.findByRole("button", { name: "打开角色 星野ミカ" });
});

test("imports dataset files and renders quality report", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildDatasetReport(),
    });

  render(<App />);
  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("数据集导入与评估");

  const fileA = new File([Uint8Array.from([1, 2, 3, 4])], "front.png", { type: "image/png" });
  const fileB = new File([Uint8Array.from([5, 6, 7, 8])], "side_low_res.png", { type: "image/png" });

  await user.upload(screen.getByLabelText("选择训练图片"), [fileA, fileB]);
  expect(screen.getByText("front.png")).toBeInTheDocument();
  expect(screen.getByText("side_low_res.png")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "开始评估" }));

  await screen.findByText("数据集质量评分");
  expect(screen.getByText("66 分")).toBeInTheDocument();
  expect(screen.getByText("当前数据质量可进入标准模式，训练稳定性和效果较均衡。")).toBeInTheDocument();
  expect(screen.getByText("分辨率偏低（短边低于 768）")).toBeInTheDocument();
  expect(screen.getByText("数据集评估完成，结果已可供下游模块复用。")).toBeInTheDocument();

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
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ detail: "图片导入失败，请检查图片格式后重试" }),
    });

  render(<App />);
  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("数据集导入与评估");

  const file = new File([Uint8Array.from([1, 2, 3])], "bad.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("选择训练图片"), file);
  await user.click(screen.getByRole("button", { name: "开始评估" }));

  await screen.findByText("图片导入失败，请检查图片格式后重试");
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

  await screen.findByText("角色列表加载失败，请重试");
  await user.click(screen.getByRole("button", { name: "重试加载" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  await screen.findByText("还没有角色");
});

test("shows streamed progress updates after starting a mock task", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: {
          id: "task-1",
          name: "mock-success",
          status: "pending",
          progress: 0,
          message: "任务已进入队列",
          error: null,
          createdAt: "2026-03-27T00:00:00+00:00",
          updatedAt: "2026-03-27T00:00:00+00:00",
        },
      }),
    });

  render(<App />);

  await screen.findByText("任务队列验证");

  const stream = MockWebSocket.instances[0];
  stream.emitOpen();

  await user.click(screen.getByRole("button", { name: "启动成功模拟任务" }));
  await screen.findByText("mock-success");
  expect(screen.getByText("排队中")).toBeInTheDocument();

  stream.emitMessage({
    event: "task_updated",
    task: {
      id: "task-1",
      name: "mock-success",
      status: "running",
      progress: 56,
      message: "下载中 56%",
      error: null,
      createdAt: "2026-03-27T00:00:00+00:00",
      updatedAt: "2026-03-27T00:00:10+00:00",
    },
  });

  await screen.findByText("运行中");
  expect(screen.getByText("56%")).toBeInTheDocument();
  expect(screen.getByText("下载中 56%")).toBeInTheDocument();
});

test("supports DNA editing with suggestion prefill, auto prompt preview and save", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildDnaSuggestions(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...buildCharacterDetail(),
        dna: {
          hairColor: "银色",
          eyeColor: "红色",
          skinTone: "白皙",
          bodyType: "纤细",
          style: "写实",
          extraTags: [],
          autoPrompt: "silver hair, red eyes, fair skin, slim body, realistic style",
        },
      }),
    });

  render(<App />);
  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("数据集导入与评估");

  await user.click(screen.getByRole("button", { name: "角色 DNA" }));
  await screen.findByText("角色 DNA 配置");
  await screen.findByText("WD14 模型未就绪，已使用手动建议值。");
  expect(screen.getByDisplayValue("black hair, brown eyes, fair skin, slim body, anime style")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("发色"), "银色");
  await user.selectOptions(screen.getByLabelText("瞳色"), "红色");
  await user.selectOptions(screen.getByLabelText("风格"), "写实");
  await user.click(screen.getByRole("button", { name: "保存 DNA 配置" }));

  await screen.findByText("DNA 已保存，可用于训练与后续生成。");
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

test("allows entering training progress from character detail", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("数据集导入与评估");

  await user.click(screen.getByRole("button", { name: "训练进度与验证" }));

  await screen.findByText("当前角色：星野ミカ");
  expect(screen.getByText("Mock 联调")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "一键重训" })).toBeInTheDocument();
});

test("shows mock timeline, validation images and retrain guidance in training flow", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("数据集导入与评估");
  await user.click(screen.getByRole("button", { name: "训练进度与验证" }));

  await screen.findByText("当前角色：星野ミカ");
  for (let index = 0; index < 7; index += 1) {
    await user.click(screen.getByRole("button", { name: "下一帧" }));
  }

  await screen.findByText("训练与验证图生成完成。");
  expect(screen.getByLabelText("采样图 20%")).toBeInTheDocument();
  expect(screen.getByLabelText("采样图 40%")).toBeInTheDocument();
  expect(screen.getByLabelText("采样图 60%")).toBeInTheDocument();
  expect(screen.getByLabelText("采样图 80%")).toBeInTheDocument();
  expect(screen.getByLabelText("采样图 100%")).toBeInTheDocument();

  expect(screen.getByLabelText("正面")).toBeInTheDocument();
  expect(screen.getByLabelText("3/4 侧面")).toBeInTheDocument();
  expect(screen.getByLabelText("背面")).toBeInTheDocument();
  expect(screen.getByLabelText("特写")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "正面 满意" }));
  await user.click(screen.getByRole("button", { name: "背面 不满意" }));
  expect(screen.getByText("满意 1 张，不满意 1 张")).toBeInTheDocument();
  expect(screen.getByText("建议增加训练步数后重训，并补充缺失角度参考图。")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "一键重训" }));
  expect(screen.getByText("Mock 模式仅用于联调演示，未发起真实重训任务。")).toBeInTheDocument();
});

test("runs the mock-only main path from dataset to DNA to training and back to dataset补图", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildDatasetReport(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildCharacterDetail(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => buildDnaSuggestions(),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...buildCharacterDetail(),
        dna: {
          hairColor: "银色",
          eyeColor: "红色",
          skinTone: "白皙",
          bodyType: "纤细",
          style: "写实",
          extraTags: [],
          autoPrompt: "silver hair, red eyes, fair skin, slim body, realistic style",
        },
      }),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("数据集导入与评估");

  const fileA = new File([Uint8Array.from([1, 2, 3, 4])], "front.png", { type: "image/png" });
  const fileB = new File([Uint8Array.from([5, 6, 7, 8])], "side_low_res.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("选择训练图片"), [fileA, fileB]);
  await user.click(screen.getByRole("button", { name: "开始评估" }));

  await screen.findByText("数据集评估完成，结果已可供下游模块复用。");
  expect(screen.getByText("数据集质量评分")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "角色 DNA" }));
  await screen.findByText("角色 DNA 配置");
  await screen.findByText("WD14 模型未就绪，已使用手动建议值。");
  await user.selectOptions(screen.getByLabelText("发色"), "银色");
  await user.selectOptions(screen.getByLabelText("瞳色"), "红色");
  await user.selectOptions(screen.getByLabelText("风格"), "写实");
  await user.click(screen.getByRole("button", { name: "保存 DNA 配置" }));

  await screen.findByText("DNA 已保存，可用于训练与后续生成。");

  await user.click(screen.getByRole("button", { name: "训练进度与验证" }));
  await screen.findByText("当前角色：星野ミカ");

  for (let index = 0; index < 7; index += 1) {
    await user.click(screen.getByRole("button", { name: "下一帧" }));
  }

  await screen.findByText("训练与验证图生成完成。");
  await user.click(screen.getByRole("button", { name: "背面 不满意" }));
  await screen.findByText("满意 0 张，不满意 1 张");
  await screen.findByText("建议增加训练步数后重训，并补充缺失角度参考图。");

  await user.click(screen.getByRole("button", { name: "一键重训" }));
  await screen.findByText("Mock 模式仅用于联调演示，未发起真实重训任务。");

  await user.click(screen.getByRole("button", { name: "去补充参考图" }));
  await screen.findByText("数据集导入与评估");
  expect(screen.getByRole("button", { name: "开始评估" })).toBeInTheDocument();
  expect(screen.getByText("66 分")).toBeInTheDocument();
});

test("supports text-to-character mock flow and hands selected candidates back to dataset import", async () => {
  const user = userEvent.setup();

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildCharactersResponse([
          {
            id: "char-1",
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await screen.findByText("数据集导入与评估");

  await user.click(screen.getByRole("button", { name: "文字创角（Mock）" }));
  await screen.findByText("文字描述创角（Mock 联调）");
  await screen.findByText("还没有候选图，先输入描述并点击“生成候选图（Mock）”。");
  expect(screen.getByText("本轮为 mock 联调，不代表真实 G1 结果。")).toBeInTheDocument();

  await user.type(screen.getByLabelText("角色文字描述"), "银色长发，红色眼睛，二次元少女");
  await user.click(screen.getByRole("button", { name: "生成候选图（Mock）" }));

  await screen.findByText("正在生成候选图（Mock）...");
  await screen.findByRole("button", { name: "选择候选图 1" });
  const candidateButtons = screen.getAllByRole("button", { name: /选择候选图/ });
  expect(candidateButtons.length).toBeGreaterThanOrEqual(4);
  expect(candidateButtons.length).toBeLessThanOrEqual(8);

  await user.click(screen.getByRole("button", { name: "选择候选图 1" }));
  await user.click(screen.getByRole("button", { name: "加入数据集（1 张）" }));

  await screen.findByText("已将 1 张 Mock 候选图加入数据集，请继续点击“开始评估”进入 M1C 流程。");
  await screen.findByText("数据集导入与评估");
  expect(screen.getByRole("button", { name: "开始评估" })).toBeInTheDocument();
  expect(screen.getByText("图片预览")).toBeInTheDocument();
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
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await user.click(screen.getByRole("button", { name: "文字创角（Mock）" }));

  await user.type(screen.getByLabelText("角色文字描述"), "空结果测试");
  await user.click(screen.getByRole("button", { name: "生成候选图（Mock）" }));

  await screen.findByText("本次未生成候选图，请补充更具体的外貌描述后重试。");
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
            name: "星野ミカ",
            createdAt: "2026-03-26T09:00:00Z",
            fingerprint: "fp-001",
          },
        ]),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "训练数据集尚未导入，请先上传图片。" }),
    });

  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开角色 星野ミカ" }));
  await user.click(screen.getByRole("button", { name: "文字创角（Mock）" }));

  await user.type(screen.getByLabelText("角色文字描述"), "失败测试");
  await user.click(screen.getByRole("button", { name: "生成候选图（Mock）" }));

  await screen.findByText("候选图生成失败，这是 Mock 通道错误，请稍后重试。");
});
