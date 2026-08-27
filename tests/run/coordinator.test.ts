import { describe, expect, it } from "vitest";
import type { ClassificationCacheEntry, ClassificationCacheKey } from "../../src/cache/storage";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
import { runGrouping } from "../../src/run/coordinator";
import {
  fakeRunDependencies,
  nonYouTubeTab,
  runOptions,
  videoMetadata,
  videoTab,
} from "../helpers/run-fixtures";
describe("runGrouping", () => {
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
});
