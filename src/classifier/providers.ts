import type { ClassificationItem, ClassificationResult, GroupRule } from "../types";

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
