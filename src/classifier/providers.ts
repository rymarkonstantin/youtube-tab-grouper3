import type { ClassificationItem, ClassificationResult, GroupRule } from "../types";
import { canFallbackToRemote, selectProviderChain, type ClassifierConfig } from "./config";

export interface ClassifierInput {
  items: ClassificationItem[];
  rules: GroupRule[];
  fallbackRuleId: string;
}

export interface ProviderHealth {
  available: boolean;
  reason?: string;
}

export type ClassifierProviderId = "ollama" | "remote";

export interface SemanticClassifierProvider {
  readonly id: ClassifierProviderId;
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
  }

  async classify(
    items: ClassificationItem[],
    rules: GroupRule[],
    fallbackRuleId: string,
  ): Promise<ClassificationResult[]> {
    throwIfAborted(this.signal);
    const provider = await this.resolveProvider();
    try {
      return await provider.classify({ items, rules, fallbackRuleId }, this.signal);
    } catch (error) {
      if (this.signal.aborted) throw abortError(this.signal);
      if (!this.canTryRemote(provider.id)) throw error;
      const next = await this.advanceToRemote(provider.id, error);
      return next.classify({ items, rules, fallbackRuleId }, this.signal);
    }
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
