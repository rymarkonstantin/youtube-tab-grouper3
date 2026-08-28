import type { ClassifierProviderId, ProviderHealth } from "./classifier/providers";
import type { ClassificationBatchProgress } from "./classifier/batching";
import type { RunSummary } from "./run/types";

type FailureArea = "metadata" | "classification" | "grouping";

const SAFE_REASONS = new Set([
  "unavailable",
  "timeout",
  "model-missing",
  "malformed-response",
  "request-failed",
  "not-configured",
  "aborted",
]);

function formatDuration(milliseconds: number): string {
  const bounded = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(bounded / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1_000);
  const remainder = bounded % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

function formatDiagnosticDuration(milliseconds: number): string {
  return formatDuration(milliseconds);
}

export function redactDiagnosticReason(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    SAFE_REASONS.has(value.code)
  )
    return value.code;
  if (typeof value === "string" && SAFE_REASONS.has(value)) return value;
  return "unexpected-error";
}

/** Keeps opt-in, aggregate-only run information in memory for support diagnostics. */
export class RunDiagnostics {
  private readonly phaseDurations = new Map<string, number>();
  private readonly providerHealth = new Map<ClassifierProviderId, ProviderHealth>();
  private readonly fallbacks: Array<{
    from: ClassifierProviderId;
    to: ClassifierProviderId;
    reason: string;
  }> = [];
  private readonly failures = new Map<string, number>();
  private startedAt: number | undefined;
  private phase: string | undefined;
  private phaseStartedAt: number | undefined;
  private classificationBatches = 0;
  private classificationItems = 0;
  private configuredConcurrency: number | undefined;
  private turboMode: boolean | undefined;
  private classificationItemCount = 0;
  private batchProgress: ClassificationBatchProgress | undefined;
  private selectedProviderId: ClassifierProviderId | undefined;
  private preparationDurationMs: number | undefined;
  private summary: RunSummary | undefined;

  constructor(
    private readonly enabled: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  startPhase(phase: string): void {
    if (!this.enabled) return;
    const current = this.now();
    if (this.startedAt === undefined) this.startedAt = current;
    this.finishCurrentPhase(current);
    this.phase = phase;
    this.phaseStartedAt = current;
  }

  recordMetadataResult(ok: boolean, error?: unknown): void {
    if (!this.enabled || ok) return;
    this.recordFailure("metadata", error);
  }

  recordProviderHealth(providerId: ClassifierProviderId, health: ProviderHealth): void {
    if (this.enabled) this.providerHealth.set(providerId, { ...health });
  }

  recordFallback(from: ClassifierProviderId, to: ClassifierProviderId, reason: unknown): void {
    if (this.enabled) this.fallbacks.push({ from, to, reason: redactDiagnosticReason(reason) });
  }

  recordProviderSelected(providerId: ClassifierProviderId): void {
    if (this.enabled) this.selectedProviderId = providerId;
  }

  recordBatch(itemCount: number): void {
    if (!this.enabled) return;
    this.classificationBatches++;
    this.classificationItems += itemCount;
  }

  /** Records aggregate classifier configuration only; this API never accepts video metadata. */
  configureClassification(value: {
    turboMode: boolean;
    concurrency: number;
    itemCount: number;
  }): void {
    if (!this.enabled) return;
    this.turboMode = value.turboMode;
    this.configuredConcurrency = value.concurrency;
    this.classificationItemCount = value.itemCount;
  }

  /** Records scheduler counters only; reasons and classification content are deliberately excluded. */
  recordBatchProgress(progress: ClassificationBatchProgress): void {
    if (!this.enabled) return;
    this.batchProgress = { ...progress };
  }

  /** Records preparation timing only; prompts and metadata never enter diagnostics. */
  recordPreparation(milliseconds: number): void {
    if (this.enabled) this.preparationDurationMs = Math.max(0, Math.floor(milliseconds));
  }

  recordFailure(area: FailureArea, reason: unknown): void {
    if (!this.enabled) return;
    const key = `${area}:${redactDiagnosticReason(reason)}`;
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
  }

  complete(summary: RunSummary): void {
    if (!this.enabled) return;
    this.finishCurrentPhase(this.now());
    this.summary = structuredClone(summary);
  }

  toText(): string {
    if (!this.enabled) return "Diagnostics are disabled.";
    const lines = ["YouTube Tab Grouper diagnostics"];
    for (const [phase, duration] of this.phaseDurations)
      lines.push(`${phase}: ${formatDuration(duration)}`);
    for (const [providerId, health] of this.providerHealth)
      lines.push(
        `${providerId} health: ${health.available ? "available" : "unavailable"}${health.reason ? ` (${redactDiagnosticReason(health.reason)})` : ""}`,
      );
    for (const fallback of this.fallbacks)
      lines.push(`${fallback.from} -> ${fallback.to} (${fallback.reason})`);
    if (this.selectedProviderId) lines.push(`selected provider: ${this.selectedProviderId}`);
    if (this.turboMode !== undefined && this.configuredConcurrency !== undefined)
      lines.push(
        `classifier settings: turbo: ${this.turboMode ? "on" : "off"}; concurrency: ${this.configuredConcurrency}`,
      );
    if (this.batchProgress) {
      lines.push(
        `classification batches: ${this.batchProgress.completedBatchCount}/${this.batchProgress.startedBatchCount}; items: ${this.batchProgress.completedItemCount}/${this.classificationItemCount}`,
      );
      lines.push(
        `splits: ${this.batchProgress.splitCount}; recovered: ${this.batchProgress.recoveredItemCount}; failed items: ${this.batchProgress.failedItemCount}`,
      );
      if (this.preparationDurationMs !== undefined)
        lines.push(
          `classification preparation: ${formatDiagnosticDuration(this.preparationDurationMs)}`,
        );
      if (this.batchProgress.currentBatchSize !== undefined) {
        const average = Math.max(0, Math.floor(this.batchProgress.averageItemDurationMs ?? 0));
        const eta =
          this.batchProgress.etaMs === null || this.batchProgress.etaMs === undefined
            ? "unknown"
            : formatDiagnosticDuration(this.batchProgress.etaMs);
        lines.push(
          `adaptive batch: size ${this.batchProgress.currentBatchSize}; average item: ${average}ms; eta: ${eta}`,
        );
      }
    } else if (this.classificationBatches > 0)
      lines.push(
        `classification batches: ${this.classificationBatches}; items: ${this.classificationItems}`,
      );
    for (const [failure, count] of this.failures) lines.push(`${failure}: ${count}`);
    if (this.summary) {
      lines.push(
        `eligible: ${this.summary.eligible}; grouped: ${this.summary.grouped}; cached: ${this.summary.cached}; uncategorized: ${this.summary.uncategorized}; skipped: ${this.summary.skipped}; failed: ${this.summary.failed}`,
      );
    }
    return lines.join("\n");
  }

  private finishCurrentPhase(current: number): void {
    if (this.phase === undefined || this.phaseStartedAt === undefined) return;
    this.phaseDurations.set(
      this.phase,
      (this.phaseDurations.get(this.phase) ?? 0) + current - this.phaseStartedAt,
    );
  }
}
