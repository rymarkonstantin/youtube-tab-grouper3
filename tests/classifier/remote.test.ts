import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassifierInput } from "../../src/classifier/providers";
import { MalformedClassificationResponseError } from "../../src/classifier/errors";
import { RemoteClassifierProvider, type RemoteProviderError } from "../../src/classifier/remote";

const input: ClassifierInput = {
  fallbackRuleId: "uncategorized",
  rules: [
    {
      id: "programming",
      name: "Programming",
      description: "Software development and software engineering.",
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
  ],
  items: [
    {
      itemId: "video-1",
      metadata: {
        videoId: "private-video-id",
        pageType: "watch",
        title: "Разработка веб-приложения на TypeScript",
        description: "日本語の補足説明",
        channelName: "Технологии",
        hashtags: ["typescript"],
        playlistTitle: "Backend lessons",
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
    choices: [
      {
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
      },
    ],
  });
}

function createProvider(fetcher: typeof fetch): RemoteClassifierProvider {
  return new RemoteClassifierProvider({
    endpoint: "https://api.example.test/v1/",
    model: "semantic-model",
    apiKey: "remote-secret",
    fetcher,
  });
}

describe("RemoteClassifierProvider", () => {
  afterEach(() => vi.useRealTimers());

  it("sends an authorized, minimal OpenAI-compatible semantic request", async () => {
    const fetcher = vi.fn().mockResolvedValue(validResponse());
    const provider = createProvider(fetcher);

    await expect(provider.classify(input, new AbortController().signal)).resolves.toEqual([
      {
        itemId: "video-1",
        ruleId: "programming",
        reason: "The video is about TypeScript web development.",
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example.test/v1/chat/completions");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer remote-secret",
        "content-type": "application/json",
      },
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("semantic-model");
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    const requestText = JSON.stringify(body);
    expect(requestText).toContain("Разработка веб-приложения на TypeScript");
    expect(requestText).toContain("日本語の補足説明");
    expect(requestText).toContain("Технологии");
    expect(requestText).toContain("Backend lessons");
    expect(requestText).not.toContain("private-video-id");
    expect(requestText).not.toContain("pageType");
    expect(requestText).not.toContain("remote-secret");
  });

  it("does not duplicate the chat completions path when the endpoint already includes it", async () => {
    const fetcher = vi.fn().mockResolvedValue(validResponse());
    const provider = new RemoteClassifierProvider({
      endpoint: "https://api.example.test/v1/chat/completions/",
      model: "semantic-model",
      apiKey: "remote-secret",
      fetcher,
    });

    await provider.classify(input, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/v1/chat/completions",
      expect.anything(),
    );
  });

  it("returns valid items from an incomplete batch without adapter retries", async () => {
    const twoItemInput: ClassifierInput = {
      ...input,
      items: [
        ...input.items,
        {
          itemId: "video-2",
          metadata: {
            videoId: "second-video-id",
            pageType: "watch" as const,
            title: "Second video",
          },
        },
      ],
    };
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [{ itemId: "video-1", ruleId: "programming" }],
              }),
            },
          },
        ],
      }),
    );
    const provider = createProvider(fetcher);

    await expect(provider.classify(twoItemInput, new AbortController().signal)).resolves.toEqual([
      { itemId: "video-1", ruleId: "programming" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses compact Turbo prompts for its transport request", async () => {
    const fetcher = vi.fn().mockResolvedValue(validResponse());
    const provider = createProvider(fetcher);
    const turboInput = {
      ...input,
      turboMode: true,
      items: [
        {
          itemId: "video-1",
          metadata: {
            videoId: "private-video-id",
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

  it("maps an unsuccessful remote response to a typed provider error", async () => {
    const provider = createProvider(
      vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 401)),
    );

    await expect(provider.classify(input, new AbortController().signal)).rejects.toMatchObject({
      name: "RemoteProviderError",
      code: "request-failed",
    } satisfies Partial<RemoteProviderError>);
  });

  it("rejects malformed successful responses through the shared response validator", async () => {
    const provider = createProvider(vi.fn().mockResolvedValue(jsonResponse({ choices: [] })));

    await expect(provider.classify(input, new AbortController().signal)).rejects.toBeInstanceOf(
      MalformedClassificationResponseError,
    );
  });

  it("maps a remote timeout to a typed provider error", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Timed out", "AbortError")),
          );
        }),
    );
    const provider = new RemoteClassifierProvider({
      endpoint: "https://api.example.test/v1",
      model: "semantic-model",
      apiKey: "remote-secret",
      timeoutMs: 100,
      fetcher,
    });

    const result = provider.classify(input, new AbortController().signal);
    const expectation = expect(result).rejects.toMatchObject({
      code: "timeout",
    } satisfies Partial<RemoteProviderError>);
    await vi.advanceTimersByTimeAsync(100);

    await expectation;
  });

  it("keeps the deadline active until the response body finishes parsing", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const response = new Response(JSON.stringify({ choices: [] }));
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
    const provider = new RemoteClassifierProvider({
      endpoint: "https://api.example.test/v1",
      model: "semantic-model",
      apiKey: "remote-secret",
      timeoutMs: 100,
      fetcher,
    });

    const result = provider.classify(input, new AbortController().signal);
    const outcome = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);

    expect(requestSignal?.aborted).toBe(true);
    await expect(outcome).resolves.toMatchObject({
      code: "timeout",
    } satisfies Partial<RemoteProviderError>);
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
    const provider = createProvider(fetcher);

    const result = provider.classify(input, controller.signal);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never includes the configured API key in provider errors", async () => {
    const apiKey = "remote-secret";
    const provider = new RemoteClassifierProvider({
      endpoint: "https://api.example.test/v1",
      model: "semantic-model",
      apiKey,
      fetcher: vi.fn().mockRejectedValue(new Error(`Request failed with ${apiKey}`)),
    });

    await expect(provider.classify(input, new AbortController().signal)).rejects.toMatchObject({
      name: "RemoteProviderError",
      message: expect.not.stringContaining(apiKey),
    });
  });
});
