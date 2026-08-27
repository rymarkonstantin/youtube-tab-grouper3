import { describe, expect, it } from "vitest";
import { RunDiagnostics } from "../src/diagnostics";
import type { ClassificationBatchProgress } from "../src/classifier/batching";

describe("RunDiagnostics", () => {
  it("records aggregate provider and phase events without browsing metadata", () => {
    let now = 1_000;
    const diagnostics = new RunDiagnostics(true, () => now);

    diagnostics.startPhase("metadata");
    now += 250;
    diagnostics.recordMetadataResult(false, new Error("Video title: private fishing trip"));
    diagnostics.recordProviderHealth("ollama", { available: false, reason: "unavailable" });
    diagnostics.recordFallback("ollama", "remote", new Error("http://secret.example/key"));
    diagnostics.recordProviderSelected("remote");
    diagnostics.startPhase("classifying");
    now += 750;
    diagnostics.recordBatch(8);
    diagnostics.complete({
      eligible: 8,
      grouped: 7,
      cached: 1,
      uncategorized: 0,
      skipped: 2,
      failed: 1,
      appliedRuleIds: ["fishing"],
      failedRuleIds: [],
    });

    const report = diagnostics.toText();
    expect(report).toContain("metadata: 00:00.250");
    expect(report).toContain("classifying: 00:00.750");
    expect(report).toContain("ollama health: unavailable (unavailable)");
    expect(report).toContain("ollama -> remote (unexpected-error)");
    expect(report).toContain("selected provider: remote");
    expect(report).toContain("classification batches: 1; items: 8");
    expect(report).toContain("eligible: 8");
    expect(report).not.toContain("private fishing trip");
    expect(report).not.toContain("secret.example");
    expect(report).not.toContain("fishing");
  });

  it("does not retain a report while diagnostics are disabled", () => {
    const diagnostics = new RunDiagnostics(false);
    diagnostics.startPhase("metadata");
    diagnostics.recordFailure("metadata", new Error("private title"));

    expect(diagnostics.toText()).toBe("Diagnostics are disabled.");
  });

  it("reports only aggregate Turbo, concurrency, and batch recovery counters", () => {
    const diagnostics = new RunDiagnostics(true);
    const configure = (
      diagnostics as unknown as {
        configureClassification(value: {
          turboMode: boolean;
          concurrency: number;
          itemCount: number;
        }): void;
      }
    ).configureClassification;
    const recordProgress = (
      diagnostics as unknown as {
        recordBatchProgress(value: ClassificationBatchProgress): void;
      }
    ).recordBatchProgress;

    configure.call(diagnostics, { turboMode: true, concurrency: 3, itemCount: 12 });
    recordProgress.call(diagnostics, {
      startedBatchCount: 4,
      completedBatchCount: 3,
      completedItemCount: 10,
      splitCount: 1,
      recoveredItemCount: 2,
      failedItemCount: 1,
    } as ClassificationBatchProgress);

    const report = diagnostics.toText();
    expect(report).toContain("classifier settings: turbo: on; concurrency: 3");
    expect(report).toContain("classification batches: 3/4; items: 10/12");
    expect(report).toContain("splits: 1; recovered: 2; failed items: 1");
    expect(report).not.toContain("private");
    expect(report).not.toContain("reason");
  });
});
