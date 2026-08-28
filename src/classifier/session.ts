import type { ClassificationItem, ClassificationResult, GroupRule } from "../types";
import type { ClassifierInput } from "./providers";

export interface ProviderCapabilities {
  readonly maxConcurrency: number;
  readonly maxBatchSize: number;
  readonly supportsPreparedRuns: boolean;
}

export const DEFAULT_LOCAL_PROVIDER_CAPABILITIES: ProviderCapabilities = Object.freeze({
  maxConcurrency: 1,
  maxBatchSize: 4,
  supportsPreparedRuns: true,
});

export type PreparedRunBatchInput = Omit<ClassifierInput, "items" | "rules"> & {
  readonly items: readonly ClassificationItem[];
  readonly rules: readonly GroupRule[];
  readonly model: string;
  readonly schemaVersion: string;
};

export interface PreparedRunContext {
  readonly rules: readonly GroupRule[];
  readonly fallbackRuleId: string;
  readonly model: string;
  readonly schemaVersion: string;
  readonly capabilities?: ProviderCapabilities;
  classifyBatch(
    input: PreparedRunBatchInput,
    signal: AbortSignal,
  ): Promise<ClassificationResult[]>;
}

export interface PreparedClassificationRun {
  readonly rules: readonly GroupRule[];
  readonly fallbackRuleId: string;
  readonly model: string;
  readonly schemaVersion: string;
  readonly maxConcurrency: number;
  readonly maxBatchSize: number;
  classifyBatch(
    items: readonly ClassificationItem[],
    signal: AbortSignal,
  ): Promise<ClassificationResult[]>;
  dispose(): void;
}

export function createPreparedClassificationRun(
  context: PreparedRunContext,
): PreparedClassificationRun {
  const rules = Object.freeze(context.rules.map((rule) => Object.freeze({ ...rule })));
  const capabilities = context.capabilities ?? DEFAULT_LOCAL_PROVIDER_CAPABILITIES;
  let disposed = false;

  return {
    rules,
    fallbackRuleId: context.fallbackRuleId,
    model: context.model,
    schemaVersion: context.schemaVersion,
    maxConcurrency: capabilities.maxConcurrency,
    maxBatchSize: capabilities.maxBatchSize,
    async classifyBatch(items, signal) {
      if (disposed) throw new Error("Prepared classification run has been disposed");
      if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      return context.classifyBatch(
        {
          items: items.map((item) => ({ ...item, metadata: { ...item.metadata } })),
          rules,
          fallbackRuleId: context.fallbackRuleId,
          model: context.model,
          schemaVersion: context.schemaVersion,
        },
        signal,
      );
    },
    dispose() {
      disposed = true;
    },
  };
}
