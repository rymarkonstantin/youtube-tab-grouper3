import type { GroupsPort, GroupTabsInput } from "../chrome/groups";
import type { GroupApplicationReport } from "../chrome/groups";
import type { GroupingPlan } from "./types";
export type { GroupApplicationReport } from "../chrome/groups";
export async function applyGroupingPlan(
  plan: GroupingPlan,
  groups: GroupsPort,
): Promise<GroupApplicationReport> {
  const report: GroupApplicationReport = {
    appliedRuleIds: [],
    failedRuleIds: [],
    groupedTabIds: [],
  };
  for (const group of plan.groups) {
    let groupId: number | undefined = group.reuseGroupId;
    let operation = "groupTabs";
    try {
      if (groupId !== undefined) {
        try {
          const current = await groups.getGroup(groupId);
          if (
            current.windowId !== plan.windowId ||
            current.title !== group.title ||
            current.shared ||
            current.tabIds.some((id) => !group.tabIds.includes(id))
          )
            groupId = undefined;
        } catch {
          groupId = undefined;
        }
      }
      const input: GroupTabsInput =
        groupId === undefined
          ? { tabIds: group.tabIds, windowId: plan.windowId }
          : { tabIds: group.tabIds, groupId };
      operation = "groupTabs";
      groupId = await groups.groupTabs(input);
      operation = "updateGroup";
      await groups.updateGroup(groupId, { title: group.title, color: group.color });
      operation = "moveGroup";
      await groups.moveGroup(groupId, group.targetIndex);
      report.appliedRuleIds.push(group.ruleId);
      report.groupedTabIds.push(...group.tabIds);
    } catch (error) {
      console.warn("[youtube-tab-grouper3] grouping:operation-failed", {
        operation,
        ruleId: group.ruleId,
        tabCount: group.tabIds.length,
        errorType: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : undefined,
      });
      report.failedRuleIds.push(group.ruleId);
    }
  }
  report.groupedTabIds = [...new Set(report.groupedTabIds)];
  return report;
}
