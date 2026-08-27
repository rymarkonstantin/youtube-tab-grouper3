import { expect, it } from "vitest";
import { buildGroupingPlan } from "../../src/grouping/plan";
import { planningInput, protectedPlanningInput, tab } from "../helpers/grouping-fixtures";

it("orders groups by rules and tabs by original index at the first youtube anchor", () => {
  const input = planningInput({
    tabs: [
      tab(1, 0, { url: "https://github.com/" }),
      tab(2, 1, { url: "https://youtube.com/watch?v=fish" }),
      tab(3, 2, { url: "https://example.com/" }),
      tab(4, 3, { url: "https://youtube.com/watch?v=code" }),
      tab(5, 4, { url: "https://youtube.com/watch?v=fish2" }),
    ],
    classifications: [
      { tabId: 2, videoId: "fish", ruleId: "fishing" },
      { tabId: 4, videoId: "code", ruleId: "programming" },
      { tabId: 5, videoId: "fish2", ruleId: "fishing" },
    ],
  });
  const plan = buildGroupingPlan(input);
  expect(plan.anchorIndex).toBe(1);
  expect(plan.groups.map(({ ruleId }) => ruleId)).toEqual(["programming", "fishing"]);
  expect(plan.groups.map(({ tabIds }) => tabIds)).toEqual([[4], [2, 5]]);
  expect(plan.groups.map(({ targetIndex }) => targetIndex)).toEqual([1, 2]);
  expect(buildGroupingPlan(input)).toEqual(plan);
});
it("excludes pinned, failed, unsupported, and cross-window tabs", () => {
  expect(
    buildGroupingPlan(protectedPlanningInput()).groups.flatMap(({ tabIds }) => tabIds),
  ).toEqual([20]);
});
it("returns an empty plan when there are no video tabs", () => {
  expect(buildGroupingPlan(planningInput({ tabs: [], classifications: [] }))).toEqual({
    windowId: 1,
    anchorIndex: null,
    expectedTabs: [],
    groups: [],
  });
});
it("anchors one successful tab at the first eligible tab even when that first tab failed", () => {
  const plan = buildGroupingPlan(
    planningInput({
      tabs: [
        tab(10, 1, { url: "https://youtube.com/watch?v=failed" }),
        tab(20, 4, { url: "https://youtube.com/watch?v=code" }),
      ],
      classifications: [{ tabId: 20, videoId: "code", ruleId: "programming" }],
    }),
  );
  expect(plan.anchorIndex).toBe(1);
  expect(plan.groups[0]?.tabIds).toEqual([20]);
});
