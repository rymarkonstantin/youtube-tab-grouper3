import type { ClassificationItem, ClassificationResult, GroupRule } from "../types";
import { canFallbackToRemote, selectProviderChain, type ClassifierConfig } from "./config";
import { runClassificationBatches, type ClassificationBatchProgress } from "./batching";
import { runAdaptiveClassificationBatches } from "./adaptive-batching";
import { OllamaProviderError } from "./ollama";
import { RemoteProviderError } from "./remote";
import type {
  PreparedClassificationRun,
  ProviderCapabilities,
  PreparedRunContext,
} from "./session";

export interface ClassifierInput {
  items: ClassificationItem[];
  rules: GroupRule[];
  fallbackRuleId: string;
  turboMode?: boolean;
}

export interface ProviderHealth {
  available: boolean;
  reason?: string;
}

export type ClassifierProviderId = "ollama" | "remote";

export interface SemanticClassifierProvider {
  readonly id: ClassifierProviderId;
  readonly capabilities?: ProviderCapabilities;
  prepare?(context: PreparedRunContext, signal: AbortSignal): Promise<PreparedClassificationRun>;
  classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassificationResult[]>;
  health(signal: AbortSignal): Promise<ProviderHealth>;
}

export interface ProviderChainClassifierOptions {
  config: ClassifierConfig;
  providers: Partial<Record<ClassifierProviderId, SemanticClassifierProvider>>;
  signal: AbortSignal;
  onHealth?(providerId: ClassifierProviderId, health: ProviderHealth): void;
  onSelected?(providerId: ClassifierProviderId): void;
  onFallback?(from: ClassifierProviderId, to: ClassifierProviderId, reason: unknown): void;
  onBatchProgress?(progress: ClassificationBatchProgress): void;
}

/** Selects a configured provider once per run, with one local-to-remote retry in Automatic mode. */
export class ProviderChainClassifier {
  private readonly providerIds: ClassifierProviderId[];
  private readonly providers: Partial<Record<ClassifierProviderId, SemanticClassifierProvider>>;
  private readonly signal: AbortSignal;
  private readonly allowRemoteFallback: boolean;
  private readonly onHealth: NonNullable<ProviderChainClassifierOptions["onHealth"]>;
  private readonly onSelected: NonNullable<ProviderChainClassifierOptions["onSelected"]>;
  private readonly onFallback: NonNullable<ProviderChainClassifierOptions["onFallback"]>;
  private onBatchProgress: NonNullable<ProviderChainClassifierOptions["onBatchProgress"]>;
  private readonly concurrency: number;
  private readonly turboMode: boolean;
  private readonly configuredLocalModel: string;
  private providerIndex = 0;

  activeProviderId: ClassifierProviderId | undefined;

  constructor(options: ProviderChainClassifierOptions) {
    this.providerIds = selectProviderChain(options.config);
    this.providers = options.providers;
    this.signal = options.signal;
    this.allowRemoteFallback = canFallbackToRemote(options.config);
    this.onHealth = options.onHealth ?? (() => undefined);
    this.onSelected = options.onSelected ?? (() => undefined);
    this.onFallback = options.onFallback ?? (() => undefined);
    this.onBatchProgress = options.onBatchProgress ?? (() => undefined);
    this.concurrency = options.config.concurrency;
    this.turboMode = options.config.turboMode;
    this.configuredLocalModel = options.config.local.model;
  }

  async classify(
    items: ClassificationItem[],
    rules: GroupRule[],
    fallbackRuleId: string,
  ): Promise<ClassificationResult[]> {
    throwIfAborted(this.signal);
    const provider = await this.resolveProvider();
    try {
      return await this.classifyWithProvider(provider, items, rules, fallbackRuleId);
    } catch (error) {
      if (this.signal.aborted) throw abortError(this.signal);
      if (!this.canTryRemote(provider.id)) throw error;
      const next = await this.advanceToRemote(provider.id, error);
      return this.classifyWithProvider(next, items, rules, fallbackRuleId);
    }
  }

  setBatchProgressListener(
    listener: NonNullable<ProviderChainClassifierOptions["onBatchProgress"]>,
  ): void {
    this.onBatchProgress = listener;
  }

  private async classifyWithProvider(
    provider: SemanticClassifierProvider,
    items: ClassificationItem[],
    rules: GroupRule[],
    fallbackRuleId: string,
  ): Promise<ClassificationResult[]> {
    if (provider.id === "ollama" && provider.capabilities?.supportsPreparedRuns === true) {
      const prepared = provider.prepare
        ? await provider.prepare(
            {
              rules,
              fallbackRuleId,
              model: this.providers.ollama === provider ? this.getLocalModel() : "",
              schemaVersion: "classification-v1",
              turboMode: this.turboMode,
              ...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
            },
            this.signal,
          )
        : undefined;
      try {
        const outcome = await runAdaptiveClassificationBatches(items, {
          maxBatchSize: prepared?.maxBatchSize ?? provider.capabilities?.maxBatchSize ?? 12,
          maxConcurrency: prepared?.maxConcurrency ?? provider.capabilities?.maxConcurrency ?? 1,
          signal: this.signal,
          isTimeout: isProviderTimeout,
          onProgress: this.onBatchProgress,
          classifyBatch: (batch, signal) =>
            prepared
              ? prepared.classifyBatch(batch, signal)
              : provider.classify(
                  { items: batch, rules, fallbackRuleId, turboMode: this.turboMode },
                  signal,
                ),
        });
        return outcome.results;
      } finally {
        prepared?.dispose();
      }
    }
    const outcome = await runClassificationBatches(items, {
      maxBatchSize: 4,
      concurrency: Math.min(this.concurrency, provider.capabilities?.maxConcurrency ?? 8),
      signal: this.signal,
      isTimeout: isProviderTimeout,
      onProgress: this.onBatchProgress,
      classifyBatch: (batch, signal) =>
        provider.classify(
          { items: batch, rules, fallbackRuleId, turboMode: this.turboMode },
          signal,
        ),
    });
    return outcome.results;
  }

  private getLocalModel(): string {
    return this.configuredLocalModel;
  }

  private async resolveProvider(): Promise<SemanticClassifierProvider> {
    while (this.providerIndex < this.providerIds.length) {
      throwIfAborted(this.signal);
      const providerId = this.providerIds[this.providerIndex];
      if (providerId === undefined) break;
      const provider = this.providers[providerId];
      if (!provider) {
        if (!this.canTryRemote(providerId)) throw new ProviderUnavailableError(providerId);
        await this.advanceToRemote(providerId, new ProviderUnavailableError(providerId));
        continue;
      }
      const health = await provider.health(this.signal);
      this.onHealth(providerId, health);
      if (health.available) {
        this.activeProviderId = providerId;
        this.onSelected(providerId);
        return provider;
      }
      if (!this.canTryRemote(providerId))
        throw new ProviderUnavailableError(providerId, health.reason);
      await this.advanceToRemote(providerId, health.reason ?? "unavailable");
    }
    throw new ProviderUnavailableError("remote");
  }

  private canTryRemote(providerId: ClassifierProviderId): boolean {
    return (
      this.allowRemoteFallback &&
      providerId === "ollama" &&
      this.providerIds[this.providerIndex + 1] === "remote"
    );
  }

  private async advanceToRemote(
    from: ClassifierProviderId,
    reason: unknown,
  ): Promise<SemanticClassifierProvider> {
    throwIfAborted(this.signal);
    this.providerIndex++;
    const to = this.providerIds[this.providerIndex];
    if (to !== "remote") throw new ProviderUnavailableError("remote");
    this.onFallback(from, to, reason);
    return this.resolveProvider();
  }
}

function isProviderTimeout(error: unknown): boolean {
  return (
    (error instanceof OllamaProviderError && error.code === "timeout") ||
    (error instanceof RemoteProviderError && error.code === "timeout")
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

export class ProviderUnavailableError extends Error {
  constructor(providerId: ClassifierProviderId, reason?: string) {
    super(
      `${providerId === "ollama" ? "Local Ollama" : "Remote classifier"} is unavailable${reason ? ` (${reason})` : ""}.`,
    );
    this.name = "ProviderUnavailableError";
  }
}
