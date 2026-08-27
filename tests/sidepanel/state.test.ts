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
  it("distinguishes unavailable classifier and invalid configuration", () => {
    expect(
      toPanelViewModel({ kind: "unavailable", message: "LanguageModel unavailable" }).heading,
    ).toBe("Classifier unavailable");
    expect(
      toPanelViewModel({ kind: "configuration-error", message: "Duplicate names" }).editVisible,
    ).toBe(true);
  });
});
