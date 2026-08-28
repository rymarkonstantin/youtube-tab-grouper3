import { describe, expect, it } from "vitest";
import { toPanelViewModel } from "../../src/sidepanel/state";
describe("toPanelViewModel", () => {
  it("offers preparation only when activation is required", () => {
    expect(
      toPanelViewModel({ kind: "needs-activation", capability: "language-model" }),
    ).toMatchObject({ prepareVisible: true, cancelVisible: false, runAgainVisible: false });
  });
  it("renders a complete count summary", () => {
    const view = toPanelViewModel({
      kind: "complete",
      summary: {
        eligible: 6,
        grouped: 5,
        cached: 2,
        uncategorized: 1,
        skipped: 3,
        failed: 1,
        appliedRuleIds: ["programming", "fishing"],
        failedRuleIds: [],
      },
    });
    expect(view.heading).toBe("Grouping complete");
    expect(view.message).toContain("5 grouped");
    expect(view.message).toContain("1 failed");
    expect(view.runAgainVisible).toBe(true);
  });
  it("renders metadata collection progress with native progress values", () => {
    const view = toPanelViewModel({
      kind: "running",
      progress: {
        phase: "metadata",
        completed: 96,
        total: 145,
        metadata: {
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
        },
      },
    });

    expect(view.heading).toBe("Grouping YouTube tabs");
    expect(view.message).toBe("Working: metadata. 96/145 complete");
    expect(view.progress).toEqual({ value: 96, max: 145 });
  });
  it("distinguishes unavailable classifier and invalid configuration", () => {
    expect(
      toPanelViewModel({ kind: "unavailable", message: "LanguageModel unavailable" }).heading,
    ).toBe("Classifier unavailable");
    expect(
      toPanelViewModel({ kind: "configuration-error", message: "Duplicate names" }).editVisible,
    ).toBe(true);
  });
});
