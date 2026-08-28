import type { TabSnapshot } from "../grouping/types";
import type { VideoMetadata } from "../types";
import { normalizeVideoMetadata, type RawPageMetadata } from "./normalize";
import { parseYouTubeVideoUrl } from "./youtube-url";

export interface MetadataCollectionPolicy {
  concurrency: number;
  perTabDeadlineMs: number;
  phaseBudgetMs: number;
  heartbeatMs: number;
}

export const DEFAULT_METADATA_POLICY: Readonly<MetadataCollectionPolicy> = {
  concurrency: 8,
  perTabDeadlineMs: 3_000,
  phaseBudgetMs: 60_000,
  heartbeatMs: 5_000,
};

export type MetadataIssue =
  | "discarded"
  | "timeout"
  | "injection-error"
  | "stale-page"
  | "page-unavailable"
  | "budget-exhausted";

export type TabMetadataResult =
  | { ok: true; tab: TabSnapshot; metadata: VideoMetadata; source: "page" }
  | {
      ok: true;
      tab: TabSnapshot;
      metadata: VideoMetadata;
      source: "tab-title";
      issue: MetadataIssue;
    }
  | {
      ok: false;
      tab: TabSnapshot;
      reason: "no-usable-title";
      issue?: MetadataIssue;
    };

export interface MetadataCollectionProgress {
  total: number;
  completed: number;
  enriched: number;
  titleOnly: number;
  failed: number;
  timedOut: number;
  active: number;
  elapsedMs: number;
  etaMs: number | null;
  budgetExhausted: boolean;
}

export type MetadataLogEvent =
  | "metadata:start"
  | "metadata:waiting"
  | "metadata:budget-exhausted"
  | "metadata:cancelled"
  | "metadata:complete";

export interface MetadataPageReader {
  readPage(tab: TabSnapshot): Promise<Partial<RawPageMetadata> | undefined>;
}

export interface MetadataCollectionOptions {
  signal: AbortSignal;
  onProgress(progress: MetadataCollectionProgress): void;
  onLog?(event: MetadataLogEvent, progress: MetadataCollectionProgress): void;
  policy?: Readonly<MetadataCollectionPolicy>;
  now?: () => number;
  isCurrent?: () => boolean;
}

const baselineFor = (tab: TabSnapshot): VideoMetadata | null => {
  const identity = parseYouTubeVideoUrl(tab.url ?? "");
  return identity ? normalizeVideoMetadata(identity, undefined, tab.title) : null;
};

const isCandidate = (tab: TabSnapshot): boolean =>
  !tab.pinned && parseYouTubeVideoUrl(tab.url ?? "") !== null;

const sameMetadata = (left: VideoMetadata | null, right: VideoMetadata): boolean =>
  left !== null && JSON.stringify(left) === JSON.stringify(right);

export async function collectTabMetadata(
  tabs: readonly TabSnapshot[],
  reader: MetadataPageReader,
  options: MetadataCollectionOptions,
): Promise<TabMetadataResult[]> {
  const candidates = tabs.filter(isCandidate);
  const startedAt = (options.now ?? Date.now)();
  const progress: MetadataCollectionProgress = {
    total: candidates.length,
    completed: 0,
    enriched: 0,
    titleOnly: 0,
    failed: 0,
    timedOut: 0,
    active: 0,
    elapsedMs: 0,
    etaMs: null,
    budgetExhausted: false,
  };
  const report = (event?: MetadataLogEvent): void => {
    progress.elapsedMs = Math.max(0, (options.now ?? Date.now)() - startedAt);
    if (progress.completed > 0 && progress.completed < progress.total) {
      progress.etaMs = Math.round(
        (progress.elapsedMs / progress.completed) * (progress.total - progress.completed),
      );
    } else if (progress.completed >= progress.total) {
      progress.etaMs = 0;
    }
    options.onProgress({ ...progress });
    if (event) options.onLog?.(event, { ...progress });
  };

  report("metadata:start");
  const results: TabMetadataResult[] = new Array(candidates.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= candidates.length) return;
      const tab = candidates[index];
      if (!tab) return;
      const identity = parseYouTubeVideoUrl(tab.url ?? "");
      if (!identity) continue;
      progress.active += 1;
      let result: TabMetadataResult;
      if (tab.discarded) {
        const metadata = normalizeVideoMetadata(identity, undefined, tab.title);
        result = metadata
          ? { ok: true, tab, metadata, source: "tab-title", issue: "discarded" }
          : { ok: false, tab, reason: "no-usable-title", issue: "discarded" };
      } else {
        try {
          const raw = await reader.readPage(tab);
          const canonicalIdentity = raw?.canonicalUrl
            ? parseYouTubeVideoUrl(raw.canonicalUrl)
            : identity;
          const stale =
            canonicalIdentity !== null && canonicalIdentity.videoId !== identity.videoId;
          const metadata = normalizeVideoMetadata(identity, stale ? undefined : raw, tab.title);
          if (!metadata) {
            result = {
              ok: false,
              tab,
              reason: "no-usable-title",
              issue: stale ? "stale-page" : "page-unavailable",
            };
          } else if (stale || sameMetadata(baselineFor(tab), metadata)) {
            result = {
              ok: true,
              tab,
              metadata,
              source: "tab-title",
              issue: stale ? "stale-page" : "page-unavailable",
            };
          } else {
            result = { ok: true, tab, metadata, source: "page" };
          }
        } catch {
          const metadata = normalizeVideoMetadata(identity, undefined, tab.title);
          result = metadata
            ? { ok: true, tab, metadata, source: "tab-title", issue: "injection-error" }
            : { ok: false, tab, reason: "no-usable-title", issue: "injection-error" };
        }
      }
      results[index] = result;
      progress.active -= 1;
      progress.completed += 1;
      if (result.ok && result.source === "page") progress.enriched += 1;
      else if (result.ok) progress.titleOnly += 1;
      else progress.failed += 1;
      report();
    }
  };

  const concurrency = Math.max(
    1,
    Math.floor(options.policy?.concurrency ?? DEFAULT_METADATA_POLICY.concurrency),
  );
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  report("metadata:complete");
  return results;
}
