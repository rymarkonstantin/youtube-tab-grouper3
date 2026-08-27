import { vi } from "vitest";
import type { TabSnapshot, GroupingPlan } from "../../src/grouping/types";
import type { TabsPort } from "../../src/chrome/tabs";
import type { GroupsPort, GroupTabsInput } from "../../src/chrome/groups";
import type { GroupColor } from "../../src/types";
export function chromeTab(
  overrides: { id: number; windowId: number; url: string } & Partial<chrome.tabs.Tab>,
): chrome.tabs.Tab {
  const { id, windowId, url, ...rest } = overrides;
  return {
    id,
    windowId,
    index: 0,
    url,
    title: "Video - YouTube",
    pinned: false,
    discarded: false,
    status: "complete",
    incognito: false,
    groupId: -1,
    highlighted: false,
    ...rest,
  } as chrome.tabs.Tab;
}
export function fakeChromeTabs(input: {
  activeTab: chrome.tabs.Tab;
  window: Pick<chrome.windows.Window, "id" | "type" | "incognito">;
  tabs: chrome.tabs.Tab[];
}): {
  tabs: Pick<typeof chrome.tabs, "query" | "get">;
  windows: Pick<typeof chrome.windows, "get">;
  scripting: { executeScript: ReturnType<typeof vi.fn> };
} {
  const executeScript = vi.fn(async ({ target }: { target: { tabId: number } }) => [
    {
      frameId: 0,
      result: {
        canonicalUrl: input.tabs.find((tab) => tab.id === target.tabId)?.url,
        title: input.tabs.find((tab) => tab.id === target.tabId)?.title,
        description: undefined,
        channelName: undefined,
        hashtags: [],
        playlistTitle: undefined,
      },
    },
  ]);
  return {
    tabs: {
      query: vi.fn(async (query: { active?: boolean }) =>
        query.active ? [input.activeTab] : input.tabs,
      ),
      get: vi.fn(async (id: number) => {
        const tab = input.tabs.find((value) => value.id === id);
        if (!tab) throw new Error("missing");
        return tab;
      }),
    },
    windows: { get: vi.fn(async () => input.window) },
    scripting: { executeScript },
  } as unknown as {
    tabs: Pick<typeof chrome.tabs, "query" | "get">;
    windows: Pick<typeof chrome.windows, "get">;
    scripting: { executeScript: ReturnType<typeof vi.fn> };
  };
}
export function fakeTabsPort(tabs: TabSnapshot[]): TabsPort {
  return {
    captureCurrentNormalWindow: vi.fn(async () => 1),
    queryWindowTabs: vi.fn(async () => tabs),
    collectMetadata: vi.fn(),
    getTab: vi.fn(async (id) => {
      const tab = tabs.find((value) => value.id === id);
      if (!tab) throw new Error("missing");
      return tab;
    }),
  };
}
export function planForTabs(tabIds: number[], videoIds: string[]): GroupingPlan {
  if (tabIds.length !== videoIds.length) throw new Error("Mismatched plan fixtures");
  return {
    windowId: 1,
    anchorIndex: 0,
    expectedTabs: tabIds.map((tabId, index) => {
      const videoId = videoIds[index];
      if (!videoId) throw new Error("Missing video fixture");
      return { tabId, videoId };
    }),
    groups: [
      { ruleId: "programming", title: "YT · Programming", color: "green", tabIds, targetIndex: 0 },
    ],
  };
}
export function fakeGroupsPort(
  options: {
    missingGroupIds?: number[];
    failingTabIds?: number[];
    contaminatedGroupIds?: number[];
  } = {},
): GroupsPort & {
  groupCalls: GroupTabsInput[];
  updateCalls: Array<{ groupId: number; title: string; color: GroupColor }>;
  allPassedTabIds: number[];
} {
  const groupCalls: GroupTabsInput[] = [];
  const updateCalls: Array<{ groupId: number; title: string; color: GroupColor }> = [];
  const allPassedTabIds: number[] = [];
  let nextId = 50;
  return {
    groupCalls,
    updateCalls,
    allPassedTabIds,
    queryGroups: vi.fn(async () => []),
    getGroup: vi.fn(async (id: number) => {
      if (options.missingGroupIds?.includes(id)) throw new Error("missing");
      return {
        id,
        windowId: 1,
        title: "YT · Programming",
        color: "green" as const,
        collapsed: false,
        shared: false,
        tabIds: options.contaminatedGroupIds?.includes(id) ? [10, 99] : [10],
      };
    }),
    groupTabs: vi.fn(async (input: GroupTabsInput) => {
      if (input.tabIds.some((id) => options.failingTabIds?.includes(id)))
        throw new Error("failure");
      groupCalls.push(input);
      allPassedTabIds.push(...input.tabIds);
      return input.groupId ?? nextId++;
    }),
    updateGroup: vi.fn(async (groupId, input) => {
      updateCalls.push({ groupId, ...input });
    }),
    moveGroup: vi.fn(async () => undefined),
  } as unknown as GroupsPort & {
    groupCalls: GroupTabsInput[];
    updateCalls: Array<{ groupId: number; title: string; color: GroupColor }>;
    allPassedTabIds: number[];
  };
}
export function twoGroupPlan(options: { firstReuseGroupId?: number } = {}): GroupingPlan {
  return {
    windowId: 1,
    anchorIndex: 0,
    expectedTabs: [
      { tabId: 10, videoId: "a" },
      { tabId: 20, videoId: "b" },
    ],
    groups: [
      {
        ruleId: "programming",
        title: "YT · Programming",
        color: "green",
        tabIds: [10],
        ...(options.firstReuseGroupId === undefined
          ? {}
          : { reuseGroupId: options.firstReuseGroupId }),
        targetIndex: 0,
      },
      { ruleId: "fishing", title: "YT · Fishing", color: "blue", tabIds: [20], targetIndex: 1 },
    ],
  };
}
export { tab } from "./grouping-fixtures";
