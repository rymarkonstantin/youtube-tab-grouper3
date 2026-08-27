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
    classify?: () => Promise<ClassificationResult[]>;
  } = {},
): SemanticClassifierProvider & {
  health: ReturnType<typeof vi.fn>;
  classify: ReturnType<typeof vi.fn>;
} {
  return {
    id,
    health: vi.fn(async () => options.health ?? { available: true }),
    classify: vi.fn(async () =>
      options.classify
        ? options.classify()
        : [{ itemId: "item-1", ruleId: "uncategorized", reason: "fallback" }],
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
});
