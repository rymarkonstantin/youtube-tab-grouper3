import { expect, it } from "vitest";
import { metadataProgressView } from "../../src/sidepanel/metadata-progress";

it("renders aggregate metadata counts, active work, timeout subset, and ETA", () => {
  const text = metadataProgressView({
    total: 145,
    completed: 96,
    enriched: 72,
    titleOnly: 20,
    failed: 4,
    timedOut: 4,
    active: 8,
    elapsedMs: 31_000,
    etaMs: 16_000,
    budgetExhausted: false,
  });

  expect(text).toBe(
    "96/145 complete\nEnriched: 72 · Title only: 20 · Failed: 4\nActive: 8 · Timeouts: 4 · ETA: 00:16",
  );
});

it("explains budget fallback and unknown ETA without browsing content", () => {
  const text = metadataProgressView({
    total: 145,
    completed: 145,
    enriched: 80,
    titleOnly: 63,
    failed: 2,
    timedOut: 8,
    active: 0,
    elapsedMs: 60_000,
    etaMs: null,
    budgetExhausted: true,
  });

  expect(text).toContain("Metadata budget reached; saved-title fallback applied.");
  expect(text).toContain("ETA: unknown");
  expect(text).not.toContain("youtube.com");
});
