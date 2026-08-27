import type { ClassificationCacheRepository } from "../cache/storage";
import type { ClassificationBatchProgress } from "../classifier/batching";
import type { GroupsPort } from "../chrome/groups";
import type { TabsPort } from "../chrome/tabs";
import type { ClassifierConfig } from "../classifier/config";
import type { RunDiagnostics } from "../diagnostics";
import type { ClassificationItem, ClassificationResult, GroupRule, RuleConfig } from "../types";
export type RunPhase =
  | "checking"
  | "metadata"
  | "cache"
  | "language"
  | "classifying"
  | "planning"
  | "revalidating"
  | "applying";
export interface RunProgress {
  phase: RunPhase;
  completed: number;
  total: number;
  download?: { capability: string; loaded: number };
  classification?: ClassificationBatchProgress & { configuredConcurrency: number };
}
export interface RunSummary {
  eligible: number;
  grouped: number;
  cached: number;
  uncategorized: number;
  skipped: number;
  failed: number;
  appliedRuleIds: string[];
  failedRuleIds: string[];
}
export interface VideoClassifier {
  classify(
    items: ClassificationItem[],
    rules: GroupRule[],
    fallbackRuleId: string,
  ): Promise<ClassificationResult[]>;
}
export interface ProviderAwareVideoClassifier extends VideoClassifier {
  readonly activeProviderId?: "ollama" | "remote" | undefined;
  setBatchProgressListener?(listener: (progress: ClassificationBatchProgress) => void): void;
}
export interface RunDependencies {
  loadRules(): Promise<RuleConfig>;
  cache: Pick<ClassificationCacheRepository, "find" | "put">;
  tabs: TabsPort;
  groups: GroupsPort;
  classifier: ProviderAwareVideoClassifier;
  classifierConfig?: ClassifierConfig;
}
export interface RunOptions {
  signal: AbortSignal;
  onProgress(progress: RunProgress): void;
  diagnostics?: RunDiagnostics;
}
