import { parseYouTubeVideoUrl } from "../metadata/youtube-url";
import type { GroupingPlan, GroupingPlanInput, PlannedGroup } from "./types";
import { managedGroupTitle, selectReusableGroup } from "./ownership";
export function buildGroupingPlan(input: GroupingPlanInput): GroupingPlan {
  const tabs = [...input.tabs].sort((a, b) => a.index - b.index);
  const eligible = tabs.filter(
    (tab) => !tab.pinned && parseYouTubeVideoUrl(tab.url ?? "") !== null,
  );
  const anchorIndex = eligible[0]?.index ?? null;
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const identities = new Map<number, string>();
  const classificationsByTab = new Map<number, { videoId: string; ruleId: string }>();
  const enabledRuleIds = new Set(input.rules.filter(({ enabled }) => enabled).map(({ id }) => id));
  for (const classification of input.classifications) {
    const tab = tabById.get(classification.tabId);
    const parsed = parseYouTubeVideoUrl(tab?.url ?? "");
    if (
      tab &&
      tab.windowId === input.windowId &&
      !tab.pinned &&
      parsed?.videoId === classification.videoId
    )
      if (enabledRuleIds.has(classification.ruleId)) {
        identities.set(classification.tabId, classification.videoId);
        classificationsByTab.set(classification.tabId, classification);
      }
  }
  const successful = new Set(identities.keys());
  const expectedTabs = [...identities.entries()]
    .map(([tabId, videoId]) => ({ tabId, videoId }))
    .sort((a, b) => (tabById.get(a.tabId)?.index ?? 0) - (tabById.get(b.tabId)?.index ?? 0));
  const groups: PlannedGroup[] = [];
  let preceding = 0;
  for (const rule of input.rules.filter(({ enabled }) => enabled)) {
    const members = [...classificationsByTab.entries()]
      .filter(([, classification]) => classification.ruleId === rule.id)
      .map(([tabId]) => tabId)
      .sort((a, b) => (tabById.get(a)?.index ?? 0) - (tabById.get(b)?.index ?? 0));
    if (members.length === 0) continue;
    const reuseGroupId = selectReusableGroup(rule, input.groups, tabs, successful);
    groups.push({
      ruleId: rule.id,
      title: managedGroupTitle(rule.name),
      color: rule.color,
      tabIds: members,
      ...(reuseGroupId === undefined ? {} : { reuseGroupId }),
      targetIndex: (anchorIndex ?? 0) + preceding,
    });
    preceding += members.length;
  }
  return { windowId: input.windowId, anchorIndex, expectedTabs, groups };
}
