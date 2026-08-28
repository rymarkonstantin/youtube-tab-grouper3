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

type AttemptResult =
  | { kind: "page"; raw: Partial<RawPageMetadata> | undefined }
  | { kind: "injection-error" }
  | { kind: "timeout" }
  | { kind: "budget-exhausted" };

const supersededError = (): DOMException =>
  new DOMException("Metadata collection superseded.", "AbortError");

const cancellationError = (): DOMException =>
  new DOMException("Metadata collection cancelled.", "AbortError");

const throwIfCancelled = (signal: AbortSignal): void => {
  if (signal.aborted) throw cancellationError();
};

const normalizeConcurrency = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(DEFAULT_METADATA_POLICY.concurrency, Math.max(1, Math.floor(value)))
    : DEFAULT_METADATA_POLICY.concurrency;

const fallbackResult = (tab: TabSnapshot, issue: MetadataIssue): TabMetadataResult => {
  const metadata = baselineFor(tab);
  return metadata
    ? { ok: true, tab, metadata, source: "tab-title", issue }
    : { ok: false, tab, reason: "no-usable-title", issue };
};

const pageResult = (
  tab: TabSnapshot,
  raw: Partial<RawPageMetadata> | undefined,
): TabMetadataResult => {
  const identity = parseYouTubeVideoUrl(tab.url ?? "");
  if (!identity) return { ok: false, tab, reason: "no-usable-title" };
  const canonicalIdentity = raw?.canonicalUrl ? parseYouTubeVideoUrl(raw.canonicalUrl) : identity;
  const stale = canonicalIdentity !== null && canonicalIdentity.videoId !== identity.videoId;
  const metadata = normalizeVideoMetadata(identity, stale ? undefined : raw, tab.title);
  if (!metadata)
    return {
      ok: false,
      tab,
      reason: "no-usable-title",
      issue: stale ? "stale-page" : "page-unavailable",
    };
  if (stale || sameMetadata(baselineFor(tab), metadata))
    return {
      ok: true,
      tab,
      metadata,
      source: "tab-title",
      issue: stale ? "stale-page" : "page-unavailable",
    };
  return { ok: true, tab, metadata, source: "page" };
};

export async function collectTabMetadata(
  tabs: readonly TabSnapshot[],
  reader: MetadataPageReader,
  options: MetadataCollectionOptions,
): Promise<TabMetadataResult[]> {
  const candidates = tabs.filter(isCandidate);
  const now = options.now ?? Date.now;
  const configuredPolicy = options.policy ?? DEFAULT_METADATA_POLICY;
  const policy: MetadataCollectionPolicy = {
    concurrency: normalizeConcurrency(configuredPolicy.concurrency),
    perTabDeadlineMs: Math.max(0, Math.floor(configuredPolicy.perTabDeadlineMs)),
    phaseBudgetMs: Math.max(0, Math.floor(configuredPolicy.phaseBudgetMs)),
    heartbeatMs: Math.max(1, Math.floor(configuredPolicy.heartbeatMs)),
  };
  const startedAt = now();
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
  const enrichmentCandidateTotal = candidates.filter((tab) => !tab.discarded).length;
  let enrichmentDurationMs = 0;
  let settledEnrichmentAttempts = 0;
  let closed = false;
  let budgetLogged = false;
  let cancelLogged = false;
  const isCurrent = (): boolean => options.isCurrent?.() !== false;
  const phaseBudgetElapsed = (): boolean => now() - startedAt >= policy.phaseBudgetMs;
  const canPublish = (): boolean => !closed && isCurrent();
  const refreshProgress = (): MetadataCollectionProgress => {
    progress.elapsedMs = Math.max(0, now() - startedAt);
    const remainingBudgetMs = Math.max(0, policy.phaseBudgetMs - progress.elapsedMs);
    if (settledEnrichmentAttempts === 0) progress.etaMs = null;
    else if (progress.completed >= progress.total) progress.etaMs = 0;
    else {
      const remaining = Math.max(0, enrichmentCandidateTotal - settledEnrichmentAttempts);
      const averageMs = enrichmentDurationMs / settledEnrichmentAttempts;
      const remainingWaves = Math.ceil(remaining / policy.concurrency);
      progress.etaMs = Math.min(
        remainingBudgetMs,
        Math.max(0, Math.round(averageMs * remainingWaves)),
      );
    }
    return { ...progress };
  };
  const publishProgress = (): void => {
    if (canPublish()) options.onProgress(refreshProgress());
  };
  const publishLog = (event: MetadataLogEvent): void => {
    if (canPublish()) options.onLog?.(event, refreshProgress());
  };
  const ensureCurrent = (): void => {
    if (!isCurrent()) throw supersededError();
  };
  const markBudgetExhausted = (): void => {
    if (progress.budgetExhausted) return;
    progress.budgetExhausted = true;
    if (!budgetLogged) {
      budgetLogged = true;
      publishLog("metadata:budget-exhausted");
    }
  };

  throwIfCancelled(options.signal);
  ensureCurrent();
  publishProgress();
  throwIfCancelled(options.signal);
  publishLog("metadata:start");
  const results: TabMetadataResult[] = new Array(candidates.length);
  let nextIndex = 0;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budgetDelayMs = Math.max(0, policy.phaseBudgetMs - Math.max(0, now() - startedAt));
  const budgetPromise = new Promise<AttemptResult>((resolve) => {
    budgetTimer = setTimeout(() => resolve({ kind: "budget-exhausted" }), budgetDelayMs);
  });
  const heartbeat = setInterval(() => publishLog("metadata:waiting"), policy.heartbeatMs);
  const clearSharedTimers = (): void => {
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
    clearInterval(heartbeat);
  };
  const onCollectionAbort = (): void => clearSharedTimers();
  options.signal.addEventListener("abort", onCollectionAbort, { once: true });

  const raceAttempt = async (tab: TabSnapshot): Promise<AttemptResult> => {
    throwIfCancelled(options.signal);
    ensureCurrent();
    if (phaseBudgetElapsed()) return { kind: "budget-exhausted" };
    let pageAttempt: Promise<AttemptResult>;
    try {
      pageAttempt = reader.readPage(tab).then<AttemptResult, AttemptResult>(
        (raw) => ({ kind: "page", raw }),
        () => ({ kind: "injection-error" }),
      );
    } catch {
      pageAttempt = Promise.resolve({ kind: "injection-error" });
    }
    throwIfCancelled(options.signal);
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<AttemptResult>((resolve) => {
      deadlineTimer = setTimeout(() => resolve({ kind: "timeout" }), policy.perTabDeadlineMs);
    });
    let cleaned = false;
    let removeAbortListener = (): void => undefined;
    const cleanupAttempt = (): void => {
      if (cleaned) return;
      cleaned = true;
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      removeAbortListener();
    };
    const abort = new Promise<never>((_resolve, reject) => {
      throwIfCancelled(options.signal);
      const onAbort = (): void => {
        cleanupAttempt();
        reject(cancellationError());
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => options.signal.removeEventListener("abort", onAbort);
    });
    try {
      return await Promise.race([pageAttempt, deadline, budgetPromise, abort]);
    } finally {
      cleanupAttempt();
    }
  };

  const publishResult = (index: number, result: TabMetadataResult): void => {
    throwIfCancelled(options.signal);
    ensureCurrent();
    if (closed) throw supersededError();
    results[index] = result;
    progress.completed += 1;
    if (result.ok && result.source === "page") progress.enriched += 1;
    else if (result.ok) progress.titleOnly += 1;
    else progress.failed += 1;
    if ("issue" in result && result.issue === "timeout") progress.timedOut += 1;
    publishProgress();
  };

  const worker = async (): Promise<void> => {
    while (true) {
      throwIfCancelled(options.signal);
      ensureCurrent();
      const index = nextIndex++;
      if (index >= candidates.length) return;
      const tab = candidates[index];
      if (!tab) return;
      const identity = parseYouTubeVideoUrl(tab.url ?? "");
      if (!identity) continue;
      if (tab.discarded) {
        publishResult(index, fallbackResult(tab, "discarded"));
        continue;
      }
      if (progress.budgetExhausted || phaseBudgetElapsed()) {
        markBudgetExhausted();
        publishResult(index, fallbackResult(tab, "budget-exhausted"));
        continue;
      }

      const attemptStartedAt = now();
      progress.active += 1;
      let attempt: AttemptResult;
      try {
        publishProgress();
        throwIfCancelled(options.signal);
        ensureCurrent();
        attempt = await raceAttempt(tab);
        throwIfCancelled(options.signal);
        ensureCurrent();
      } finally {
        progress.active -= 1;
        enrichmentDurationMs += Math.max(0, now() - attemptStartedAt);
        settledEnrichmentAttempts += 1;
      }
      ensureCurrent();
      let result: TabMetadataResult;
      if (attempt.kind === "page") result = pageResult(tab, attempt.raw);
      else if (attempt.kind === "budget-exhausted") {
        markBudgetExhausted();
        result = fallbackResult(tab, "budget-exhausted");
      } else result = fallbackResult(tab, attempt.kind);
      publishResult(index, result);
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(policy.concurrency, candidates.length) }, worker),
    );
    throwIfCancelled(options.signal);
    ensureCurrent();
    publishProgress();
    throwIfCancelled(options.signal);
    publishLog("metadata:complete");
    return results;
  } catch (error) {
    if (options.signal.aborted && !cancelLogged) {
      cancelLogged = true;
      publishLog("metadata:cancelled");
      throw cancellationError();
    }
    throw error;
  } finally {
    closed = true;
    options.signal.removeEventListener("abort", onCollectionAbort);
    clearSharedTimers();
  }
}
