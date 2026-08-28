import { vi } from "vitest";
import { createDefaultRuleConfig } from "../../src/rules/defaults";
import type { ClassificationResult, VideoMetadata } from "../../src/types";
import type { GroupsPort } from "../../src/chrome/groups";
import type { TabsPort, TabMetadataResult } from "../../src/chrome/tabs";
import type { TabSnapshot } from "../../src/grouping/types";
import { parseYouTubeVideoUrl } from "../../src/metadata/youtube-url";
import type { RunDependencies, RunOptions } from "../../src/run/types";
export interface FakeRunInput {
  tabs?: TabSnapshot[];
  metadata?: VideoMetadata[];
  cacheHits?: Array<{ videoId: string; ruleId: string }>;
  classifierResults?: ClassificationResult[];
  events?: string[];
  navigateBeforeRevalidation?: boolean;
}
export function nonYouTubeTab(id: number): TabSnapshot {
  return {
    id,
    windowId: 1,
    index: id,
    url: "https://github.com/",
    title: "GitHub",
    groupId: -1,
    pinned: false,
    discarded: false,
    status: "complete",
    incognito: false,
  };
}
export function videoTab(id: number, videoId: string): TabSnapshot {
  return {
    ...nonYouTubeTab(id),
    url: `https://youtube.com/watch?v=${videoId}`,
    title: `${videoId} - YouTube`,
  };
}
export function videoMetadata(videoId: string, title: string): VideoMetadata {
  return { videoId, pageType: "watch", title };
}
export function runOptions(): RunOptions {
  return { signal: new AbortController().signal, onProgress: () => undefined };
}
export function fakeRunDependencies(input: FakeRunInput = {}): RunDependencies & {
  classifier: RunDependencies["classifier"] & { classify: ReturnType<typeof vi.fn> };
  groups: GroupsPort & { allPassedTabIds: number[] };
} {
  const tabs = input.tabs ?? [];
  const metadata = input.metadata ?? [];
  const events = input.events ?? [];
  const config = createDefaultRuleConfig();
  const classifier = vi.fn(async (items: { itemId: string }[]) => {
    events.push("classification-finished");
    return (
      input.classifierResults ??
      items.map(({ itemId }) => ({ itemId, ruleId: "uncategorized", reason: "fallback" }))
    );
  });
  const allPassedTabIds: number[] = [];
  const groups = {
    queryGroups: vi.fn(async () => []),
    getGroup: vi.fn(async () => {
      throw new Error("missing");
    }),
    groupTabs: vi.fn(async ({ tabIds }: { tabIds: number[] }) => {
      events.push("group-call");
      allPassedTabIds.push(...tabIds);
      return 1;
    }),
    updateGroup: vi.fn(async () => undefined),
    moveGroup: vi.fn(async () => undefined),
    allPassedTabIds,
  } as unknown as GroupsPort & { allPassedTabIds: number[] };
  const tabPort: TabsPort = {
    captureCurrentNormalWindow: vi.fn(async () => 1),
    queryWindowTabs: vi.fn(async () => tabs),
    collectMetadata: vi.fn(async (_tabs, options) => {
      const candidates = tabs.filter(
        (snapshot) => !snapshot.pinned && parseYouTubeVideoUrl(snapshot.url ?? "") !== null,
      );
      const results = candidates.map((snapshot): TabMetadataResult => {
        const value = metadata.find((entry) => snapshot.url?.includes(`v=${entry.videoId}`));
        return value
          ? { ok: true, tab: snapshot, metadata: value, source: "page" }
          : { ok: false, tab: snapshot, reason: "no-usable-title" };
      });
      const enriched = results.filter((result) => result.ok && result.source === "page").length;
      const titleOnly = results.filter(
        (result) => result.ok && result.source === "tab-title",
      ).length;
      const failed = results.length - enriched - titleOnly;
      options.onProgress({
        total: results.length,
        completed: results.length,
        enriched,
        titleOnly,
        failed,
        timedOut: 0,
        active: 0,
        elapsedMs: 0,
        etaMs: 0,
        budgetExhausted: false,
      });
      return results;
    }),
    getTab: vi.fn(async (id) => {
      const tab = tabs.find((value) => value.id === id);
      if (!tab) throw new Error("missing");
      return input.navigateBeforeRevalidation
        ? { ...tab, url: "https://youtube.com/watch?v=changed" }
        : tab;
    }),
  };
  const hitMap = new Map((input.cacheHits ?? []).map((hit) => [hit.videoId, hit.ruleId]));
  return {
    loadRules: vi.fn(async () => config),
    cache: {
      find: vi.fn(async ({ videoId }: { videoId: string }) => {
        const ruleId = hitMap.get(videoId);
        return ruleId ? { videoId, metadataFingerprint: "", rulesFingerprint: "", ruleId } : null;
      }),
      put: vi.fn(async () => undefined),
    },
    tabs: tabPort,
    groups,
    classifier: { classify: classifier },
  };
}
