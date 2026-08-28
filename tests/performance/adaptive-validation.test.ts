import { describe, expect, it } from "vitest";
import { fingerprintClassificationRules, fingerprintMetadata } from "../../src/cache/fingerprint";
import { runAdaptiveClassificationBatches } from "../../src/classifier/adaptive-batching";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
import { createDefaultRuleConfig } from "../../src/rules/defaults";

type Item = { itemId: string };

const makeItems = (count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({ itemId: `video-${index + 1}` }));

describe("adaptive Ollama release validation", () => {
  it.each([2, 13, 181])("keeps %i items ordered and classified", async (count) => {
    const input = makeItems(count);
    const batches: number[] = [];
    const result = await runAdaptiveClassificationBatches(input, {
      signal: new AbortController().signal,
      maxConcurrency: 1,
      maxBatchSize: 12,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        batches.push(batch.length);
        return batch.map(({ itemId }) => ({ itemId, ruleId: "other" }));
      },
    });

    expect(result.results.map(({ itemId }) => itemId)).toEqual(input.map(({ itemId }) => itemId));
    expect(result.results).toHaveLength(count);
    expect(batches[0]).toBe(Math.min(4, count));
    expect(Math.max(...batches)).toBeLessThanOrEqual(12);
    expect(result.failedItemCount).toBe(0);
  });

  it("does not make scheduling controls part of the semantic cache key", async () => {
    const rules = createDefaultRuleConfig();
    const baseline = createDefaultClassifierConfig();
    const faster = { ...baseline, concurrency: 8 };
    const baselineFingerprint = await fingerprintClassificationRules(rules, baseline, "ollama");

    expect(await fingerprintClassificationRules(rules, faster, "ollama")).toBe(baselineFingerprint);
  });

  it("invalidates semantic cache fingerprints for provider, schema, or metadata changes", async () => {
    const rules = createDefaultRuleConfig();
    const baseline = createDefaultClassifierConfig();
    const baselineRules = await fingerprintClassificationRules(rules, baseline, "ollama");
    const modelChanged = structuredClone(baseline);
    modelChanged.local.model = "another-model";
    const schemaChanged = { ...baseline, schemaVersion: 2 as typeof baseline.schemaVersion };
    const metadata = {
      videoId: "video-1",
      pageType: "watch" as const,
      title: "A semantic title",
      channelName: "A channel",
    };
    const changedMetadata = { ...metadata, title: "A different semantic title" };

    expect(await fingerprintClassificationRules(rules, modelChanged, "ollama")).not.toBe(
      baselineRules,
    );
    expect(await fingerprintClassificationRules(rules, schemaChanged, "ollama")).not.toBe(
      baselineRules,
    );
    expect(await fingerprintMetadata(changedMetadata)).not.toBe(
      await fingerprintMetadata(metadata),
    );
  });
});
