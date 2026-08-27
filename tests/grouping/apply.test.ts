import { afterEach, expect, it, vi } from "vitest";
import { applyGroupingPlan } from "../../src/grouping/apply";
import { fakeGroupsPort, twoGroupPlan } from "../helpers/chrome-fixtures";
afterEach(() => vi.restoreAllMocks());
it("creates a replacement when reuse disappears and isolates a later category failure", async () => {
  const groups = fakeGroupsPort({ missingGroupIds: [40], failingTabIds: [20] });
  const report = await applyGroupingPlan(twoGroupPlan({ firstReuseGroupId: 40 }), groups);
  expect(groups.groupCalls[0]).toMatchObject({ tabIds: [10], windowId: 1 });
  expect(report.appliedRuleIds).toEqual(["programming"]);
  expect(report.failedRuleIds).toEqual(["fishing"]);
});
it("logs the failed grouping operation without exposing tab metadata", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const groups = fakeGroupsPort({ failingTabIds: [20] });

  await applyGroupingPlan(twoGroupPlan(), groups);

  expect(warn).toHaveBeenCalledWith(
    "[youtube-tab-grouper3] grouping:operation-failed",
    expect.objectContaining({
      operation: "groupTabs",
      ruleId: "fishing",
      tabCount: 1,
      errorType: "Error",
      errorMessage: "failure",
    }),
  );
});
it("reuses a surviving clean managed group", async () => {
  const groups = fakeGroupsPort();
  await applyGroupingPlan(twoGroupPlan({ firstReuseGroupId: 40 }), groups);
  expect(groups.groupCalls[0]).toEqual({ tabIds: [10], groupId: 40 });
});
it("creates a replacement when a reusable group becomes contaminated after planning", async () => {
  const groups = fakeGroupsPort({ contaminatedGroupIds: [40] });
  await applyGroupingPlan(twoGroupPlan({ firstReuseGroupId: 40 }), groups);
  expect(groups.groupCalls[0]).toEqual({ tabIds: [10], windowId: 1 });
});
