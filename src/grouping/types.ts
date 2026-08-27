import type { GroupColor, GroupRule } from "../types";
export interface TabSnapshot {
  id: number;
  windowId: number;
  index: number;
  url: string | undefined;
  title: string | undefined;
  groupId: number;
  pinned: boolean;
  discarded: boolean;
  status: "unloaded" | "loading" | "complete" | undefined;
  incognito: boolean;
}
export interface TabGroupSnapshot {
  id: number;
  windowId: number;
  title: string | undefined;
  color: GroupColor;
  collapsed: boolean;
  shared: boolean;
  tabIds: number[];
}
export interface TabClassification {
  tabId: number;
  videoId: string;
  ruleId: string;
}
export interface GroupingPlanInput {
  windowId: number;
  tabs: TabSnapshot[];
  groups: TabGroupSnapshot[];
  rules: GroupRule[];
  classifications: TabClassification[];
}
export interface PlannedTabIdentity {
  tabId: number;
  videoId: string;
}
export interface PlannedGroup {
  ruleId: string;
  title: string;
  color: GroupColor;
  tabIds: number[];
  reuseGroupId?: number;
  targetIndex: number;
}
export interface GroupingPlan {
  windowId: number;
  anchorIndex: number | null;
  expectedTabs: PlannedTabIdentity[];
  groups: PlannedGroup[];
}
