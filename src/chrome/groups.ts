import type { GroupColor } from "../types";
import type { TabGroupSnapshot } from "../grouping/types";
export interface ChromeGroupsApi {
  tabs: Pick<typeof chrome.tabs, "query" | "group">;
  tabGroups: Pick<typeof chrome.tabGroups, "query" | "get" | "update" | "move">;
}
export interface GroupTabsInput {
  tabIds: number[];
  windowId?: number;
  groupId?: number;
}
export interface GroupsPort {
  queryGroups(windowId: number): Promise<TabGroupSnapshot[]>;
  getGroup(groupId: number): Promise<TabGroupSnapshot>;
  groupTabs(input: GroupTabsInput): Promise<number>;
  updateGroup(groupId: number, input: { title: string; color: GroupColor }): Promise<void>;
  moveGroup(groupId: number, index: number): Promise<void>;
}
export interface GroupApplicationReport {
  appliedRuleIds: string[];
  failedRuleIds: string[];
  groupedTabIds: number[];
}
export class ChromeGroupsAdapter implements GroupsPort {
  constructor(private readonly api: ChromeGroupsApi) {}
  async queryGroups(windowId: number): Promise<TabGroupSnapshot[]> {
    const groups = await this.api.tabGroups.query({ windowId });
    return Promise.all(groups.map((group) => this.getGroup(group.id)));
  }
  async getGroup(groupId: number): Promise<TabGroupSnapshot> {
    const group = await this.api.tabGroups.get(groupId);
    const tabs = await this.api.tabs.query({ groupId });
    return {
      id: group.id,
      windowId: group.windowId,
      title: group.title,
      color: group.color as GroupColor,
      collapsed: group.collapsed ?? false,
      shared: group.shared ?? false,
      tabIds: tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined),
    };
  }
  groupTabs(input: GroupTabsInput): Promise<number> {
    if (input.tabIds.length === 0)
      return Promise.reject(new Error("Cannot group an empty tab list."));
    const options =
      input.groupId === undefined
        ? { tabIds: input.tabIds as [number, ...number[]] }
        : { tabIds: input.tabIds as [number, ...number[]], groupId: input.groupId };
    return this.api.tabs.group(options);
  }
  async updateGroup(groupId: number, input: { title: string; color: GroupColor }): Promise<void> {
    await this.api.tabGroups.update(groupId, input);
  }
  async moveGroup(groupId: number, index: number): Promise<void> {
    await this.api.tabGroups.move(groupId, { index });
  }
}
