import { fingerprintClassificationRules, fingerprintMetadata } from "../cache/fingerprint";
import { createClassificationWorkItems } from "../cache/work-items";
import { selectProviderChain } from "../classifier/config";
import { applyGroupingPlan } from "../grouping/apply";
import { buildGroupingPlan } from "../grouping/plan";
import { revalidateGroupingPlan } from "../grouping/revalidate";
import type { ClassificationResult } from "../types";
import type { RunDependencies, RunOptions, RunProgress, RunSummary } from "./types";

const phase = (options: RunOptions, value: RunProgress["phase"], total: number): void => {
  options.signal.throwIfAborted();
  options.diagnostics?.startPhase(value);
  options.onProgress({ phase: value, completed: 0, total });
};
export async function runGrouping(deps: RunDependencies, options: RunOptions): Promise<RunSummary> {
  phase(options, "checking", 1);
  const rules = await deps.loadRules();
  const windowId = await deps.tabs.captureCurrentNormalWindow();
  phase(options, "metadata", 1);
  const tabs = await deps.tabs.queryWindowTabs(windowId);
  const groups = await deps.groups.queryGroups(windowId);
  const metadataResults = await deps.tabs.collectMetadata(tabs);
  const successfulMetadata = metadataResults.filter(
    (result): result is Extract<typeof result, { ok: true }> => result.ok,
  );
  for (const result of metadataResults)
    options.diagnostics?.recordMetadataResult(result.ok, result.ok ? undefined : result.error);
  let failed = metadataResults.filter((result) => !result.ok).length;
  const skipped = tabs.length - metadataResults.length;
  phase(options, "cache", successfulMetadata.length);
  const configuredProviderId = deps.classifierConfig
    ? selectProviderChain(deps.classifierConfig)[0]
    : undefined;
  const rulesFingerprint = await fingerprintClassificationRules(
    rules,
    deps.classifierConfig,
    deps.classifier.activeProviderId ?? configuredProviderId,
  );
  const classifications = new Map<number, ClassificationResult>();
  const uncached: Array<{
    tabId: number;
    metadata: Extract<(typeof successfulMetadata)[number], { ok: true }>["metadata"];
  }> = [];
  let cached = 0;
  for (const result of successfulMetadata) {
    const metadataFingerprint = await fingerprintMetadata(result.metadata);
    const hit = await deps.cache.find(
      { videoId: result.metadata.videoId, metadataFingerprint, rulesFingerprint },
      new Set(rules.rules.map(({ id }) => id)),
    );
    if (hit) {
      classifications.set(result.tab.id, {
        itemId: `cached-${result.tab.id}`,
        ruleId: hit.ruleId,
        reason: "Cached classification.",
      });
      cached++;
    } else uncached.push({ tabId: result.tab.id, metadata: result.metadata });
  }
  const work = await createClassificationWorkItems(uncached, rulesFingerprint);
  if (work.items.length > 0) {
    phase(options, "classifying", work.items.length);
    options.diagnostics?.configureClassification({
      turboMode: deps.classifierConfig?.turboMode ?? false,
      concurrency: deps.classifierConfig?.concurrency ?? 1,
      itemCount: work.items.length,
    });
    deps.classifier.setBatchProgressListener?.((batchProgress) => {
      options.diagnostics?.recordBatchProgress(batchProgress);
      options.onProgress({
        phase: "classifying",
        completed: Math.min(
          work.items.length,
          batchProgress.completedItemCount + batchProgress.failedItemCount,
        ),
        total: work.items.length,
        classification: {
          ...batchProgress,
          configuredConcurrency: deps.classifierConfig?.concurrency ?? 1,
        },
      });
    });
    let results: ClassificationResult[];
    let classificationFailed = false;
    try {
      results = await deps.classifier.classify(
        work.items.map(({ item }) => item),
        rules.rules,
        rules.fallbackRuleId,
      );
    } catch (error) {
      options.diagnostics?.recordFailure("classification", error);
      failed += work.items.reduce((total, item) => total + item.tabIds.length, 0);
      classificationFailed = true;
      results = [];
    }
    const byId = new Map(results.map((result) => [result.itemId, result]));
    const entries = [];
    const finalRulesFingerprint = await fingerprintClassificationRules(
      rules,
      deps.classifierConfig,
      deps.classifier.activeProviderId ?? configuredProviderId,
    );
    for (const item of work.items) {
      const result = byId.get(item.item.itemId);
      if (!result) {
        if (!classificationFailed) failed += item.tabIds.length;
        continue;
      }
      for (const tabId of item.tabIds) classifications.set(tabId, result);
      entries.push({
        videoId: item.item.metadata.videoId,
        metadataFingerprint: item.metadataFingerprint,
        rulesFingerprint: finalRulesFingerprint,
        ruleId: result.ruleId,
      });
    }
    if (entries.length > 0) await deps.cache.put(entries, new Set(rules.rules.map(({ id }) => id)));
  }
  phase(options, "planning", classifications.size);
  const plan = buildGroupingPlan({
    windowId,
    tabs,
    groups,
    rules: rules.rules,
    classifications: [...classifications.entries()].map(([tabId, result]) => ({
      tabId,
      videoId: successfulMetadata.find((entry) => entry.tab.id === tabId)?.metadata.videoId ?? "",
      ruleId: result.ruleId,
    })),
  });
  phase(options, "revalidating", plan.expectedTabs.length);
  const revalidated = await revalidateGroupingPlan(plan, deps.tabs);
  failed += plan.expectedTabs.length - revalidated.expectedTabs.length;
  options.signal.throwIfAborted();
  phase(options, "applying", revalidated.groups.length);
  const applied = await applyGroupingPlan(revalidated, deps.groups);
  for (const _ruleId of applied.failedRuleIds)
    options.diagnostics?.recordFailure("grouping", "request-failed");
  const uncategorized = applied.appliedRuleIds.includes(rules.fallbackRuleId)
    ? (revalidated.groups.find(({ ruleId }) => ruleId === rules.fallbackRuleId)?.tabIds.length ?? 0)
    : 0;
  const summary = {
    eligible: successfulMetadata.length,
    grouped: applied.groupedTabIds.length,
    cached,
    uncategorized,
    skipped,
    failed: failed + applied.failedRuleIds.length,
    appliedRuleIds: applied.appliedRuleIds,
    failedRuleIds: applied.failedRuleIds,
  };
  options.diagnostics?.complete(summary);
  return summary;
}
