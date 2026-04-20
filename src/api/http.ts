export class FetchTimeoutError extends Error {
  constructor() {
    super("请求超时");
    this.name = "FetchTimeoutError";
  }
}

type FetchWithTimeoutOptions = RequestInit & {
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = 8_000, signal, cache = "no-store", ...init } = options;
  const controller = new AbortController();

  const abortFromParent = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  // Race the fetch against a timeout promise so that even if the underlying
  // fetch stub / implementation ignores the AbortSignal, the timeout still wins.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort();
      reject(new FetchTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetch(input, { ...init, cache, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromParent);
  }
}
