import type { GroupRule } from "../types";
import type { TabGroupSnapshot, TabSnapshot } from "./types";
export const managedGroupTitle = (ruleName: string): string => `YT · ${ruleName}`;
export function selectReusableGroup(
  rule: GroupRule,
  groups: TabGroupSnapshot[],
  tabs: TabSnapshot[],
  successfulTabIds: Set<number>,
): number | undefined {
  const indices = new Map(tabs.map((tab) => [tab.id, tab.index]));
  return groups
    .filter(
      (group) =>
        group.title === managedGroupTitle(rule.name) &&
        !group.shared &&
        group.tabIds.length > 0 &&
        group.tabIds.every((id) => successfulTabIds.has(id) && indices.has(id)),
    )
    .sort(
      (a, b) =>
        Math.min(...a.tabIds.map((id) => indices.get(id) ?? Number.MAX_SAFE_INTEGER)) -
          Math.min(...b.tabIds.map((id) => indices.get(id) ?? Number.MAX_SAFE_INTEGER)) ||
        a.id - b.id,
    )[0]?.id;
}
