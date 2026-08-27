import { expect, it } from "vitest";
import { managedGroupTitle, selectReusableGroup } from "../../src/grouping/ownership";
import { group, programmingRule, tab } from "../helpers/grouping-fixtures";

it("uses the reserved visible title", () => {
  expect(managedGroupTitle("Programming")).toBe("YT · Programming");
});
it("chooses the leftmost clean unshared exact-title group", () => {
  const groups = [
    group({ id: 8, title: "Programming", tabIds: [1] }),
    group({ id: 9, title: "YT · Programming", tabIds: [3], shared: true }),
    group({ id: 10, title: "YT · Programming", tabIds: [4, 5] }),
    group({ id: 11, title: "YT · Programming", tabIds: [2] }),
  ];
  const tabs = [tab(1, 0), tab(2, 2), tab(3, 3), tab(4, 4), tab(5, 5)];
  expect(selectReusableGroup(programmingRule, groups, tabs, new Set([2, 4, 5]))).toBe(11);
});
it("rejects a matching group containing a protected tab", () => {
  expect(
    selectReusableGroup(
      programmingRule,
      [group({ id: 10, title: "YT · Programming", tabIds: [4, 99] })],
      [tab(4, 4), tab(99, 5, { url: undefined })],
      new Set([4]),
    ),
  ).toBeUndefined();
});
