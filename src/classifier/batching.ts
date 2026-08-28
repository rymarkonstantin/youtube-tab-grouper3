import type { ClassificationResult } from "../types";

export interface ClassificationBatchItem {
  itemId: string;
}

export interface ClassificationBatchProgress {
  startedBatchCount: number;
  completedBatchCount: number;
  completedItemCount: number;
  splitCount: number;
  recoveredItemCount: number;
  failedItemCount: number;
  currentBatchSize?: number;
  averageItemDurationMs?: number;
  etaMs?: number | null;
  preparationDurationMs?: number;
}

export interface ClassificationBatchOptions<T extends ClassificationBatchItem> {
  maxBatchSize: number;
  concurrency: number;
  signal: AbortSignal;
  classifyBatch(batch: T[], signal: AbortSignal): Promise<ClassificationResult[]>;
  isTimeout(error: unknown): boolean;
  onProgress?(progress: ClassificationBatchProgress): void;
}

export interface ClassificationBatchRunResult extends ClassificationBatchProgress {
  results: ClassificationResult[];
}

/**
 * Runs bounded provider requests through a stable-index worker pool.
 *
 * A complete batch transport failure is deliberately propagated so the provider chain can apply
 * its one-time provider-level fallback. Timeout and incomplete-response recovery instead stay
 * within the selected provider, preserving every valid classification that was returned.
 */
export async function runClassificationBatches<T extends ClassificationBatchItem>(
  items: T[],
  options: ClassificationBatchOptions<T>,
): Promise<ClassificationBatchRunResult> {
  const batches = partition(items, normalizeBatchSize(options.maxBatchSize));
  const concurrency = normalizeConcurrency(options.concurrency);
  const resultsById = new Map<string, ClassificationResult>();
  const progress: ClassificationBatchProgress = {
    startedBatchCount: 0,
    completedBatchCount: 0,
    completedItemCount: 0,
    splitCount: 0,
    recoveredItemCount: 0,
    failedItemCount: 0,
  };
  let nextBatchIndex = 0;
  let fatalError: unknown;

  const notify = () => options.onProgress?.({ ...progress });

  const executeBatch = async (batch: T[], recovered: boolean): Promise<ClassificationResult[]> => {
    throwIfAborted(options.signal);
    progress.startedBatchCount++;
    notify();
    try {
      const response = await options.classifyBatch(batch, options.signal);
      throwIfAborted(options.signal);
      progress.completedBatchCount++;
      const valid = validResults(response, batch);
      progress.completedItemCount += valid.length;
      if (recovered) progress.recoveredItemCount += valid.length;
      notify();

      const returnedIds = new Set(valid.map(({ itemId }) => itemId));
      const missing = batch.filter(({ itemId }) => !returnedIds.has(itemId));
      if (missing.length === 0) return valid;
      if (batch.length === 1) {
        progress.failedItemCount++;
        notify();
        return valid;
      }

      const recoveredResults = [...valid];
      for (const item of missing) {
        recoveredResults.push(...(await executeBatch([item], true)));
      }
      return recoveredResults;
    } catch (error) {
      if (options.signal.aborted) throw abortError(options.signal);
      if (!options.isTimeout(error)) {
        if (!recovered) throw error;
        progress.failedItemCount += batch.length;
        notify();
        return [];
      }
      if (batch.length === 1) {
        progress.failedItemCount++;
        notify();
        return [];
      }
      progress.splitCount++;
      notify();
      const midpoint = Math.ceil(batch.length / 2);
      const left = await executeBatch(batch.slice(0, midpoint), true);
      const right = await executeBatch(batch.slice(midpoint), true);
      return [...left, ...right];
    }
  };

  const worker = async (): Promise<void> => {
    while (!options.signal.aborted && fatalError === undefined) {
      const batch = batches[nextBatchIndex++];
      if (!batch) return;
      try {
        for (const result of await executeBatch(batch, false)) {
          resultsById.set(result.itemId, result);
        }
      } catch (error) {
        fatalError ??= error;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  if (options.signal.aborted) throw abortError(options.signal);
  if (fatalError !== undefined) throw fatalError;

  return {
    ...progress,
    results: items.flatMap(({ itemId }) => {
      const result = resultsById.get(itemId);
      return result ? [result] : [];
    }),
  };
}

function partition<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

function normalizeBatchSize(value: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 4) : 4;
}

function normalizeConcurrency(value: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 8) : 1;
}

function validResults<T extends ClassificationBatchItem>(
  results: ClassificationResult[],
  items: T[],
): ClassificationResult[] {
  const expectedIds = new Set(items.map(({ itemId }) => itemId));
  const seen = new Set<string>();
  return results.filter(({ itemId }) => {
    if (!expectedIds.has(itemId) || seen.has(itemId)) return false;
    seen.add(itemId);
    return true;
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}
