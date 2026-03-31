export type TextToCharacterCandidate = {
  id: string;
  name: string;
  prompt: string;
  previewDataUrl: string;
  contractVersion: "m1g-text-to-character-mock-v1";
};

export type TextToCharacterMockResult = {
  prompt: string;
  candidates: TextToCharacterCandidate[];
  mocked: true;
  note: string;
};

const CONTRACT_VERSION = "m1g-text-to-character-mock-v1";

const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

const CANDIDATE_HUES = [325, 290, 260, 220, 180, 140, 30, 350];

function toBase64(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

function decodeBase64(base64: string): ArrayBuffer {
  const decoder = atob(base64);
  const buffer = new ArrayBuffer(decoder.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = decoder.charCodeAt(index);
  }
  return buffer;
}

function sanitizePromptLabel(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 20) {
    return normalized;
  }
  return `${normalized.slice(0, 20)}…`;
}

function buildCandidatePreviewDataUrl(prompt: string, index: number): string {
  const hue = CANDIDATE_HUES[index % CANDIDATE_HUES.length];
  const label = sanitizePromptLabel(prompt);
  const safeLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="hsl(${hue}, 56%, 54%)" />
        <stop offset="100%" stop-color="hsl(${(hue + 40) % 360}, 44%, 34%)" />
      </linearGradient>
    </defs>
    <rect width="768" height="768" fill="url(#bg)" />
    <circle cx="384" cy="300" r="168" fill="rgba(255,255,255,0.16)" />
    <rect x="172" y="496" width="424" height="154" rx="20" fill="rgba(8,10,18,0.42)" />
    <text x="384" y="558" text-anchor="middle" font-size="34" fill="#ffffff" font-family="Noto Sans SC, PingFang SC, sans-serif">Mock 候选图 ${index + 1}</text>
    <text x="384" y="604" text-anchor="middle" font-size="22" fill="rgba(255,255,255,0.9)" font-family="Noto Sans SC, PingFang SC, sans-serif">${safeLabel}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

function resolveCandidateCount(prompt: string): number {
  const normalizedLength = prompt.replace(/\s+/g, "").length;
  return 4 + (normalizedLength % 5);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function generateTextToCharacterCandidatesMock(
  rawPrompt: string,
): Promise<TextToCharacterMockResult> {
  const prompt = rawPrompt.trim();
  if (prompt.length === 0) {
    throw new Error("请输入角色文字描述后再生成。");
  }

  await delay(550);

  if (prompt.includes("失败")) {
    throw new Error("候选图生成失败，这是 Mock 通道错误，请稍后重试。");
  }

  if (prompt.includes("空")) {
    return {
      prompt,
      candidates: [],
      mocked: true,
      note: "Mock 结果为空，请补充更具体描述。",
    };
  }

  const candidateCount = resolveCandidateCount(prompt);
  const candidates: TextToCharacterCandidate[] = Array.from({ length: candidateCount }).map(
    (_, index) => ({
      id: `mock-candidate-${index + 1}`,
      name: `候选图 ${index + 1}`,
      prompt,
      previewDataUrl: buildCandidatePreviewDataUrl(prompt, index),
      contractVersion: CONTRACT_VERSION,
    }),
  );

  return {
    prompt,
    candidates,
    mocked: true,
    note: "本结果由 mock 合同生成，不连接真实 G1 运行时。",
  };
}

export function createDatasetFilesFromMockCandidates(
  candidates: TextToCharacterCandidate[],
): File[] {
  const bytes = decodeBase64(MOCK_PNG_BASE64);
  return candidates.map((candidate, index) => {
    const safePrompt = candidate.prompt
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20);
    const fileName =
      safePrompt.length > 0
        ? `mock-${index + 1}-${safePrompt}.png`
        : `mock-${index + 1}-candidate.png`;
    return new File([bytes.slice(0)], fileName, { type: "image/png" });
  });
}
