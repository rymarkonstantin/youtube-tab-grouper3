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
