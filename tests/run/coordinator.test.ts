import { describe, expect, it, vi } from "vitest";
import type { ClassificationCacheEntry, ClassificationCacheKey } from "../../src/cache/storage";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
import type { ClassificationBatchProgress } from "../../src/classifier/batching";
import { runGrouping } from "../../src/run/coordinator";
import type { RunProgress } from "../../src/run/types";
import {
  fakeRunDependencies,
  nonYouTubeTab,
  runOptions,
  videoMetadata,
  videoTab,
} from "../helpers/run-fixtures";
describe("runGrouping", () => {
  it("forwards aggregate metadata progress and counts every candidate as eligible", async () => {
    const deps = fakeRunDependencies({
      tabs: [videoTab(10, "good"), videoTab(20, "missing"), nonYouTubeTab(30)],
      metadata: [videoMetadata("good", "Programming video")],
    });
    const values: RunProgress[] = [];

    const summary = await runGrouping(deps, {
      ...runOptions(),
      onProgress: (value) => values.push(value),
    });

    expect(values).toContainEqual(
      expect.objectContaining({
        phase: "metadata",
        completed: 2,
        total: 2,
        metadata: expect.objectContaining({ enriched: 1, failed: 1 }),
      }),
    );
    expect(summary).toMatchObject({ eligible: 2, skipped: 1, failed: 1 });
  });

  it("does not classify or mutate after metadata cancellation", async () => {
    const deps = fakeRunDependencies({ tabs: [videoTab(10, "cancelled")] });
    deps.tabs.collectMetadata = vi.fn(async (_tabs, options) => {
      options.signal.throwIfAborted();
      throw new DOMException("Aborted", "AbortError");
    });

    await expect(runGrouping(deps, runOptions())).rejects.toMatchObject({ name: "AbortError" });
    expect(deps.classifier.classify).not.toHaveBeenCalled();
    expect(deps.groups.groupTabs).not.toHaveBeenCalled();
  });

  it("makes no AI or group calls when no eligible videos exist", async () => {
    const deps = fakeRunDependencies({ tabs: [nonYouTubeTab(1)] });
    const summary = await runGrouping(deps, runOptions());
    expect(summary).toMatchObject({ eligible: 0, grouped: 0, skipped: 1, failed: 0 });
    expect(deps.classifier.classify).not.toHaveBeenCalled();
    expect(deps.groups.groupTabs).not.toHaveBeenCalled();
  });
  it("uses a valid cache hit without invoking AI", async () => {
    const deps = fakeRunDependencies({
      tabs: [videoTab(10, "video-a")],
      metadata: [videoMetadata("video-a", "C# performance improvements")],
      cacheHits: [{ videoId: "video-a", ruleId: "programming" }],
    });
    const summary = await runGrouping(deps, runOptions());
    expect(summary.cached).toBe(1);
    expect(summary.grouped).toBe(1);
    expect(deps.classifier.classify).not.toHaveBeenCalled();
  });
  it("classifies one duplicate work item and groups both tab copies", async () => {
    const deps = fakeRunDependencies({
      tabs: [videoTab(10, "same"), videoTab(20, "same")],
      metadata: [videoMetadata("same", "Autumn perch")],
      classifierResults: [{ itemId: "item-0", ruleId: "fishing", reason: "Fishing is primary." }],
    });
    const summary = await runGrouping(deps, runOptions());
    expect(deps.classifier.classify.mock.calls[0]?.[0]).toHaveLength(1);
    expect(deps.groups.allPassedTabIds).toEqual(expect.arrayContaining([10, 20]));
    expect(summary.grouped).toBe(2);
  });
  it("waits for classification before the first group mutation", async () => {
    const events: string[] = [];
    const deps = fakeRunDependencies({
      events,
      tabs: [videoTab(10, "video-a")],
      metadata: [videoMetadata("video-a", "Roman history")],
      classifierResults: [{ itemId: "item-0", ruleId: "history", reason: "History is primary." }],
    });
    await runGrouping(deps, runOptions());
    expect(events.indexOf("classification-finished")).toBeLessThan(events.indexOf("group-call"));
  });
  it("leaves only classifier-failed tabs unchanged while still grouping cached tabs", async () => {
    const deps = fakeRunDependencies({
      tabs: [videoTab(10, "cached"), videoTab(20, "uncached")],
      metadata: [
        videoMetadata("cached", "Cached programming video"),
        videoMetadata("uncached", "Unavailable classifier video"),
      ],
      cacheHits: [{ videoId: "cached", ruleId: "programming" }],
    });
    deps.classifier.classify.mockRejectedValueOnce(new Error("provider unavailable"));

    const summary = await runGrouping(deps, runOptions());

    expect(summary).toMatchObject({ grouped: 1, cached: 1, failed: 1 });
    expect(deps.groups.allPassedTabIds).toEqual([10]);
  });
  it("does not reuse a remote fallback cache entry when the next run selects Ollama", async () => {
    const classifierConfig = createDefaultClassifierConfig();
    classifierConfig.remote = {
      enabled: true,
      endpoint: "https://classifier.example",
      model: "remote-model",
      apiKey: "key",
    };
    const first = fakeRunDependencies({
      tabs: [videoTab(10, "video-a")],
      metadata: [videoMetadata("video-a", "History of programming languages")],
      classifierResults: [{ itemId: "item-0", ruleId: "history", reason: "History is primary." }],
    });
    first.classifierConfig = classifierConfig;
    const firstClassifier = first.classifier as typeof first.classifier & {
      activeProviderId: "ollama" | "remote" | undefined;
    };
    firstClassifier.activeProviderId = "ollama";
    firstClassifier.classify.mockImplementationOnce(async (items: Array<{ itemId: string }>) => {
      firstClassifier.activeProviderId = "remote";
      return items.map(({ itemId }) => ({
        itemId,
        ruleId: "history",
        reason: "History is primary.",
      }));
    });
    let remoteEntry: ClassificationCacheEntry | undefined;
    first.cache = {
      ...first.cache,
      put: async (entries) => {
        remoteEntry = entries[0];
      },
    };
    await runGrouping(first, runOptions());
    expect(remoteEntry).toBeDefined();

    const second = fakeRunDependencies({
      tabs: [videoTab(10, "video-a")],
      metadata: [videoMetadata("video-a", "History of programming languages")],
    });
    second.classifierConfig = classifierConfig;
    const secondClassifier = second.classifier as typeof second.classifier & {
      activeProviderId: "ollama" | "remote" | undefined;
    };
    secondClassifier.activeProviderId = "ollama";
    second.cache = {
      ...second.cache,
      find: async ({ rulesFingerprint }: ClassificationCacheKey) =>
        rulesFingerprint === remoteEntry?.rulesFingerprint ? remoteEntry : null,
    };

    await runGrouping(second, runOptions());

    expect(second.classifier.classify).toHaveBeenCalledOnce();
  });

  it("reports aggregate multi-batch classification progress", async () => {
    const deps = fakeRunDependencies({
      tabs: [videoTab(10, "video-a"), videoTab(20, "video-b")],
      metadata: [
        videoMetadata("video-a", "History video"),
        videoMetadata("video-b", "Photography video"),
      ],
    });
    let notify: ((progress: ClassificationBatchProgress) => void) | undefined;
    const providerAware = deps.classifier as typeof deps.classifier & {
      setBatchProgressListener(listener: (progress: ClassificationBatchProgress) => void): void;
    };
    providerAware.setBatchProgressListener = (listener) => {
      notify = listener;
    };
    providerAware.classify.mockImplementation(async (items: Array<{ itemId: string }>) => {
      notify?.({
        startedBatchCount: 1,
        completedBatchCount: 1,
        completedItemCount: 2,
        splitCount: 0,
        recoveredItemCount: 0,
        failedItemCount: 0,
      } as ClassificationBatchProgress);
      return items.map(({ itemId }) => ({ itemId, ruleId: "uncategorized" }));
    });
    const progress: Array<Record<string, unknown>> = [];

    await runGrouping(deps, {
      ...runOptions(),
      onProgress: (value) => progress.push(value as unknown as Record<string, unknown>),
    });

    expect(progress).toContainEqual(
      expect.objectContaining({
        phase: "classifying",
        completed: 2,
        total: 2,
        classification: expect.objectContaining({
          completedBatchCount: 1,
          completedItemCount: 2,
          configuredConcurrency: 1,
        }),
      }),
    );
  });

  it("forwards adaptive timing progress without exposing metadata", async () => {
    const deps = fakeRunDependencies({
      tabs: [videoTab(10, "video-a")],
      metadata: [videoMetadata("video-a", "Private title")],
    });
    let notify: ((progress: ClassificationBatchProgress) => void) | undefined;
    const providerAware = deps.classifier as typeof deps.classifier & {
      setBatchProgressListener(listener: (progress: ClassificationBatchProgress) => void): void;
    };
    providerAware.setBatchProgressListener = (listener) => {
      notify = listener;
    };
    providerAware.classify.mockImplementation(async (items: Array<{ itemId: string }>) => {
      notify?.({
        startedBatchCount: 1,
        completedBatchCount: 1,
        completedItemCount: 1,
        splitCount: 0,
        recoveredItemCount: 0,
        failedItemCount: 0,
        currentBatchSize: 4,
        averageItemDurationMs: 100,
        etaMs: 0,
      } as ClassificationBatchProgress);
      return items.map(({ itemId }) => ({ itemId, ruleId: "uncategorized" }));
    });
    const progress: Array<Record<string, unknown>> = [];
    await runGrouping(deps, {
      ...runOptions(),
      onProgress: (value) => progress.push(value as never),
    });
    expect(progress).toContainEqual(
      expect.objectContaining({
        phase: "classifying",
        classification: expect.objectContaining({ currentBatchSize: 4, etaMs: 0 }),
      }),
    );
  });
});
