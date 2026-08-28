import { describe, expect, it, vi } from "vitest";
import {
  createPreparedClassificationRun,
  type PreparedRunBatchInput,
  type PreparedRunContext,
} from "../../src/classifier/session";
import type { ClassificationItem, ClassificationResult, GroupRule } from "../../src/types";

const rules: GroupRule[] = [
  { id: "programming", name: "Programming", description: "Software development", color: "green", enabled: true },
];
const item: ClassificationItem = {
  itemId: "item-1",
  metadata: { videoId: "video-1", pageType: "watch", title: "A title", hashtags: ["topic"] },
};

describe("prepared classification run", () => {
  it("captures rules and model identity once and exposes local serial capability", async () => {
    const classifyBatch = vi.fn(async (_input: PreparedRunBatchInput, _signal: AbortSignal): Promise<ClassificationResult[]> => [
      { itemId: item.itemId, ruleId: "programming" },
    ]);
    const context: PreparedRunContext = {
      rules,
      fallbackRuleId: "other",
      model: "qwen2.5:3b-instruct",
      schemaVersion: "classification-v1",
      classifyBatch,
    };

    const run = createPreparedClassificationRun(context);

    expect(run.maxConcurrency).toBe(1);
    expect(run.maxBatchSize).toBe(12);
    expect(run.rules).toEqual(rules);
    expect(run.model).toBe("qwen2.5:3b-instruct");
    expect(run.schemaVersion).toBe("classification-v1");
    await expect(run.classifyBatch([item], new AbortController().signal)).resolves.toEqual([
      { itemId: item.itemId, ruleId: "programming" },
    ]);
    expect(classifyBatch).toHaveBeenCalledWith(
      { items: [item], rules: run.rules, fallbackRuleId: "other", model: "qwen2.5:3b-instruct", schemaVersion: "classification-v1" },
      expect.any(AbortSignal),
    );
    const forwardedItem = classifyBatch.mock.calls[0]?.[0].items[0];
    expect(forwardedItem?.metadata.hashtags).toEqual(["topic"]);
    expect(forwardedItem?.metadata.hashtags).not.toBe(item.metadata.hashtags);
  });

  it("rejects classification after disposal", async () => {
    const run = createPreparedClassificationRun({
      rules,
      fallbackRuleId: "other",
      model: "model",
      schemaVersion: "schema",
      classifyBatch: async () => [],
    });

    run.dispose();

    await expect(run.classifyBatch([item], new AbortController().signal)).rejects.toThrow(
      "Prepared classification run has been disposed",
    );
  });
});
