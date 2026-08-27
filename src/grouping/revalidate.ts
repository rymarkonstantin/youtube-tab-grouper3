import { parseYouTubeVideoUrl } from "../metadata/youtube-url";
import type { TabsPort } from "../chrome/tabs";
import type { GroupingPlan } from "./types";
export async function revalidateGroupingPlan(
  plan: GroupingPlan,
  tabs: TabsPort,
): Promise<GroupingPlan> {
  const checks = await Promise.allSettled(plan.expectedTabs.map(({ tabId }) => tabs.getTab(tabId)));
  const current = new Map<number, string>();
  checks.forEach((result, index) => {
    const expected = plan.expectedTabs[index];
    if (result.status === "fulfilled" && expected) {
      const parsed = parseYouTubeVideoUrl(result.value.url ?? "");
      if (
        result.value.windowId === plan.windowId &&
        !result.value.pinned &&
        parsed?.videoId === expected.videoId
      )
        current.set(expected.tabId, expected.videoId);
    }
  });
  const expectedTabs = plan.expectedTabs.filter(({ tabId }) => current.has(tabId));
  const groups = plan.groups
    .map((group) => ({ ...group, tabIds: group.tabIds.filter((tabId) => current.has(tabId)) }))
    .filter(({ tabIds }) => tabIds.length > 0);
  let preceding = 0;
  const recalculated = groups.map((group) => {
    const next = { ...group, targetIndex: (plan.anchorIndex ?? 0) + preceding };
    preceding += group.tabIds.length;
    return next;
  });
  return { ...plan, expectedTabs, groups: recalculated };
}
