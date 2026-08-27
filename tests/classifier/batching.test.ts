import { describe, expect, it, vi } from "vitest";
import { runClassificationBatches } from "../../src/classifier/batching";
import type { ClassificationResult } from "../../src/types";

interface TestItem {
  itemId: string;
}

class TestTimeoutError extends Error {
  readonly code = "timeout";
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T | PromiseLike<T>): void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function items(count: number): TestItem[] {
  return Array.from({ length: count }, (_, index) => ({ itemId: `item-${index + 1}` }));
}

function results(batch: TestItem[]): ClassificationResult[] {
  return batch.map(({ itemId }) => ({ itemId, ruleId: "uncategorized" }));
}

describe("runClassificationBatches", () => {
  it("runs batches sequentially when concurrency is one", async () => {
    const firstBatchStarted = deferred<void>();
    const releaseFirstBatch = deferred<void>();
    const calls: string[][] = [];

    const run = runClassificationBatches(items(5), {
      maxBatchSize: 4,
      concurrency: 1,
      signal: new AbortController().signal,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        calls.push(batch.map(({ itemId }) => itemId));
        if (calls.length === 1) {
          firstBatchStarted.resolve();
          await releaseFirstBatch.promise;
        }
        return results(batch);
      },
    });

    await firstBatchStarted.promise;
    expect(calls).toEqual([["item-1", "item-2", "item-3", "item-4"]]);

    releaseFirstBatch.resolve();
    await expect(run).resolves.toMatchObject({
      results: [
        { itemId: "item-1" },
        { itemId: "item-2" },
        { itemId: "item-3" },
        { itemId: "item-4" },
        { itemId: "item-5" },
      ],
    });
    expect(calls).toEqual([["item-1", "item-2", "item-3", "item-4"], ["item-5"]]);
  });

  it("never starts more than eight batches at once", async () => {
    const release = deferred<void>();
    const started = deferred<void>();
    let active = 0;
    let maxActive = 0;

    const run = runClassificationBatches(items(36), {
      maxBatchSize: 4,
      concurrency: 99,
      signal: new AbortController().signal,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        active++;
        maxActive = Math.max(maxActive, active);
        if (active === 8) started.resolve();
        await release.promise;
        active--;
        return results(batch);
      },
    });

    await started.promise;
    expect(maxActive).toBe(8);
    release.resolve();
    await expect(run).resolves.toMatchObject({ results: expect.any(Array) });
    expect(maxActive).toBe(8);
  });

  it("does not pass more than four items to a provider batch", async () => {
    const batchSizes: number[] = [];

    await runClassificationBatches(items(13), {
      maxBatchSize: 20,
      concurrency: 1,
      signal: new AbortController().signal,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        batchSizes.push(batch.length);
        return results(batch);
      },
    });

    expect(batchSizes).toEqual([4, 4, 4, 1]);
  });

  it("returns results in input order when batches finish out of order", async () => {
    const outcome = await runClassificationBatches(items(4), {
      maxBatchSize: 2,
      concurrency: 2,
      signal: new AbortController().signal,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        if (batch[0]?.itemId === "item-1") await new Promise((resolve) => setTimeout(resolve, 10));
        return results(batch);
      },
    });

    expect(outcome.results.map(({ itemId }) => itemId)).toEqual([
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
  });

  it("recursively splits timed out batches until single items recover", async () => {
    const batches: string[][] = [];

    const outcome = await runClassificationBatches(items(4), {
      maxBatchSize: 4,
      concurrency: 1,
      signal: new AbortController().signal,
      isTimeout: (error) => error instanceof TestTimeoutError,
      classifyBatch: async (batch) => {
        batches.push(batch.map(({ itemId }) => itemId));
        if (batch.length > 1) throw new TestTimeoutError();
        return results(batch);
      },
    });

    expect(batches).toEqual([
      ["item-1", "item-2", "item-3", "item-4"],
      ["item-1", "item-2"],
      ["item-1"],
      ["item-2"],
      ["item-3", "item-4"],
      ["item-3"],
      ["item-4"],
    ]);
    expect(outcome.results.map(({ itemId }) => itemId)).toEqual([
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
    expect(outcome.splitCount).toBe(3);
    expect(outcome.recoveredItemCount).toBe(4);
  });

  it("omits a single item that still times out while retaining recovered neighbors", async () => {
    const outcome = await runClassificationBatches(items(2), {
      maxBatchSize: 4,
      concurrency: 1,
      signal: new AbortController().signal,
      isTimeout: (error) => error instanceof TestTimeoutError,
      classifyBatch: async (batch) => {
        if (batch.length > 1 || batch[0]?.itemId === "item-2") throw new TestTimeoutError();
        return results(batch);
      },
    });

    expect(outcome.results).toEqual([{ itemId: "item-1", ruleId: "uncategorized" }]);
    expect(outcome.failedItemCount).toBe(1);
  });

  it("stops scheduling when the caller cancels", async () => {
    const controller = new AbortController();
    const classifyBatch = vi.fn(async (batch: TestItem[]) => {
      controller.abort(new DOMException("Cancelled", "AbortError"));
      return results(batch);
    });

    await expect(
      runClassificationBatches(items(5), {
        maxBatchSize: 4,
        concurrency: 1,
        signal: controller.signal,
        isTimeout: () => false,
        classifyBatch,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(classifyBatch).toHaveBeenCalledOnce();
  });

  it("preserves valid partial results and retries only missing items", async () => {
    const calls: string[][] = [];

    const outcome = await runClassificationBatches(items(3), {
      maxBatchSize: 4,
      concurrency: 1,
      signal: new AbortController().signal,
      isTimeout: () => false,
      classifyBatch: async (batch) => {
        calls.push(batch.map(({ itemId }) => itemId));
        if (batch.length > 1) return [{ itemId: "item-1", ruleId: "uncategorized" }];
        return results(batch);
      },
    });

    expect(calls).toEqual([["item-1", "item-2", "item-3"], ["item-2"], ["item-3"]]);
    expect(outcome.results.map(({ itemId }) => itemId)).toEqual(["item-1", "item-2", "item-3"]);
    expect(outcome.recoveredItemCount).toBe(2);
  });
});
