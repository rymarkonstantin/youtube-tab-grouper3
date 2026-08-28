import type { ClassificationResult } from "../types";
import type {
  ClassificationBatchItem,
  ClassificationBatchProgress,
  ClassificationBatchRunResult,
} from "./batching";

export interface AdaptiveBatchProgress extends ClassificationBatchProgress {
  currentBatchSize: number;
  averageItemDurationMs: number;
  etaMs: number | null;
}

export interface AdaptiveBatchOptions<T extends ClassificationBatchItem> {
  maxConcurrency: number;
  maxBatchSize: number;
  signal: AbortSignal;
  classifyBatch(batch: T[], signal: AbortSignal): Promise<ClassificationResult[]>;
  isTimeout(error: unknown): boolean;
  onProgress?(progress: AdaptiveBatchProgress): void;
}

const INITIAL_BATCH_SIZE = 4;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 12;

/** Runs independent local batches serially, adapting item count to observed provider health. */
export async function runAdaptiveClassificationBatches<T extends ClassificationBatchItem>(
  items: T[],
  options: AdaptiveBatchOptions<T>,
): Promise<
  ClassificationBatchRunResult & Pick<AdaptiveBatchProgress, "averageItemDurationMs" | "etaMs">
> {
  const maxBatchSize = clamp(options.maxBatchSize, MIN_BATCH_SIZE, MAX_BATCH_SIZE);
  const resultsById = new Map<string, ClassificationResult>();
  const progress: ClassificationBatchProgress = {
    startedBatchCount: 0,
    completedBatchCount: 0,
    completedItemCount: 0,
    splitCount: 0,
    recoveredItemCount: 0,
    failedItemCount: 0,
  };
  let batchSize = clamp(INITIAL_BATCH_SIZE, MIN_BATCH_SIZE, maxBatchSize);
  let successfulBatches = 0;
  let totalItemDuration = 0;
  let durationSamples = 0;
  let cursor = 0;

  const notify = () => {
    const averageItemDurationMs = durationSamples === 0 ? 0 : totalItemDuration / durationSamples;
    const remaining = Math.max(
      0,
      items.length - progress.completedItemCount - progress.failedItemCount,
    );
    const enhanced: AdaptiveBatchProgress = {
      ...progress,
      currentBatchSize: batchSize,
      averageItemDurationMs,
      etaMs:
        remaining === 0 || averageItemDurationMs === 0 ? null : remaining * averageItemDurationMs,
    };
    // Keep the original aggregate progress shape compatible with existing consumers while making
    // adaptive values available to consumers that opt into the richer fields.
    Object.defineProperties(enhanced, {
      currentBatchSize: { enumerable: false, value: batchSize },
      averageItemDurationMs: { enumerable: false, value: averageItemDurationMs },
      etaMs: { enumerable: false, value: enhanced.etaMs },
    });
    options.onProgress?.(enhanced);
  };

  const store = (results: ClassificationResult[]) => {
    for (const result of results) resultsById.set(result.itemId, result);
  };

  const execute = async (batch: T[], recovered: boolean, retry = false): Promise<boolean> => {
    throwIfAborted(options.signal);
    progress.startedBatchCount++;
    notify();
    const started = Date.now();
    try {
      const response = await options.classifyBatch(batch, options.signal);
      throwIfAborted(options.signal);
      const valid = validResults(response, batch);
      progress.completedBatchCount++;
      progress.completedItemCount += valid.length;
      if (recovered) progress.recoveredItemCount += valid.length;
      store(valid);
      const duration = Date.now() - started;
      totalItemDuration += duration;
      durationSamples += batch.length;
      notify();
      const returned = new Set(valid.map(({ itemId }) => itemId));
      const missing = batch.filter(({ itemId }) => !returned.has(itemId));
      if (missing.length === 0) {
        if (!recovered) successfulBatches++;
        if (successfulBatches >= 2) {
          batchSize = clamp(batchSize + 2, MIN_BATCH_SIZE, maxBatchSize);
          successfulBatches = 0;
        }
        return true;
      }
      successfulBatches = 0;
      batchSize = Math.max(MIN_BATCH_SIZE, Math.floor(batchSize / 2));
      for (const item of missing) await execute([item], true, false);
      return true;
    } catch (error) {
      if (options.signal.aborted) throw abortError(options.signal);
      successfulBatches = 0;
      batchSize = Math.max(MIN_BATCH_SIZE, Math.floor(batchSize / 2));
      if (!options.isTimeout(error)) {
        if (batch.length === 1 && recovered) {
          progress.failedItemCount++;
          notify();
          return false;
        }
        throw error;
      }
      if (batch.length === 1) {
        if (!retry) return execute(batch, true, true);
        progress.failedItemCount++;
        notify();
        return false;
      }
      progress.splitCount++;
      notify();
      const midpoint = Math.ceil(batch.length / 2);
      await execute(batch.slice(0, midpoint), true);
      await execute(batch.slice(midpoint), true);
      return true;
    }
  };

  while (cursor < items.length) {
    throwIfAborted(options.signal);
    const batch = items.slice(cursor, cursor + batchSize);
    await execute(batch, false);
    cursor += batch.length;
  }
  notify();
  return {
    ...progress,
    averageItemDurationMs: durationSamples === 0 ? 0 : totalItemDuration / durationSamples,
    etaMs: null,
    results: items.flatMap(({ itemId }) => {
      const result = resultsById.get(itemId);
      return result ? [result] : [];
    }),
  };
}

function validResults<T extends ClassificationBatchItem>(
  results: ClassificationResult[],
  items: T[],
) {
  const expected = new Set(items.map(({ itemId }) => itemId));
  const seen = new Set<string>();
  return results.filter(
    (result) => expected.has(result.itemId) && !seen.has(result.itemId) && seen.add(result.itemId),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, min), max) : min;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}
