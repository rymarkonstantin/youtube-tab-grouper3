import { describe, expect, it } from "vitest";
import { RunDiagnostics } from "../src/diagnostics";
import type { ClassificationBatchProgress } from "../src/classifier/batching";
import type { TabMetadataResult } from "../src/metadata/collector";
import { videoMetadata, videoTab } from "./helpers/run-fixtures";

describe("RunDiagnostics", () => {
  it("records aggregate provider and phase events without browsing metadata", () => {
    let now = 1_000;
    const diagnostics = new RunDiagnostics(true, () => now);

    diagnostics.startPhase("metadata");
    now += 250;
    diagnostics.recordMetadataResult({
      ok: false,
      tab: videoTab(99, "private-video"),
      reason: "no-usable-title",
      issue: "page-unavailable",
    });
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

  it("reports aggregate metadata counters without retaining tab metadata", () => {
    const diagnostics = new RunDiagnostics(true);
    diagnostics.recordMetadataProgress({
      total: 145,
      completed: 145,
      enriched: 100,
      titleOnly: 43,
      failed: 2,
      timedOut: 7,
      active: 0,
      elapsedMs: 58_000,
      etaMs: 0,
      budgetExhausted: true,
    });
    const privateTab = videoTab(99, "private-video");
    privateTab.title = "Private fishing title - YouTube";
    diagnostics.recordMetadataResult({
      ok: true,
      tab: privateTab,
      metadata: videoMetadata("private-video", "Private fishing title"),
      source: "tab-title",
      issue: "budget-exhausted",
    });

    const report = diagnostics.toText();
    expect(report).toContain("metadata items: 145; enriched: 100; title only: 43; failed: 2");
    expect(report).toContain("metadata timeouts: 7; max active: 0; budget exhausted: yes");
    expect(report).toContain("metadata budget fallbacks: 1");
    expect(report).not.toContain("Private fishing title");
    expect(report).not.toContain("private-video");
    expect(report).not.toContain("youtube.com");
  });

  it("ignores malformed metadata issue values that contain browsing content", () => {
    const diagnostics = new RunDiagnostics(true);
    diagnostics.recordMetadataResult({
      ok: false,
      tab: videoTab(99, "private-video"),
      reason: "Private fishing title https://youtube.com/watch?v=private-video",
      issue: "Private channel https://youtube.com/watch?v=private-video",
    } as unknown as TabMetadataResult);

    const issues = (diagnostics as unknown as { metadataIssues: Map<string, number> })
      .metadataIssues;
    const report = diagnostics.toText();
    expect([...issues.keys()]).toEqual([]);
    expect(report).not.toContain("Private fishing title");
    expect(report).not.toContain("Private channel");
    expect(report).not.toContain("youtube.com");
    expect(report).not.toContain("private-video");
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

  it("reports adaptive timing and preparation counters without metadata", () => {
    const diagnostics = new RunDiagnostics(true);
    diagnostics.recordPreparation(1250);
    diagnostics.recordBatchProgress({
      startedBatchCount: 2,
      completedBatchCount: 1,
      completedItemCount: 4,
      splitCount: 0,
      recoveredItemCount: 0,
      failedItemCount: 0,
      currentBatchSize: 6,
      averageItemDurationMs: 320,
      etaMs: 2560,
    });

    const report = diagnostics.toText();
    expect(report).toContain("classification preparation: 00:01.250");
    expect(report).toContain("adaptive batch: size 6; average item: 320ms; eta: 00:02.560");
    expect(report).not.toContain("title");
    expect(report).not.toContain("url");
  });
});
