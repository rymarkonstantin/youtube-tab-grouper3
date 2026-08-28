import { describe, expect, it, vi } from "vitest";
import { runAdaptiveClassificationBatches } from "../../src/classifier/adaptive-batching";

type Item = { itemId: string };
const items = (count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({ itemId: `item-${index + 1}` }));

describe("adaptive classification batches", () => {
  it("starts at four and grows by two after two successful batches", async () => {
    const calls: number[] = [];
    const result = await runAdaptiveClassificationBatches(items(14), {
      signal: new AbortController().signal,
      maxConcurrency: 1,
      maxBatchSize: 12,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        calls.push(batch.length);
        return batch.map(({ itemId }) => ({ itemId, ruleId: "other" }));
      },
    });
    expect(calls).toEqual([4, 4, 6]);
    expect(result.results.map(({ itemId }) => itemId)).toEqual(
      items(14).map(({ itemId }) => itemId),
    );
  });

  it("halves after a timeout and recovers in deterministic order", async () => {
    const calls: number[] = [];
    const result = await runAdaptiveClassificationBatches(items(6), {
      signal: new AbortController().signal,
      maxConcurrency: 1,
      maxBatchSize: 12,
      isTimeout: (error) => error instanceof Error && error.message === "timeout",
      classifyBatch: async (batch) => {
        calls.push(batch.length);
        if (batch.length > 2) throw new Error("timeout");
        return batch.map(({ itemId }) => ({ itemId, ruleId: "other" }));
      },
    });
    expect(calls).toEqual([4, 2, 2, 2]);
    expect(result.results.map(({ itemId }) => itemId)).toEqual(
      items(6).map(({ itemId }) => itemId),
    );
  });

  it("reduces after an incomplete response and retries the missing item", async () => {
    const calls: number[] = [];
    const result = await runAdaptiveClassificationBatches(items(5), {
      signal: new AbortController().signal,
      maxConcurrency: 1,
      maxBatchSize: 12,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        calls.push(batch.length);
        return batch.length > 1
          ? batch.slice(0, 1).map(({ itemId }) => ({ itemId, ruleId: "other" }))
          : batch.map(({ itemId }) => ({ itemId, ruleId: "other" }));
      },
    });
    expect(calls).toEqual([4, 1, 1, 1, 1]);
    expect(result.results).toHaveLength(5);
  });

  it("is serial even when configured concurrency is higher", async () => {
    let active = 0;
    let peak = 0;
    await runAdaptiveClassificationBatches(items(8), {
      signal: new AbortController().signal,
      maxConcurrency: 1,
      maxBatchSize: 12,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return batch.map(({ itemId }) => ({ itemId, ruleId: "other" }));
      },
    });
    expect(peak).toBe(1);
  });

  it("retries an incomplete singleton once, then records it as failed", async () => {
    let calls = 0;
    const result = await runAdaptiveClassificationBatches(items(1), {
      signal: new AbortController().signal,
      maxConcurrency: 1,
      maxBatchSize: 12,
      isTimeout: () => false,
      classifyBatch: async () => {
        calls++;
        return [];
      },
    });
    expect(calls).toBe(2);
    expect(result.failedItemCount).toBe(1);
    expect(result.results).toEqual([]);
  });

  it("retries a recoverable singleton provider error once", async () => {
    let calls = 0;
    const result = await runAdaptiveClassificationBatches(items(1), {
      signal: new AbortController().signal,
      maxConcurrency: 1,
      maxBatchSize: 12,
      isTimeout: () => false,
      classifyBatch: async () => {
        calls++;
        throw new Error("transport failed");
      },
    });
    expect(calls).toBe(2);
    expect(result.failedItemCount).toBe(1);
  });

  it("splits a multi-item provider error before recovering its items", async () => {
    const calls: number[] = [];
    const result = await runAdaptiveClassificationBatches(items(4), {
      signal: new AbortController().signal,
      maxConcurrency: 1,
      maxBatchSize: 12,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        calls.push(batch.length);
        if (batch.length > 1) throw new Error("provider failed");
        return batch.map(({ itemId }) => ({ itemId, ruleId: "other" }));
      },
    });
    expect(calls).toEqual([4, 2, 1, 1, 2, 1, 1]);
    expect(result.results).toHaveLength(4);
    expect(result.failedItemCount).toBe(0);
  });

  it("reports average duration and eta and stops on cancellation", async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    await expect(
      runAdaptiveClassificationBatches(items(8), {
        signal: controller.signal,
        maxConcurrency: 1,
        maxBatchSize: 12,
        isTimeout: () => false,
        onProgress: (value) => {
          progress(value);
          if (value.completedItemCount > 0) controller.abort();
        },
        classifyBatch: async (batch) => batch.map(({ itemId }) => ({ itemId, ruleId: "other" })),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(progress.mock.calls.some(([value]) => value.averageItemDurationMs >= 0)).toBe(true);
    const snapshot = { ...progress.mock.calls[0]?.[0] };
    expect(snapshot).toHaveProperty("currentBatchSize");
    expect(snapshot).toHaveProperty("averageItemDurationMs");
    expect(snapshot).toHaveProperty("etaMs");
  });
});
