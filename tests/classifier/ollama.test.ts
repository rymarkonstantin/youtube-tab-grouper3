import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupRule } from "../../src/types";
import type { ClassifierInput } from "../../src/classifier/providers";
import { OllamaClassifierProvider, type OllamaProviderError } from "../../src/classifier/ollama";
import { MalformedClassificationResponseError } from "../../src/classifier/errors";
import type { PreparedRunContext } from "../../src/classifier/session";

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

const twoItemInput: ClassifierInput = {
  ...input,
  items: [
    ...input.items,
    {
      itemId: "video-2",
      metadata: {
        videoId: "def",
        pageType: "watch",
        title: "Second video",
        description: "Another description",
        channelName: "Another channel",
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

  it("logs safe request details when the local runtime fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    await provider.health(new AbortController().signal);

    expect(warn).toHaveBeenCalledWith(
      "[youtube-tab-grouper3] ollama:request:error",
      expect.objectContaining({
        path: "/api/show",
        errorType: "TypeError",
        errorMessage: "Failed to fetch",
      }),
    );
    warn.mockRestore();
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

  it("invokes the native fetcher with the global receiver", async () => {
    const fetcher = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        jsonResponse({ details: { family: "qwen2" }, capabilities: ["completion"] }),
      );
    });
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher,
    });

    await expect(provider.health(new AbortController().signal)).resolves.toEqual({
      available: true,
    });
  });

  it("sends a semantic structured-output request to the configured model and endpoint", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(validResponse()));
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

  it("returns valid items from an incomplete batch without adapter retries", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        message: {
          content: JSON.stringify({
            results: [
              {
                itemId: "video-1",
                ruleId: "programming",
                reason: "The first video is about software development.",
              },
            ],
          }),
        },
      }),
    );
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher,
    });

    await expect(provider.classify(twoItemInput, new AbortController().signal)).resolves.toEqual([
      {
        itemId: "video-1",
        ruleId: "programming",
        reason: "The first video is about software development.",
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends one transport request for each provider-chain batch", async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      itemId: `video-${index}`,
      metadata: {
        videoId: `video-${index}`,
        pageType: "watch" as const,
        title: `Video ${index}`,
        description: "Description",
        channelName: "Channel",
      },
    }));
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const requestItems = JSON.parse(body.messages[1]?.content ?? "{}").items as Array<{
        itemId: string;
      }>;
      return jsonResponse({
        message: {
          content: JSON.stringify({
            results: requestItems.map(({ itemId }) => ({
              itemId,
              ruleId: "uncategorized",
              reason: "No specific topic matches.",
            })),
          }),
        },
      });
    });
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher,
    });

    await expect(
      provider.classify({ ...input, items }, new AbortController().signal),
    ).resolves.toHaveLength(5);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>;
    };
    expect(JSON.parse(body.messages[1]?.content ?? "{}").items).toHaveLength(5);
  });

  it("uses compact Turbo prompts for its transport request", async () => {
    const fetcher = vi.fn().mockResolvedValue(validResponse());
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher,
    });
    const turboInput = {
      ...input,
      turboMode: true,
      items: [
        {
          itemId: "video-1",
          metadata: {
            videoId: "abc",
            pageType: "watch" as const,
            title: "t".repeat(201),
            description: "d".repeat(601),
            channelName: "c".repeat(101),
            hashtags: ["h".repeat(61), "two", "three", "four", "five", "six", "seven"],
            playlistTitle: "p".repeat(121),
          },
        },
      ],
    };

    await provider.classify(turboInput, new AbortController().signal);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>;
    };
    const sent = JSON.parse(body.messages[1]?.content ?? "{}") as {
      items: Array<Record<string, unknown>>;
    };
    expect(body.messages[0]?.content).toContain("reason is optional");
    expect(sent.items[0]).toMatchObject({
      title: "t".repeat(200),
      description: "d".repeat(600),
      channelName: "c".repeat(100),
      hashtags: ["h".repeat(60), "two", "three", "four", "five", "six"],
      playlistTitle: "p".repeat(120),
    });
  });

  it("prepares the rule context once and keeps each Ollama request stateless", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(validResponse()));
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher,
    });
    const context: PreparedRunContext = {
      rules,
      fallbackRuleId: input.fallbackRuleId,
      model: "qwen2.5:3b-instruct",
      schemaVersion: "classification-v1",
      classifyBatch: async () => [],
    };

    const run = await provider.prepare(context, new AbortController().signal);
    await run.classifyBatch(input.items, new AbortController().signal);
    await run.classifyBatch(input.items, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(
      ([, init]) =>
        JSON.parse(String(init?.body)) as {
          keep_alive?: unknown;
          messages: Array<{ role: string; content: string }>;
        },
    );
    expect(bodies.map(({ keep_alive }) => keep_alive)).toEqual(["10m", "10m"]);
    expect(bodies[0]?.messages).toHaveLength(2);
    expect(bodies[1]?.messages).toHaveLength(2);
    expect(bodies[0]?.messages[0]).toEqual(bodies[1]?.messages[0]);
    expect(bodies[0]?.messages[1]?.role).toBe("user");
    expect(bodies[1]?.messages[1]?.role).toBe("user");
    expect(bodies[0]?.messages[1]?.content).not.toContain("results");
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

  it("returns no results when model content is malformed", async () => {
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      fetcher: vi.fn().mockResolvedValue(jsonResponse({ message: { content: "not-json" } })),
    });

    await expect(provider.classify(input, new AbortController().signal)).resolves.toEqual([]);
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

  it("keeps the deadline active until the model response body finishes parsing", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const response = new Response(
      JSON.stringify({ message: { content: JSON.stringify({ results: [] }) } }),
    );
    vi.spyOn(response, "json").mockImplementation(
      () =>
        new Promise<unknown>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () =>
            reject(new DOMException("Timed out", "AbortError")),
          );
        }),
    );
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return Promise.resolve(response);
    });
    const provider = new OllamaClassifierProvider({
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b-instruct",
      timeoutMs: 100,
      fetcher,
    });

    const result = provider.classify(input, new AbortController().signal);
    const outcome = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);

    expect(requestSignal?.aborted).toBe(true);
    await expect(outcome).resolves.toMatchObject({
      code: "timeout",
    } satisfies Partial<OllamaProviderError>);
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
