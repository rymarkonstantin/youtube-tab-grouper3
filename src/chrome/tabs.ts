import { extractYouTubePageMetadata } from "../metadata/page-extractor";
import { normalizeVideoMetadata } from "../metadata/normalize";
import { parseYouTubeVideoUrl } from "../metadata/youtube-url";
import type { VideoMetadata } from "../types";
import type { TabSnapshot } from "../grouping/types";

export type TabMetadataResult =
  | { ok: true; tab: TabSnapshot; metadata: VideoMetadata }
  | { ok: false; tab: TabSnapshot; error: string };
export interface ChromeTabsApi {
  tabs: Pick<typeof chrome.tabs, "query" | "get">;
  windows: Pick<typeof chrome.windows, "get">;
  scripting: Pick<typeof chrome.scripting, "executeScript">;
}
export interface TabsPort {
  captureCurrentNormalWindow(): Promise<number>;
  queryWindowTabs(windowId: number): Promise<TabSnapshot[]>;
  collectMetadata(tabs: TabSnapshot[]): Promise<TabMetadataResult[]>;
  getTab(tabId: number): Promise<TabSnapshot>;
}
const METADATA_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  values: T[],
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function consume(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await worker(values[index] as T);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(METADATA_CONCURRENCY, values.length) }, () => consume()),
  );
  return results;
}
export class ChromeTabsAdapter implements TabsPort {
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
  async collectMetadata(tabs: TabSnapshot[]): Promise<TabMetadataResult[]> {
    const eligible = tabs.filter(
      (tab) => !tab.pinned && !tab.discarded && parseYouTubeVideoUrl(tab.url ?? ""),
    );
    const results = await mapWithConcurrency(eligible, async (tab): Promise<TabMetadataResult> => {
      const identity = parseYouTubeVideoUrl(tab.url ?? "");
      if (!identity) return { ok: false, tab, error: "Unsupported YouTube page." };
      try {
        const [frame] = await this.api.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractYouTubePageMetadata,
        });
        const metadata = normalizeVideoMetadata(identity, frame?.result, tab.title);
        return metadata
          ? { ok: true, tab, metadata }
          : { ok: false, tab, error: "No usable video title." };
      } catch (error) {
        const fallback = normalizeVideoMetadata(identity, undefined, tab.title);
        if (fallback) return { ok: true, tab, metadata: fallback };
        return {
          ok: false,
          tab,
          error: error instanceof Error ? error.message : "Metadata unavailable.",
        };
      }
    });
    return results;
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
