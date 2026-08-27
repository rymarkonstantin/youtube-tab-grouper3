import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupRule } from "../../src/types";
import type { ClassifierInput } from "../../src/classifier/providers";
import { OllamaClassifierProvider, type OllamaProviderError } from "../../src/classifier/ollama";
import { MalformedClassificationResponseError } from "../../src/classifier/errors";

const rules: GroupRule[] = [
  {
    id: "programming",
    name: "Programming",
    description: "Software development and engineering.",
    color: "green",
    enabled: true,
  },
  {
    id: "uncategorized",
    name: "Uncategorized",
    description: "Use only when no topic fits.",
    color: "grey",
    enabled: true,
  },
];

const input: ClassifierInput = {
  rules,
  fallbackRuleId: "uncategorized",
  items: [
    {
      itemId: "video-1",
      metadata: {
        videoId: "abc",
        pageType: "watch",
        title: "Разработка веб-приложения на TypeScript",
        description: "日本語の補足説明",
        channelName: "Технологии",
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function validResponse(): Response {
  return jsonResponse({
    message: {
      content: JSON.stringify({
        results: [
          {
            itemId: "video-1",
            ruleId: "programming",
            reason: "The video is about TypeScript web development.",
          },
        ],
      }),
    },
  });
}

describe("OllamaClassifierProvider", () => {
  afterEach(() => vi.useRealTimers());

  it("reports a missing local runtime without throwing from its health check", async () => {
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    await expect(provider.health(new AbortController().signal)).resolves.toEqual({
      available: false,
      reason: "unavailable",
    });
  });

  it("checks the configured model during health reporting", async () => {
    const fetcher = vi.fn((url: RequestInfo | URL) =>
      Promise.resolve(
        String(url).endsWith("/api/show")
          ? jsonResponse({ error: "model not found" }, 404)
          : jsonResponse({ models: [] }),
      ),
    );
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "missing-model",
      fetcher,
    });

    await expect(provider.health(new AbortController().signal)).resolves.toEqual({
      available: false,
      reason: "model-missing",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/show",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "missing-model" }),
      }),
    );
  });

  it.each([
    ["invalid JSON", new Response("not JSON", { status: 200 })],
    ["missing model details", jsonResponse({ model_info: {} })],
  ])(
    "reports %s from a successful model health response as malformed",
    async (_label, response) => {
      const provider = new OllamaClassifierProvider({
        endpoint: "http://127.0.0.1:11434",
        model: "qwen2.5:3b-instruct",
        fetcher: vi.fn().mockResolvedValue(response),
      });

      await expect(provider.health(new AbortController().signal)).resolves.toEqual({
        available: false,
        reason: "malformed-response",
      });
    },
  );

  it("accepts the model details payload returned by Ollama", async () => {
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher: vi.fn().mockResolvedValue(
        jsonResponse({
          details: {
            family: "qwen2",
            parameter_size: "3.1B",
            quantization_level: "Q4_K_M",
          },
          capabilities: ["completion", "tools"],
        }),
      ),
    });

    await expect(provider.health(new AbortController().signal)).resolves.toEqual({
      available: true,
    });
  });

  it("sends a semantic structured-output request to the configured model and endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(validResponse());
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434/",
      model: "qwen2.5:3b-instruct",
      fetcher,
    });

    await expect(provider.classify(input, new AbortController().signal)).resolves.toEqual([
      {
        itemId: "video-1",
        ruleId: "programming",
        reason: "The video is about TypeScript web development.",
      },
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("qwen2.5:3b-instruct");
    expect(body.stream).toBe(false);
    expect(body.format).toMatchObject({ type: "object" });
    expect(body.messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("semantic rules"),
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("日本語の補足説明"),
      }),
    ]);
  });

  it("maps an unavailable Ollama runtime to a typed provider error", async () => {
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    await expect(provider.classify(input, new AbortController().signal)).rejects.toMatchObject({
      name: "OllamaProviderError",
      code: "unavailable",
    } satisfies Partial<OllamaProviderError>);
  });

  it("maps a missing configured model to a typed provider error", async () => {
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "missing-model",
      fetcher: vi.fn().mockResolvedValue(jsonResponse({ error: "model not found" }, 404)),
    });

    await expect(provider.classify(input, new AbortController().signal)).rejects.toMatchObject({
      name: "OllamaProviderError",
      code: "model-missing",
    } satisfies Partial<OllamaProviderError>);
  });

  it("rejects malformed model content through the shared response validator", async () => {
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher: vi.fn().mockResolvedValue(jsonResponse({ message: { content: "not-json" } })),
    });

    await expect(provider.classify(input, new AbortController().signal)).rejects.toBeInstanceOf(
      MalformedClassificationResponseError,
    );
  });

  it("maps malformed successful HTTP response bodies to a classification response error", async () => {
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher: vi.fn().mockResolvedValue(new Response("not JSON", { status: 200 })),
    });

    await expect(provider.classify(input, new AbortController().signal)).rejects.toBeInstanceOf(
      MalformedClassificationResponseError,
    );
  });

  it("maps a provider timeout to a typed provider error", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Timed out", "AbortError")),
          );
        }),
    );
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      timeoutMs: 100,
      fetcher,
    });

    const result = provider.classify(input, new AbortController().signal);
    const expectation = expect(result).rejects.toMatchObject({
      code: "timeout",
    } satisfies Partial<OllamaProviderError>);
    await vi.advanceTimersByTimeAsync(100);

    await expectation;
  });

  it("preserves caller cancellation instead of treating it as a provider failure", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher,
    });

    const result = provider.classify(input, controller.signal);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
