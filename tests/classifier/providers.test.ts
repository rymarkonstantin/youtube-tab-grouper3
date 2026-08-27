import { describe, expect, it, vi } from "vitest";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
import {
  ProviderChainClassifier,
  type ClassifierInput,
  type SemanticClassifierProvider,
} from "../../src/classifier/providers";
import type { ClassificationResult } from "../../src/types";

function provider(
  id: "ollama" | "remote",
  options: {
    health?: { available: boolean; reason?: string };
    classify?: (input: ClassifierInput) => Promise<ClassificationResult[]>;
  } = {},
): SemanticClassifierProvider & {
  health: ReturnType<typeof vi.fn>;
  classify: ReturnType<typeof vi.fn>;
} {
  return {
    id,
    health: vi.fn(async () => options.health ?? { available: true }),
    classify: vi.fn(async (input: ClassifierInput) =>
      options.classify
        ? options.classify(input)
        : input.items.map(({ itemId }) => ({
            itemId,
            ruleId: "uncategorized",
            reason: "fallback",
          })),
    ),
  };
}

const input: ClassifierInput = {
  items: [
    { itemId: "item-1", metadata: { videoId: "video-1", pageType: "watch", title: "Title" } },
  ],
  rules: [],
  fallbackRuleId: "uncategorized",
};

describe("ProviderChainClassifier", () => {
  it("uses Ollama first when automatic mode has a configured remote fallback", async () => {
    const config = createDefaultClassifierConfig();
    config.remote = {
      enabled: true,
      endpoint: "https://classifier.example",
      model: "model",
      apiKey: "key",
    };
    const local = provider("ollama");
    const remote = provider("remote");
    const classifier = new ProviderChainClassifier({
      config,
      providers: { ollama: local, remote },
      signal: new AbortController().signal,
    });

    await classifier.classify(input.items, input.rules, input.fallbackRuleId);

    expect(local.classify).toHaveBeenCalledOnce();
    expect(remote.classify).not.toHaveBeenCalled();
    expect(classifier.activeProviderId).toBe("ollama");
  });

  it("falls back to remote exactly once after an Ollama operational failure", async () => {
    const config = createDefaultClassifierConfig();
    config.remote = {
      enabled: true,
      endpoint: "https://classifier.example",
      model: "model",
      apiKey: "key",
    };
    const local = provider("ollama", {
      classify: async () => Promise.reject(new Error("connection refused")),
    });
    const remote = provider("remote");
    const fallback = vi.fn();
    const classifier = new ProviderChainClassifier({
      config,
      providers: { ollama: local, remote },
      signal: new AbortController().signal,
      onFallback: fallback,
    });

    await classifier.classify(input.items, input.rules, input.fallbackRuleId);
    await classifier.classify(input.items, input.rules, input.fallbackRuleId);

    expect(fallback).toHaveBeenCalledOnce();
    expect(local.classify).toHaveBeenCalledOnce();
    expect(remote.classify).toHaveBeenCalledTimes(2);
    expect(classifier.activeProviderId).toBe("remote");
  });

  it("does not use remote in local-only mode when Ollama fails", async () => {
    const config = createDefaultClassifierConfig();
    config.mode = "local-only";
    config.remote = {
      enabled: true,
      endpoint: "https://classifier.example",
      model: "model",
      apiKey: "key",
    };
    const local = provider("ollama", {
      classify: async () => Promise.reject(new Error("connection refused")),
    });
    const remote = provider("remote");
    const classifier = new ProviderChainClassifier({
      config,
      providers: { ollama: local, remote },
      signal: new AbortController().signal,
    });

    await expect(
      classifier.classify(input.items, input.rules, input.fallbackRuleId),
    ).rejects.toThrow("connection refused");
    expect(remote.classify).not.toHaveBeenCalled();
  });

  it("does not fall back when cancellation aborts the local classifier", async () => {
    const config = createDefaultClassifierConfig();
    config.remote = {
      enabled: true,
      endpoint: "https://classifier.example",
      model: "model",
      apiKey: "key",
    };
    const controller = new AbortController();
    const local = provider("ollama", {
      classify: async () => {
        controller.abort(new DOMException("Cancelled", "AbortError"));
        throw controller.signal.reason;
      },
    });
    const remote = provider("remote");
    const fallback = vi.fn();
    const classifier = new ProviderChainClassifier({
      config,
      providers: { ollama: local, remote },
      signal: controller.signal,
      onFallback: fallback,
    });

    await expect(
      classifier.classify(input.items, input.rules, input.fallbackRuleId),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(remote.classify).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("schedules provider requests in batches of at most four", async () => {
    const local = provider("ollama");
    const classifier = new ProviderChainClassifier({
      config: createDefaultClassifierConfig(),
      providers: { ollama: local },
      signal: new AbortController().signal,
    });
    const items = Array.from({ length: 9 }, (_, index) => ({
      itemId: `item-${index + 1}`,
      metadata: { videoId: `video-${index + 1}`, pageType: "watch" as const, title: "Title" },
    }));

    const results = await classifier.classify(items, input.rules, input.fallbackRuleId);

    expect(local.classify.mock.calls.map(([batch]) => batch.items.length)).toEqual([4, 4, 1]);
    expect(results.map(({ itemId }) => itemId)).toEqual(items.map(({ itemId }) => itemId));
  });

  it("retains incomplete local results and retries missing items without remote fallback", async () => {
    const config = createDefaultClassifierConfig();
    config.remote = {
      enabled: true,
      endpoint: "https://classifier.example",
      model: "model",
      apiKey: "key",
    };
    const local = provider("ollama", {
      classify: async (batch) =>
        batch.items.length > 1
          ? [{ itemId: "item-1", ruleId: "uncategorized" }]
          : [{ itemId: batch.items[0]?.itemId ?? "", ruleId: "uncategorized" }],
    });
    const remote = provider("remote");
    const classifier = new ProviderChainClassifier({
      config,
      providers: { ollama: local, remote },
      signal: new AbortController().signal,
    });
    const items = [
      {
        itemId: "item-1",
        metadata: { videoId: "video-1", pageType: "watch" as const, title: "One" },
      },
      {
        itemId: "item-2",
        metadata: { videoId: "video-2", pageType: "watch" as const, title: "Two" },
      },
    ];

    const results = await classifier.classify(items, input.rules, input.fallbackRuleId);

    expect(results.map(({ itemId }) => itemId)).toEqual(["item-1", "item-2"]);
    expect(
      local.classify.mock.calls.map((call) =>
        (call[0] as ClassifierInput).items.map((item) => item.itemId),
      ),
    ).toEqual([["item-1", "item-2"], ["item-2"]]);
    expect(remote.classify).not.toHaveBeenCalled();
  });

  it("reports aggregate batch progress without item metadata", async () => {
    const progress = vi.fn();
    const local = provider("ollama");
    const classifier = new ProviderChainClassifier({
      config: createDefaultClassifierConfig(),
      providers: { ollama: local },
      signal: new AbortController().signal,
      onBatchProgress: progress,
    });

    await classifier.classify(input.items, input.rules, input.fallbackRuleId);

    expect(progress).toHaveBeenLastCalledWith({
      completedBatchCount: 1,
      completedItemCount: 1,
      failedItemCount: 0,
      recoveredItemCount: 0,
      splitCount: 0,
      startedBatchCount: 1,
    });
  });
});
