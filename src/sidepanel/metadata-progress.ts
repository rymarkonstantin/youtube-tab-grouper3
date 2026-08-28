import type { MetadataCollectionProgress } from "../metadata/collector";
import { formatElapsed } from "./timers";

export function metadataProgressView(progress: MetadataCollectionProgress): string {
  const eta = progress.etaMs === null ? "unknown" : formatElapsed(progress.etaMs);
  const lines = [
    `${progress.completed}/${progress.total} complete`,
    `Enriched: ${progress.enriched} · Title only: ${progress.titleOnly} · Failed: ${progress.failed}`,
    `Active: ${progress.active} · Timeouts: ${progress.timedOut} · ETA: ${eta}`,
  ];
  if (progress.budgetExhausted)
    lines.push("Metadata budget reached; saved-title fallback applied.");
  return lines.join("\n");
}
