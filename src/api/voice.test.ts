import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  extractVoiceprint,
  fetchTTSEngineStatus,
  fetchVoiceStatus,
  startTTSEngine,
  stopTTSEngine,
  uploadReferenceAudio,
} from "./voice";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

// ---------------------------------------------------------------------------
// fetchVoiceStatus
// ---------------------------------------------------------------------------

test("fetchVoiceStatus returns VoiceAssetStatus on success", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      characterId: "char-1",
      hasReference: false,
      status: "unbound",
      referenceAudioPath: null,
      durationSeconds: null,
      ttsEngine: null,
      boundAt: null,
    }),
  });

  const result = await fetchVoiceStatus("char-1");
  expect(result.characterId).toBe("char-1");
  expect(result.status).toBe("unbound");
  expect(result.hasReference).toBe(false);
});

test("fetchVoiceStatus throws Chinese error on 404", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ detail: "角色不存在，请刷新后重试。" }),
  });

  await expect(fetchVoiceStatus("bad-id")).rejects.toThrow("角色不存在");
});

test("fetchVoiceStatus throws on network error", async () => {
  fetchMock.mockRejectedValueOnce(new Error("network"));

  await expect(fetchVoiceStatus("char-1")).rejects.toThrow("连接失败");
});

// ---------------------------------------------------------------------------
// fetchTTSEngineStatus
// ---------------------------------------------------------------------------

test("fetchTTSEngineStatus returns TTSEngineStatus", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      state: "stopped",
      restartCount: 0,
      errorMessage: null,
      pid: null,
    }),
  });

  const result = await fetchTTSEngineStatus();
  expect(result.state).toBe("stopped");
});

// ---------------------------------------------------------------------------
// startTTSEngine / stopTTSEngine
// ---------------------------------------------------------------------------

test("startTTSEngine returns action response", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: { state: "starting", restartCount: 0, errorMessage: null, pid: null },
      message: "TTS 引擎启动指令已发送",
    }),
  });

  const result = await startTTSEngine();
  expect(result.message).toBe("TTS 引擎启动指令已发送");
  expect(result.status.state).toBe("starting");
});

test("stopTTSEngine throws Chinese message on error", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ detail: "TTS 引擎操作失败，请稍后重试" }),
  });

  await expect(stopTTSEngine()).rejects.toThrow("TTS 引擎操作失败");
});

// ---------------------------------------------------------------------------
// uploadReferenceAudio
// ---------------------------------------------------------------------------

test("uploadReferenceAudio sends multipart with correct params", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      characterId: "char-1",
      referenceAudioPath: "/tmp/ref.wav",
      durationSeconds: 10,
      audioFormat: "wav",
      status: "extracting",
      message: "参考音频上传成功",
    }),
  });

  const file = new File([new Uint8Array(100)], "voice.wav", { type: "audio/wav" });
  const result = await uploadReferenceAudio("char-1", file, 10);

  expect(result.status).toBe("extracting");
  const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("character_id=char-1");
  expect(url).toContain("durationSeconds=10");
  expect(opts.method).toBe("POST");
  expect(opts.body).toBeInstanceOf(FormData);
});
