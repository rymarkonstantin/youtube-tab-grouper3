import type { GroupRule } from "../../src/types";
import type { GroupingPlanInput, TabGroupSnapshot, TabSnapshot } from "../../src/grouping/types";

export const programmingRule: GroupRule = {
  id: "programming",
  name: "Programming",
  description: "Software development.",
  color: "green",
  enabled: true,
};
const fishingRule: GroupRule = {
  id: "fishing",
  name: "Fishing",
  description: "Fishing subjects.",
  color: "blue",
  enabled: true,
};
const uncategorizedRule: GroupRule = {
  id: "uncategorized",
  name: "Uncategorized",
  description: "No suitable topic.",
  color: "grey",
  enabled: true,
};
export function tab(id: number, index: number, overrides: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    id,
    windowId: 1,
    index,
    url: `https://youtube.com/watch?v=video-${id}`,
    title: `Video ${id} - YouTube`,
    groupId: -1,
    pinned: false,
    discarded: false,
    status: "complete",
    incognito: false,
    ...overrides,
  };
}
export function group(
  input: Pick<TabGroupSnapshot, "id" | "title" | "tabIds"> & Partial<TabGroupSnapshot>,
): TabGroupSnapshot {
  const { id, title, tabIds, ...rest } = input;
  return {
    windowId: 1,
    color: "green",
    collapsed: false,
    shared: false,
    ...rest,
    id,
    title,
    tabIds,
  };
}
export function planningInput(
  overrides: Partial<GroupingPlanInput> & Pick<GroupingPlanInput, "tabs" | "classifications">,
): GroupingPlanInput {
  const { tabs, classifications, ...rest } = overrides;
  return {
    windowId: 1,
    groups: [],
    rules: [programmingRule, fishingRule, uncategorizedRule],
    ...rest,
    tabs,
    classifications,
  };
}
export function protectedPlanningInput(): GroupingPlanInput {
  return planningInput({
    tabs: [
      tab(20, 0),
      tab(21, 1, { pinned: true }),
      tab(22, 2, { url: "https://youtube.com/results?q=x" }),
      tab(23, 3),
      tab(24, 4, { windowId: 2 }),
    ],
    classifications: [
      { tabId: 20, videoId: "video-20", ruleId: "programming" },
      { tabId: 21, videoId: "video-21", ruleId: "programming" },
      { tabId: 22, videoId: "video-22", ruleId: "programming" },
      { tabId: 24, videoId: "video-24", ruleId: "programming" },
    ],
  });
}
