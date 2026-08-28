import {
  collectTabMetadata,
  type MetadataCollectionProgress,
  type TabMetadataResult,
} from "../metadata/collector";
import { extractYouTubePageMetadata } from "../metadata/page-extractor";
import type { TabSnapshot } from "../grouping/types";

export type { MetadataCollectionProgress, TabMetadataResult } from "../metadata/collector";

export interface ChromeTabsApi {
  tabs: Pick<typeof chrome.tabs, "query" | "get">;
  windows: Pick<typeof chrome.windows, "get">;
  scripting: Pick<typeof chrome.scripting, "executeScript">;
}
export interface TabsMetadataOptions {
  signal: AbortSignal;
  onProgress(progress: MetadataCollectionProgress): void;
}
export interface TabsPort {
  captureCurrentNormalWindow(): Promise<number>;
  queryWindowTabs(windowId: number): Promise<TabSnapshot[]>;
  collectMetadata(tabs: TabSnapshot[], options: TabsMetadataOptions): Promise<TabMetadataResult[]>;
  getTab(tabId: number): Promise<TabSnapshot>;
}
export class ChromeTabsAdapter implements TabsPort {
  private metadataGeneration = 0;
  private metadataLifecycle: AbortController | undefined;

  constructor(private readonly api: ChromeTabsApi) {}
  async captureCurrentNormalWindow(): Promise<number> {
    const [active] = await this.api.tabs.query({ active: true, lastFocusedWindow: true });
    if (!active?.windowId) throw new Error("No focused Chrome window.");
    const window = await this.api.windows.get(active.windowId);
    if (window.type !== "normal" || window.incognito)
      throw new Error("The focused window is not a normal window.");
    return active.windowId;
  }
  async queryWindowTabs(windowId: number): Promise<TabSnapshot[]> {
    const tabs = await this.api.tabs.query({ windowId });
    return tabs.map((tab) => ({
      id: tab.id ?? -1,
      windowId: tab.windowId,
      index: tab.index,
      url: tab.url,
      title: tab.title,
      groupId: tab.groupId ?? -1,
      pinned: tab.pinned ?? false,
      discarded: tab.discarded ?? false,
      status: tab.status,
      incognito: tab.incognito ?? false,
    }));
  }
  async collectMetadata(
    tabs: TabSnapshot[],
    options: TabsMetadataOptions,
  ): Promise<TabMetadataResult[]> {
    const generation = ++this.metadataGeneration;
    this.metadataLifecycle?.abort();
    const lifecycle = new AbortController();
    this.metadataLifecycle = lifecycle;
    const cancelLifecycle = (): void => lifecycle.abort();
    if (options.signal.aborted) cancelLifecycle();
    else options.signal.addEventListener("abort", cancelLifecycle, { once: true });
    try {
      return await collectTabMetadata(
        tabs,
        {
          readPage: async (tab) => {
            const [frame] = await this.api.scripting.executeScript({
              target: { tabId: tab.id },
              func: extractYouTubePageMetadata,
              injectImmediately: true,
            });
            return frame?.result;
          },
        },
        {
          signal: lifecycle.signal,
          onProgress: options.onProgress,
          isCurrent: () => this.metadataGeneration === generation,
          onLog: (event, progress) => {
            const message = `[youtube-tab-grouper3] ${event}`;
            if (event === "metadata:waiting") console.debug(message, progress);
            else console.info(message, progress);
          },
        },
      );
    } finally {
      options.signal.removeEventListener("abort", cancelLifecycle);
      if (this.metadataLifecycle === lifecycle) this.metadataLifecycle = undefined;
    }
  }
  async getTab(tabId: number): Promise<TabSnapshot> {
    const tab = await this.api.tabs.get(tabId);
    return {
      id: tab.id ?? tabId,
      windowId: tab.windowId,
      index: tab.index,
      url: tab.url,
      title: tab.title,
      groupId: tab.groupId ?? -1,
      pinned: tab.pinned ?? false,
      discarded: tab.discarded ?? false,
      status: tab.status,
      incognito: tab.incognito ?? false,
    };
  }
}
