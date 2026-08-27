import { expect, it } from "vitest";
import { revalidateGroupingPlan } from "../../src/grouping/revalidate";
import { fakeTabsPort, planForTabs, tab } from "../helpers/chrome-fixtures";
it("removes closed, moved, navigated, and newly pinned targets", async () => {
  const tabs = fakeTabsPort([
    tab(1, 1, { url: "https://youtube.com/watch?v=a" }),
    tab(2, 2, { windowId: 2, url: "https://youtube.com/watch?v=b" }),
    tab(3, 1, { url: "https://youtube.com/watch?v=changed" }),
    tab(4, 1, { url: "https://youtube.com/watch?v=d", pinned: true }),
  ]);
  const plan = await revalidateGroupingPlan(planForTabs([1, 2, 3, 4], ["a", "b", "c", "d"]), tabs);
  expect(plan.groups[0]?.tabIds).toEqual([1]);
});
