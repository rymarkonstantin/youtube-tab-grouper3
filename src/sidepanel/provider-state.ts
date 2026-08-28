import type { ClassifierProviderId } from "../classifier/providers";

export interface ProviderStatusView {
  tone: "neutral" | "warning";
  message: string;
}

export type ProviderStatus =
  | { kind: "idle" }
  | { kind: "selected"; providerId: ClassifierProviderId; model: string }
  | { kind: "fallback"; from: "ollama"; to: "remote" }
  | { kind: "ollama-unavailable"; model: string }
  | { kind: "remote-unavailable" };

export interface ClassificationProgressViewInput {
  configuredConcurrency: number;
  startedBatchCount: number;
  completedBatchCount: number;
  completedItemCount: number;
  splitCount: number;
  recoveredItemCount: number;
  failedItemCount: number;
  currentBatchSize?: number;
  averageItemDurationMs?: number;
  etaMs?: number | null;
}

function formatDuration(milliseconds: number): string {
  const bounded = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(bounded / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1_000);
  const remainder = bounded % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

/** Formats scheduler counters only; no content from a tab or provider response is accepted. */
export function classificationProgressView(value: ClassificationProgressViewInput): string {
  const adaptive =
    value.currentBatchSize === undefined
      ? ""
      : ` batch size ${value.currentBatchSize}; average item ${Math.max(0, Math.floor(value.averageItemDurationMs ?? 0))}ms; ETA ${value.etaMs === null || value.etaMs === undefined ? "unknown" : formatDuration(value.etaMs)}`;
  return `Batches ${value.completedBatchCount}/${value.startedBatchCount}; items ${value.completedItemCount}; concurrency ${value.configuredConcurrency}; splits ${value.splitCount}; recovered ${value.recoveredItemCount}; failed items ${value.failedItemCount}.${adaptive}`;
}

/** Produces status text that does not expose endpoints, credentials, or raw provider errors. */
export function providerStatusView(status: ProviderStatus): ProviderStatusView {
  switch (status.kind) {
    case "idle":
      return { tone: "neutral", message: "Selecting a semantic classifier…" };
    case "selected":
      return {
        tone: "neutral",
        message:
          status.providerId === "ollama"
            ? `Using local Ollama model ${status.model}.`
            : `Using configured remote model ${status.model}.`,
      };
    case "fallback":
      return {
        tone: "warning",
        message: "Local Ollama is unavailable; trying the configured remote fallback.",
      };
    case "ollama-unavailable":
      return {
        tone: "warning",
        message: `Ollama is unavailable. Start Ollama, then run: ollama pull ${status.model}`,
      };
    case "remote-unavailable":
      return {
        tone: "warning",
        message: "The configured remote classifier is unavailable. No tabs were changed.",
      };
  }
}

export function diagnosticsCopyView(
  diagnosticsEnabled: boolean,
  hasDiagnostics: boolean,
): { visible: boolean; enabled: boolean } {
  return { visible: diagnosticsEnabled, enabled: diagnosticsEnabled && hasDiagnostics };
}
