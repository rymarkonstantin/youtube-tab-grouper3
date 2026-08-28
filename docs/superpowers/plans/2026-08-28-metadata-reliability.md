# Metadata Collection Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make metadata collection for large YouTube-tab windows finish predictably with immediate
title baselines, bounded page enrichment, useful progress, and sanitized diagnostics.

**Architecture:** Add a metadata-specific collector between the Chrome tabs adapter and existing
normalization functions. The collector preserves tab order, enriches up to eight non-discarded tabs
at a time with `injectImmediately`, resolves each attempt after three seconds, and resolves the
complete phase after 60 seconds; the coordinator forwards aggregate progress to diagnostics and the
side panel while retaining the existing no-mutation-before-classification boundary.

**Tech Stack:** Strict TypeScript, Chrome Manifest V3 `chrome.scripting`, plain HTML/CSS, Vitest fake
timers, Biome, esbuild.

**Spec:** `docs/superpowers/specs/2026-08-28-metadata-reliability-design.md`

## Global Constraints

- Work only on `bundle/14-metadata-reliability`, created from merged and validated release `0.3.0`.
- Deliver exactly one Bundle 14 pull request into `main`; do not start another bundle before it is
  merged and post-merge validation passes.
- Process supported unpinned YouTube video tabs only in the captured current normal Chrome window.
- Keep discarded tabs discarded; use their saved titles without injecting or waking them.
- Use logical enrichment concurrency `8`, per-tab soft deadline `3_000` ms, and global metadata
  budget `60_000` ms. These are not user settings.
- Use `injectImmediately: true` for every non-discarded metadata injection.
- Cancellation rejects the metadata phase and produces no classification, cache write, or native
  group mutation from the cancelled run.
- A budget or per-tab timeout may use a real normalized tab-title baseline; it must not invent
  metadata or fabricate a semantic fallback.
- Never log titles, descriptions, channels, hashtags, playlist names, URLs, video IDs, tab IDs,
  prompts, responses, credentials, or raw exception messages.
- Add no dependency, Chrome permission, host permission, telemetry, or persistent storage field.
- Keep `package.json`, `package-lock.json`, and `static/manifest.json` at `0.3.0`; a packaged `0.3.1`
  PATCH is separate release work after manual acceptance.
- Use red-green-refactor for every production behavior and keep each task in a focused Conventional
  Commit.

## File structure

| Path | Responsibility |
|---|---|
| `src/metadata/collector.ts` | Metadata candidates, baseline/page outcomes, bounded worker scheduling, deadlines, cancellation, progress, and safe log events. |
| `src/chrome/tabs.ts` | Current-window tab snapshots and the narrow `executeScript` adapter using `injectImmediately`. |
| `src/run/types.ts` | Run-level metadata progress contract. |
| `src/run/coordinator.ts` | Connect metadata progress/results to diagnostics, summary accounting, cache/classification, and the existing mutation boundary. |
| `src/diagnostics.ts` | Aggregate metadata counters and phase timing only. |
| `src/sidepanel/metadata-progress.ts` | Pure formatting of aggregate metadata progress. |
| `src/sidepanel/state.ts` | Running-state summary copy and progress-bar values. |
| `src/sidepanel/main.ts` | Render the metadata detail element. |
| `static/sidepanel.html` | Accessible metadata-progress status element. |
| `src/sidepanel/styles.css` | Preserve line breaks in aggregate progress text. |
| `tests/metadata/collector.test.ts` | Baseline, ordering, timeout, budget, cancellation, late-result, concurrency, and 145-tab simulations. |
| `tests/chrome/tabs.test.ts` | Chrome adapter injection shape and protected-tab behavior. |
| `tests/run/coordinator.test.ts` | Progress forwarding, summary counts, and no-mutation-before-classification behavior. |
| `tests/diagnostics.test.ts` | Aggregate metadata report and redaction. |
| `tests/sidepanel/metadata-progress.test.ts` | Exact metadata progress copy. |
| `tests/sidepanel/state.test.ts` | Running-state message and progress bar. |
| `tests/docs/metadata-reliability.test.ts` | README/AGENTS workflow and behavior assertions. |
| `README.md` | Shipped metadata timing, fallback, diagnostics, and manual Chrome guidance. |
| `AGENTS.md` | Current Ollama architecture, focused-spec precedence, and general sequential-bundle policy. |
| `docs/superpowers/handoffs/2026-08-28-metadata-reliability-pr.md` | Stable Markdown PR description used with `gh --body-file`. |

---

### Task 1: Metadata candidates, outcomes, and title baselines

**Files:**
- Create: `src/metadata/collector.ts`
- Test: `tests/metadata/collector.test.ts`

**Interfaces:**
- Consumes: `TabSnapshot`, `RawPageMetadata`, `VideoMetadata`, `parseYouTubeVideoUrl()`, and
  `normalizeVideoMetadata()`.
- Produces: `MetadataIssue`, `TabMetadataResult`, `MetadataCollectionProgress`,
  `MetadataCollectionPolicy`, `DEFAULT_METADATA_POLICY`, `MetadataPageReader`,
  `MetadataCollectionOptions`, and
  `collectTabMetadata(tabs, reader, options): Promise<TabMetadataResult[]>`.
- Guarantees: one ordered result per supported unpinned video candidate; discarded candidates use
  title-only metadata and never call the reader.

- [ ] **Step 1: Write failing candidate and baseline tests**

Create `tests/metadata/collector.test.ts` with these initial cases:

```ts
import { describe, expect, it, vi } from "vitest";
import { collectTabMetadata } from "../../src/metadata/collector";
import { tab } from "../helpers/grouping-fixtures";

const options = () => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

describe("collectTabMetadata", () => {
  it("returns candidates in snapshot order and excludes pinned or unsupported tabs", async () => {
    const tabs = [
      tab(1, 1, { url: "https://youtube.com/watch?v=first", title: "First - YouTube" }),
      tab(2, 1, { url: "https://github.com/", title: "GitHub" }),
      tab(3, 1, {
        url: "https://youtube.com/watch?v=pinned",
        title: "Pinned - YouTube",
        pinned: true,
      }),
      tab(4, 1, { url: "https://youtube.com/shorts/second", title: "Second - YouTube" }),
    ];
    const reader = {
      readPage: vi.fn(async (snapshot: (typeof tabs)[number]) => ({
        canonicalUrl: snapshot.url,
        title: snapshot.title,
        description: undefined,
        channelName: undefined,
        hashtags: [],
        playlistTitle: undefined,
      })),
    };

    const results = await collectTabMetadata(tabs, reader, options());

    expect(results.map(({ tab: snapshot }) => snapshot.id)).toEqual([1, 4]);
    expect(reader.readPage).toHaveBeenCalledTimes(2);
  });

  it("uses a discarded tab title without reading or waking the page", async () => {
    const snapshot = tab(5, 1, {
      url: "https://youtube.com/watch?v=discarded",
      title: "Saved fishing title - YouTube",
      discarded: true,
    });
    const reader = { readPage: vi.fn() };

    const [result] = await collectTabMetadata([snapshot], reader, options());

    expect(result).toMatchObject({
      ok: true,
      source: "tab-title",
      issue: "discarded",
      metadata: { videoId: "discarded", title: "Saved fishing title" },
    });
    expect(reader.readPage).not.toHaveBeenCalled();
  });

  it("marks a fulfilled page result as enriched only when it contributes metadata", async () => {
    const snapshot = tab(6, 1, {
      url: "https://youtube.com/watch?v=enriched",
      title: "Camera review - YouTube",
    });
    const reader = {
      readPage: vi.fn(async () => ({
        canonicalUrl: snapshot.url,
        title: "Camera review",
        description: "A detailed full-frame camera review.",
        channelName: "Photo channel",
        hashtags: ["#photography"],
        playlistTitle: undefined,
      })),
    };

    const [result] = await collectTabMetadata([snapshot], reader, options());

    expect(result).toMatchObject({ ok: true, source: "page" });
    if (result?.ok) expect(result.metadata.description).toContain("full-frame");
  });
});
```

- [ ] **Step 2: Run the new test and verify red state**

Run:

```powershell
npm test -- tests/metadata/collector.test.ts
```

Expected: FAIL because `src/metadata/collector.ts` does not exist.

- [ ] **Step 3: Define the closed metadata contracts**

Create `src/metadata/collector.ts` with these public contracts:

```ts
import type { TabSnapshot } from "../grouping/types";
import type { VideoMetadata } from "../types";
import type { RawPageMetadata } from "./normalize";

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
```

- [ ] **Step 4: Implement ordered baseline and successful-enrichment behavior**

Implement these concrete rules in the same file:

```ts
const baselineFor = (tab: TabSnapshot): VideoMetadata | null => {
  const identity = parseYouTubeVideoUrl(tab.url ?? "");
  return identity ? normalizeVideoMetadata(identity, undefined, tab.title) : null;
};

const isCandidate = (tab: TabSnapshot): boolean =>
  !tab.pinned && parseYouTubeVideoUrl(tab.url ?? "") !== null;

const sameMetadata = (left: VideoMetadata | null, right: VideoMetadata): boolean =>
  left !== null && JSON.stringify(left) === JSON.stringify(right);
```

Filter candidates once, allocate an output array with the candidate length, and process candidate
indexes through a worker loop. For discarded tabs, call `normalizeVideoMetadata(identity,
undefined, tab.title)` and return either the `title-only/discarded` success or
`failed/no-usable-title` result. For a fulfilled reader result:

1. Parse its canonical URL when present. A different video ID produces the `stale-page` issue.
2. Normalize the page result with the tab title fallback.
3. Compare it with `baselineFor(tab)`. A changed result is `source: "page"`; an identical result is
   `source: "tab-title", issue: "page-unavailable"`.
4. Store the result at its original candidate index.

At this task boundary, reader rejections use `injection-error` title fallback. Task 2 adds time and
budget races without changing these types.

- [ ] **Step 5: Run focused tests, type checking, and lint**

Run:

```powershell
npm test -- tests/metadata/collector.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit `0`; the three new tests pass.

- [ ] **Step 6: Commit the metadata model**

Run:

```powershell
git add src/metadata/collector.ts tests/metadata/collector.test.ts
git commit -m "feat(metadata): add title-first collection model"
```

Expected: one focused commit containing only the collector and its tests.

---

### Task 2: Deadlines, cancellation, immediate injection, and late-result isolation

**Files:**
- Modify: `src/metadata/collector.ts`
- Modify: `src/chrome/tabs.ts`
- Modify: `tests/metadata/collector.test.ts`
- Modify: `tests/chrome/tabs.test.ts`
- Modify: `tests/helpers/chrome-fixtures.ts`
- Modify: `src/run/coordinator.ts`
- Modify: `tests/helpers/run-fixtures.ts`

**Interfaces:**
- Consumes: Task 1 metadata contracts and the existing
  `extractYouTubePageMetadata(): RawPageMetadata` function.
- Produces: `TabsPort.collectMetadata(tabs, options)` where `options` contains the current
  `AbortSignal` and metadata progress callback.
- Guarantees: logical concurrency at most `8`; per-tab fallback after `3_000` ms; phase fallback
  after `60_000` ms; no late publication after timeout, cancellation, budget, or a newer collection
  generation.

- [ ] **Step 1: Add failing fake-timer reliability tests**

Extend `tests/metadata/collector.test.ts` with `afterEach(() => vi.useRealTimers())` and these
behaviors:

```ts
it("uses the title baseline after the three-second soft deadline", async () => {
  vi.useFakeTimers();
  const snapshot = tab(10, 1, {
    url: "https://youtube.com/watch?v=slow",
    title: "Slow history video - YouTube",
  });
  const progress = vi.fn();
  const resultPromise = collectTabMetadata(
    [snapshot],
    { readPage: vi.fn(() => new Promise(() => undefined)) },
    { signal: new AbortController().signal, onProgress: progress },
  );

  await vi.advanceTimersByTimeAsync(3_000);
  await expect(resultPromise).resolves.toMatchObject([
    { ok: true, source: "tab-title", issue: "timeout" },
  ]);
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ timedOut: 1, active: 0 }));
});

it("settles queued and active work at the global budget", async () => {
  vi.useFakeTimers();
  const tabs = Array.from({ length: 20 }, (_, index) =>
    tab(index + 1, 1, {
      url: `https://youtube.com/watch?v=video-${index}`,
      title: `Video ${index} - YouTube`,
    }),
  );
  const resultPromise = collectTabMetadata(
    tabs,
    { readPage: vi.fn(() => new Promise(() => undefined)) },
    {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      policy: {
        concurrency: 8,
        perTabDeadlineMs: 120_000,
        phaseBudgetMs: 60_000,
        heartbeatMs: 5_000,
      },
    },
  );

  await vi.advanceTimersByTimeAsync(60_000);
  const results = await resultPromise;
  expect(results).toHaveLength(20);
  expect(results.every((result) => result.ok && result.source === "tab-title")).toBe(true);
});

it("rejects on cancellation and ignores a late page result", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let resolvePage!: (value: { canonicalUrl: string; title: string }) => void;
  const readPage = vi.fn(
    () => new Promise<{ canonicalUrl: string; title: string }>((resolve) => (resolvePage = resolve)),
  );
  const progress = vi.fn();
  const resultPromise = collectTabMetadata(
    [tab(1, 1, { url: "https://youtube.com/watch?v=cancel", title: "Saved - YouTube" })],
    { readPage },
    { signal: controller.signal, onProgress: progress },
  );

  controller.abort();
  await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
  const callsAfterAbort = progress.mock.calls.length;
  resolvePage({ canonicalUrl: "https://youtube.com/watch?v=cancel", title: "Late private title" });
  await Promise.resolve();
  expect(progress).toHaveBeenCalledTimes(callsAfterAbort);
});

it("completes 145 never-settling tabs within the simulated phase budget", async () => {
  vi.useFakeTimers();
  const tabs = Array.from({ length: 145 }, (_, index) =>
    tab(index + 1, 1, {
      url: `https://youtube.com/watch?v=large-${index}`,
      title: `Large ${index} - YouTube`,
    }),
  );
  let maximumLogicalActive = 0;
  const resultPromise = collectTabMetadata(
    tabs,
    { readPage: vi.fn(() => new Promise(() => undefined)) },
    {
      signal: new AbortController().signal,
      onProgress: (value) => (maximumLogicalActive = Math.max(maximumLogicalActive, value.active)),
    },
  );

  await vi.advanceTimersByTimeAsync(60_000);
  await expect(resultPromise).resolves.toHaveLength(145);
  expect(maximumLogicalActive).toBeLessThanOrEqual(8);
});
```

Also add cases for timeout without a usable title, immediate reader rejection, stale canonical URL,
duplicate-tab ordering, budget logging once, five-second sanitized heartbeat payloads, and a second
collection run remaining unaffected by late completion from the first.

- [ ] **Step 2: Run reliability tests and verify red state**

Run:

```powershell
npm test -- tests/metadata/collector.test.ts
```

Expected: FAIL on timeout, budget, cancellation, heartbeat, and late-result assertions because Task
1 has no bounded races.

- [ ] **Step 3: Implement the per-attempt soft deadline**

In `src/metadata/collector.ts`, map the reader promise to a fulfilled discriminant and catch its
rejection before racing so an abandoned promise cannot create an unhandled rejection:

```ts
type AttemptResult =
  | { kind: "page"; raw: Partial<RawPageMetadata> | undefined }
  | { kind: "injection-error" }
  | { kind: "timeout" }
  | { kind: "budget-exhausted" };

const pageAttempt = reader.readPage(tab).then<AttemptResult>(
  (raw) => ({ kind: "page", raw }),
  () => ({ kind: "injection-error" }),
);
```

Race `pageAttempt` against one `setTimeout` resolving `{ kind: "timeout" }` after
`policy.perTabDeadlineMs`. Clear that timer when the page/error result wins. Convert timeout to the
safe `timeout` title fallback and never attach a state-mutating continuation to `pageAttempt`.

- [ ] **Step 4: Add the global budget and cancellation race**

Create one shared promise that resolves `{ kind: "budget-exhausted" }` after
`policy.phaseBudgetMs`. Race it and an abort promise with every logical attempt. Use
`signal.throwIfAborted()` before a worker claims each candidate, and remove abort listeners when a
race settles.

When budget wins, set `budgetExhausted` once, emit `metadata:budget-exhausted` once, stop issuing
reader calls, and resolve every unclaimed/active candidate from its baseline. When abort wins, emit
`metadata:cancelled` once, mark the collection closed, and rethrow the abort reason. Reader
completion handlers return data only; they must not mutate results, counters, diagnostics, or logs.

Before publishing any result, progress, or log event, require the call's local settled flag to be
false and `options.isCurrent?.() !== false`. A superseded generation closes with an `AbortError`
without publishing. Clear the shared budget timer and all registered listeners in the collection's
outer `finally`.

- [ ] **Step 5: Add progress, ETA, and the five-second heartbeat**

For each logical attempt, increment `active` before racing and decrement it exactly once in
`finally`. Compute progress with these invariants:

Compute progress with these invariants:

```ts
completed === enriched + titleOnly + failed;
active >= 0 && active <= policy.concurrency;
etaMs === null || (etaMs >= 0 && etaMs <= remainingBudgetMs);
```

Exclude discarded baseline completions from the average enrichment duration. Emit the initial
snapshot, every completion, and the final snapshot. Emit aggregate `metadata:waiting` from a
five-second interval even when no page settles, and clear the interval in `finally`.

- [ ] **Step 6: Replace the Chrome adapter's unbounded injection loop**

Modify `src/chrome/tabs.ts` to re-export the result/progress types from the collector and delegate to
`collectTabMetadata`. Define the port as:

```ts
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
```

Give `ChromeTabsAdapter` a private numeric collection generation. Increment it for every call and
pass `isCurrent: () => this.metadataGeneration === generation`. Implement the reader with the exact
injection shape:

```ts
const [frame] = await this.api.scripting.executeScript({
  target: { tabId: tab.id },
  func: extractYouTubePageMetadata,
  injectImmediately: true,
});
return frame?.result;
```

Map safe log events to `console.info` for start/budget/cancel/complete and `console.debug` for
waiting. Pass only the typed `MetadataCollectionProgress` object. Remove `mapWithConcurrency`, the
old ten-second heartbeat, raw error strings, and the `!tab.discarded` eligibility filter from
`tabs.ts`; discarded handling now belongs to the collector.

Update every existing tabs test call with a non-aborted signal and `vi.fn()` progress callback.
Assert `injectImmediately: true`, loading-tab injection, discarded title-only success without an
injection, maximum logical progress `active <= 8`, and absence of private fixture strings in
serialized console-call arguments.

Update `runGrouping` just enough to compile against the required port and preserve cancellation:

```ts
const metadataResults = await deps.tabs.collectMetadata(tabs, {
  signal: options.signal,
  onProgress: (metadata) =>
    options.onProgress({
      phase: "metadata",
      completed: metadata.completed,
      total: metadata.total,
    }),
});
for (const result of metadataResults)
  options.diagnostics?.recordMetadataResult(
    result.ok,
    result.ok ? undefined : result.reason,
  );
```

Update `tests/helpers/run-fixtures.ts` so its fake port accepts the options argument, emits one final
aggregate snapshot, returns `source: "page"` for supplied metadata, and returns
`{ ok: false, reason: "no-usable-title" }` for every other supported unpinned video candidate. Task
3 replaces this minimal progress forwarding with the full run-level metadata payload and typed
diagnostics.

Use this concrete fake implementation after importing `parseYouTubeVideoUrl`:

```ts
collectMetadata: vi.fn(async (_tabs, options) => {
  const candidates = tabs.filter(
    (snapshot) =>
      !snapshot.pinned && parseYouTubeVideoUrl(snapshot.url ?? "") !== null,
  );
  const results = candidates.map((snapshot): TabMetadataResult => {
    const value = metadata.find((entry) =>
      snapshot.url?.includes(`v=${entry.videoId}`),
    );
    return value
      ? { ok: true, tab: snapshot, metadata: value, source: "page" }
      : { ok: false, tab: snapshot, reason: "no-usable-title" };
  });
  const enriched = results.filter(
    (result) => result.ok && result.source === "page",
  ).length;
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
```

- [ ] **Step 7: Run metadata and Chrome adapter checks**

Run:

```powershell
npm test -- tests/metadata/collector.test.ts tests/chrome/tabs.test.ts
npm test -- tests/run/coordinator.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit `0`; fake-timer tests leave no pending timers, and the adapter tests
prove `injectImmediately: true`.

- [ ] **Step 8: Commit bounded collection**

Run:

```powershell
git add src/metadata/collector.ts src/chrome/tabs.ts src/run/coordinator.ts tests/metadata/collector.test.ts tests/chrome/tabs.test.ts tests/helpers/chrome-fixtures.ts tests/helpers/run-fixtures.ts
git commit -m "fix(metadata): bound page enrichment"
```

Expected: one focused reliability commit with no UI or documentation changes.

---

### Task 3: Coordinator progress, diagnostics, and stable summary counts

**Files:**
- Modify: `src/run/types.ts`
- Modify: `src/run/coordinator.ts`
- Modify: `src/diagnostics.ts`
- Modify: `tests/run/coordinator.test.ts`
- Modify: `tests/diagnostics.test.ts`

**Interfaces:**
- Consumes: `MetadataCollectionProgress`, `TabMetadataResult`, and the Task 2 `TabsPort` signature.
- Produces: `RunProgress.metadata?: MetadataCollectionProgress`, aggregate metadata diagnostics, and
  summaries where `eligible` equals metadata-candidate count and `skipped` equals snapshot count
  minus candidate count.
- Guarantees: cancellation from the tabs port propagates; cache/classification/grouping do not begin
  until collection settles successfully.

- [ ] **Step 1: Add failing coordinator tests for progress and summary accounting**

Add these tests to `tests/run/coordinator.test.ts`:

```ts
import type { RunProgress } from "../../src/run/types";

it("forwards aggregate metadata progress and counts every candidate as eligible", async () => {
  const deps = fakeRunDependencies({
    tabs: [videoTab(10, "good"), videoTab(20, "missing"), nonYouTubeTab(30)],
    metadata: [videoMetadata("good", "Programming video")],
  });
  const values: RunProgress[] = [];

  const summary = await runGrouping(deps, {
    ...runOptions(),
    onProgress: (value) => values.push(value),
  });

  expect(values).toContainEqual(
    expect.objectContaining({
      phase: "metadata",
      completed: 2,
      total: 2,
      metadata: expect.objectContaining({ enriched: 1, failed: 1 }),
    }),
  );
  expect(summary).toMatchObject({ eligible: 2, skipped: 1, failed: 1 });
});

it("does not classify or mutate after metadata cancellation", async () => {
  const deps = fakeRunDependencies({ tabs: [videoTab(10, "cancelled")] });
  deps.tabs.collectMetadata = vi.fn(async (_tabs, options) => {
    options.signal.throwIfAborted();
    throw new DOMException("Aborted", "AbortError");
  });

  await expect(runGrouping(deps, runOptions())).rejects.toMatchObject({ name: "AbortError" });
  expect(deps.classifier.classify).not.toHaveBeenCalled();
  expect(deps.groups.groupTabs).not.toHaveBeenCalled();
});
```

Retain the existing test proving classification finishes before the first group call.

- [ ] **Step 2: Add failing aggregate diagnostic tests**

In `tests/diagnostics.test.ts`, replace the raw-error metadata call with typed results and add:

```ts
diagnostics.recordMetadataProgress({
  total: 145,
  completed: 145,
  enriched: 100,
  titleOnly: 43,
  failed: 2,
  timedOut: 7,
  active: 0,
  elapsedMs: 58_000,
  etaMs: 0,
  budgetExhausted: true,
});
const privateTab = videoTab(99, "private-video");
privateTab.title = "Private fishing title - YouTube";
diagnostics.recordMetadataResult({
  ok: true,
  tab: privateTab,
  metadata: videoMetadata("private-video", "Private fishing title"),
  source: "tab-title",
  issue: "budget-exhausted",
});

const report = diagnostics.toText();
expect(report).toContain("metadata items: 145; enriched: 100; title only: 43; failed: 2");
expect(report).toContain("metadata timeouts: 7; max active: 0; budget exhausted: yes");
expect(report).toContain("metadata budget fallbacks: 1");
expect(report).not.toContain("Private fishing title");
expect(report).not.toContain("private-video");
expect(report).not.toContain("youtube.com");
```

Import `videoTab` and `videoMetadata` from `tests/helpers/run-fixtures.ts` for this test. The private
fixture proves that the diagnostics API does not serialize the result's `tab` or `metadata` fields.

- [ ] **Step 3: Run coordinator/diagnostic tests and verify red state**

Run:

```powershell
npm test -- tests/run/coordinator.test.ts tests/diagnostics.test.ts
```

Expected: FAIL because run progress has no metadata payload, the coordinator does not pass metadata
options, summary eligibility uses only successes, and diagnostics lacks aggregate metadata state.

- [ ] **Step 4: Wire metadata progress through the run contract**

Add the optional field to `RunProgress`:

```ts
export interface RunProgress {
  phase: RunPhase;
  completed: number;
  total: number;
  download?: { capability: string; loaded: number };
  metadata?: MetadataCollectionProgress;
  classification?: ClassificationBatchProgress & { configuredConcurrency: number };
}
```

In `runGrouping`, start the metadata diagnostics phase and call:

```ts
const metadataResults = await deps.tabs.collectMetadata(tabs, {
  signal: options.signal,
  onProgress: (metadata) => {
    options.diagnostics?.recordMetadataProgress(metadata);
    options.onProgress({
      phase: "metadata",
      completed: metadata.completed,
      total: metadata.total,
      metadata,
    });
  },
});
```

Pass each typed result to `recordMetadataResult(result)`. Calculate:

```ts
const eligible = metadataResults.length;
const skipped = tabs.length - eligible;
```

Use `eligible` in the final summary instead of `successfulMetadata.length`. Preserve successful
metadata filtering, failure isolation, duplicate work collapse, and every existing abort check.

- [ ] **Step 5: Implement aggregate-only diagnostics**

In `RunDiagnostics`, store only the latest cloned `MetadataCollectionProgress`, maximum observed
`active`, and a `Map<MetadataIssue | "no-usable-title", number>`. Define:

```ts
recordMetadataProgress(progress: MetadataCollectionProgress): void;
recordMetadataResult(result: TabMetadataResult): void;
```

`recordMetadataResult` inspects only `ok`, `source`, `issue`, and `reason`; it must not read `tab` or
`metadata`. Render stable aggregate lines for candidates/outcomes, timeouts/max active/budget, and
issue counts. Delete the old API that accepted an arbitrary metadata error and therefore needed
redaction.

- [ ] **Step 6: Run focused and regression checks**

Run:

```powershell
npm test -- tests/run/coordinator.test.ts tests/diagnostics.test.ts tests/grouping/revalidate.test.ts tests/grouping/apply.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit `0`; existing grouping boundary tests continue passing.

- [ ] **Step 7: Commit run integration**

Run:

```powershell
git add src/run/types.ts src/run/coordinator.ts src/diagnostics.ts tests/run/coordinator.test.ts tests/diagnostics.test.ts
git commit -m "feat(run): report metadata collection progress"
```

Expected: one focused coordinator/diagnostics commit.

---

### Task 4: Informative side-panel metadata progress

**Files:**
- Create: `src/sidepanel/metadata-progress.ts`
- Modify: `src/sidepanel/state.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/styles.css`
- Modify: `static/sidepanel.html`
- Create: `tests/sidepanel/metadata-progress.test.ts`
- Modify: `tests/sidepanel/state.test.ts`

**Interfaces:**
- Consumes: `MetadataCollectionProgress` and existing `formatElapsed()`.
- Produces: `metadataProgressView(progress): string` containing counts, active work, timeout subset,
  and ETA without accepting tab metadata.
- Guarantees: native progress remains `completed / total`; existing overall/current-operation timers
  remain authoritative; cancellation remains visible.

- [ ] **Step 1: Write failing pure-view tests**

Create `tests/sidepanel/metadata-progress.test.ts`:

```ts
import { expect, it } from "vitest";
import { metadataProgressView } from "../../src/sidepanel/metadata-progress";

it("renders aggregate metadata counts, active work, timeout subset, and ETA", () => {
  const text = metadataProgressView({
    total: 145,
    completed: 96,
    enriched: 72,
    titleOnly: 20,
    failed: 4,
    timedOut: 4,
    active: 8,
    elapsedMs: 31_000,
    etaMs: 16_000,
    budgetExhausted: false,
  });

  expect(text).toBe(
    "96/145 complete\nEnriched: 72 · Title only: 20 · Failed: 4\nActive: 8 · Timeouts: 4 · ETA: 00:16",
  );
});

it("explains budget fallback and unknown ETA without browsing content", () => {
  const text = metadataProgressView({
    total: 145,
    completed: 145,
    enriched: 80,
    titleOnly: 63,
    failed: 2,
    timedOut: 8,
    active: 0,
    elapsedMs: 60_000,
    etaMs: null,
    budgetExhausted: true,
  });

  expect(text).toContain("Metadata budget reached; saved-title fallback applied.");
  expect(text).toContain("ETA: unknown");
  expect(text).not.toContain("youtube.com");
});
```

Extend `tests/sidepanel/state.test.ts` with a running metadata state and assert heading, status copy,
progress value `96`, and progress max `145`.

- [ ] **Step 2: Run side-panel tests and verify red state**

Run:

```powershell
npm test -- tests/sidepanel/metadata-progress.test.ts tests/sidepanel/state.test.ts
```

Expected: FAIL because the formatter and metadata-aware running copy do not exist.

- [ ] **Step 3: Implement pure metadata formatting**

Create `src/sidepanel/metadata-progress.ts`:

```ts
import type { MetadataCollectionProgress } from "../metadata/collector";
import { formatElapsed } from "./timers";

export function metadataProgressView(progress: MetadataCollectionProgress): string {
  const eta = progress.etaMs === null ? "unknown" : formatElapsed(progress.etaMs);
  const lines = [
    `${progress.completed}/${progress.total} complete`,
    `Enriched: ${progress.enriched} · Title only: ${progress.titleOnly} · Failed: ${progress.failed}`,
    `Active: ${progress.active} · Timeouts: ${progress.timedOut} · ETA: ${eta}`,
  ];
  if (progress.budgetExhausted)
    lines.push("Metadata budget reached; saved-title fallback applied.");
  return lines.join("\n");
}
```

In `toPanelViewModel`, render metadata running copy as
`Working: metadata. <completed>/<total> complete`; retain the existing classification copy for
classification progress.

- [ ] **Step 4: Add and render the accessible detail element**

Add this element immediately before `#classification-progress` in `static/sidepanel.html`:

```html
<p id="metadata-progress" aria-live="polite" hidden></p>
```

In `src/sidepanel/main.ts`, show it only when
`state.kind === "running" && state.progress.metadata !== undefined`, and set `textContent` from
`metadataProgressView`. Add:

```css
#metadata-progress {
  white-space: pre-line;
}
```

Do not alter the overall/current-operation timer interval or create another timer.

- [ ] **Step 5: Run UI, accessibility-state, and build checks**

Run:

```powershell
npm test -- tests/sidepanel/metadata-progress.test.ts tests/sidepanel/state.test.ts tests/sidepanel/timers.test.ts tests/sidepanel/provider-state.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit `0`; `dist/sidepanel.html` contains `metadata-progress` and
`dist/sidepanel.js` contains the aggregate labels but no test fixture title/URL.

- [ ] **Step 6: Commit the side-panel progress UI**

Run:

```powershell
git add src/sidepanel/metadata-progress.ts src/sidepanel/state.ts src/sidepanel/main.ts src/sidepanel/styles.css static/sidepanel.html tests/sidepanel/metadata-progress.test.ts tests/sidepanel/state.test.ts
git commit -m "feat(ui): show metadata collection progress"
```

Expected: one focused UI commit with no classifier or manifest changes.

---

### Task 5: Documentation, workflow reconciliation, and automated validation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Create: `tests/docs/metadata-reliability.test.ts`
- Create: `docs/superpowers/handoffs/2026-08-28-metadata-reliability-pr.md`

**Interfaces:**
- Consumes: all implemented Bundle 14 behavior and the repository version policy.
- Produces: accurate user setup/behavior documentation, current agent guidance, documentation tests,
  and a stable PR body.
- Guarantees: version remains `0.3.0`; manual Chrome work is explicitly pending until performed;
  obsolete Built-in AI runtime instructions are removed from `AGENTS.md` without rewriting the
  historical base spec.

- [ ] **Step 1: Write failing documentation assertions**

Create `tests/docs/metadata-reliability.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("metadata reliability documentation", () => {
  it("documents timing, title fallback, progress, and privacy", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("3-second");
    expect(readme).toContain("60-second metadata budget");
    expect(readme).toContain("injectImmediately");
    expect(readme).toContain("saved tab title");
    expect(readme).toContain("145");
    expect(readme).toContain("late page results are ignored");
    expect(readme).toContain("no titles, URLs, or tab IDs");
  });

  it("keeps agent guidance aligned with Ollama and sequential focused specs", async () => {
    const agents = await readFile("AGENTS.md", "utf8");
    expect(agents).toContain("local-first Ollama");
    expect(agents).toContain("approved focused specification");
    expect(agents).toContain("Only one bundle branch and one pull request may be active at a time");
    expect(agents).not.toContain("Use Chrome's built-in on-device AI APIs");
    expect(agents).not.toContain("## Six-Bundle Delivery");
  });
});
```

- [ ] **Step 2: Run documentation tests and verify red state**

Run:

```powershell
npm test -- tests/docs/metadata-reliability.test.ts
```

Expected: FAIL because README lacks the new timing contract and AGENTS still describes the retired
Built-in AI runtime/fixed six-bundle process.

- [ ] **Step 3: Update README with shipped behavior**

Add one concise metadata collection subsection covering:

- immediate URL/title baseline;
- `injectImmediately` page enrichment with eight logical workers;
- 3-second soft per-tab fallback and 60-second global budget;
- discarded tabs remaining discarded and using their saved title;
- loading tabs being injected immediately without waiting for `document_idle`;
- title-only cache fingerprint behavior and later rich-metadata reclassification;
- progress counts, overall/current-operation timers, ETA, timeout subset, and budget message;
- aggregate console/copied diagnostics with no titles, URLs, or tab IDs;
- cancellation and ignored late results;
- manual 145-tab acceptance expectations and the browser-event-loop limitation.

Update the edge-case, troubleshooting, diagnostics, and manual-acceptance sections where those
statements belong instead of duplicating the complete subsection.

- [ ] **Step 4: Reconcile AGENTS.md with current SDD and provider architecture**

Make these exact conceptual corrections:

1. Describe the product as local-first Ollama with an explicitly enabled optional remote provider.
2. Remove Prompt/Language Detector/Translator runtime requirements from Product Boundary and
   Architecture; retain semantic, privacy, and standalone constraints.
3. In Source of Truth, place approved focused specs/plans after the current user request and state
   that they supersede the base documents only in their explicit scope.
4. Rename `Six-Bundle Delivery` to `Sequential Bundle Delivery`. Keep the original 1–6 table labeled
   as historical foundation delivery and direct later work to its approved focused spec/plan for
   exact branch names.
5. Preserve the one-active-bundle, merged-main baseline, validation, review, regular-merge,
   post-merge-validation, and version-bump policies unchanged.

- [ ] **Step 5: Create a stable Markdown PR body**

Create `docs/superpowers/handoffs/2026-08-28-metadata-reliability-pr.md` with this content:

```markdown
## Summary

- build immediate saved-title baselines for eligible YouTube video tabs
- bound page enrichment with immediate injection, per-tab deadlines, and a global phase budget
- expose aggregate metadata progress and redacted diagnostics
- align README and AGENTS guidance with the shipped Ollama architecture and sequential bundles

## SDD

- Spec: `docs/superpowers/specs/2026-08-28-metadata-reliability-design.md`
- Plan: `docs/superpowers/plans/2026-08-28-metadata-reliability.md`

## Validation

- `npm run validate`
- focused metadata, Chrome adapter, coordinator, diagnostics, side-panel, and documentation tests
- built manifest/permission/version inspection
- secret, raw-metadata-log, and remote-code scan

## Version

Remains `0.3.0`. This bundle is not a packaged release; the appropriate later release is PATCH
`0.3.1` after manual Chrome acceptance.

## Manual Chrome acceptance

Pending after loading the Bundle 14 build: complete/loading/discarded tabs, 145-tab bounded metadata
progress, cancellation, late results, cache convergence, and preservation of pinned, unsupported,
non-YouTube, and unrelated grouped tabs.
```

This tracked body prevents shell quoting or escaped-newline corruption when the PR is created.

- [ ] **Step 6: Run formatting and complete validation**

Run:

```powershell
npm run format
npm run validate
```

Expected: formatting makes only intended mechanical changes; format, lint, all tests, typecheck,
build, and distribution integrity exit `0`.

- [ ] **Step 7: Inspect the packaged extension and repository hygiene**

Run:

```powershell
Get-Content -Raw dist/manifest.json
git check-ignore dist/manifest.json coverage node_modules
git status --short
git diff --check
```

Expected: `dist/manifest.json` remains MV3 version `0.3.0`; permissions and host permissions are
unchanged; generated paths are ignored; status contains only intended Bundle 14 files; diff check is
empty.

- [ ] **Step 8: Scan for secrets, raw metadata logging, and unexpected remote code**

Run:

```powershell
rg -n -i "sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|eval\(|new Function\(" src static tests README.md AGENTS.md
rg -n "console\.(debug|info|warn|error)" src
rg -n "title|description|channelName|canonicalUrl|videoId|tabId" src/metadata/collector.ts src/chrome/tabs.ts src/diagnostics.ts
```

Expected: no secret or dynamic-code matches; every console call contains only typed aggregate
metadata/provider/group counters; content-field matches are limited to normalization/reader/result
logic and are never forwarded to logs or copied diagnostics.

- [ ] **Step 9: Commit documentation and validation artifacts**

Run:

```powershell
git add README.md AGENTS.md tests/docs/metadata-reliability.test.ts docs/superpowers/handoffs/2026-08-28-metadata-reliability-pr.md
git commit -m "docs(metadata): document bounded collection"
```

Expected: one documentation/workflow commit; version files and generated `dist/` remain uncommitted.

---

### Task 6: Review, PR, and bundle boundary

**Files:**
- Modify only files required by verified Critical or Important review findings.
- Test every behavior changed by a review fix in its existing focused test file.

**Interfaces:**
- Consumes: the complete Bundle 14 diff against current `origin/main`.
- Produces: reviewed branch, one PR into `main`, and a post-merge validation handoff.
- Guarantees: no force-push, no bypassed checks, no merge before validation/review, and no next bundle
  before merged-main validation.

- [ ] **Step 1: Refresh the comparison base without stacking unrelated work**

Run:

```powershell
git fetch origin main
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: current branch is `bundle/14-metadata-reliability`, worktree is clean, history contains the
approved spec/plan and focused Task 1–5 commits, and the diff contains only Bundle 14 scope. If
`origin/main` advanced, merge it normally into this same branch, rerun `npm run validate`, and keep
the same branch/PR.

- [ ] **Step 2: Review the complete diff against the spec and current main**

Check every acceptance criterion in the spec against code/tests and inspect specifically for:

- timers/listeners cleared on every completion path;
- no unhandled rejection from abandoned `executeScript` promises;
- actual versus logical concurrency claims;
- abort propagation and no post-abort progress;
- deterministic result order and candidate counts;
- no metadata/cache/group mutation before successful collection completion;
- no raw content in console or copied diagnostics;
- unchanged manifest permissions and `0.3.0` version.

For each Critical or Important finding, add a focused failing regression test, implement the smallest
fix, rerun that test and `npm run validate`, then commit with a scoped Conventional Commit. Record
Minor suggestions in the handoff rather than expanding scope.

- [ ] **Step 3: Run the final verification gate immediately before push**

Run:

```powershell
npm run validate
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: validation exits `0`, diff check is empty, and the worktree is clean.

- [ ] **Step 4: Push and create exactly one PR using the tracked body**

Run:

```powershell
git push -u origin bundle/14-metadata-reliability
gh pr create --base main --head bundle/14-metadata-reliability --title "Bundle 14: Bound metadata collection" --body-file docs/superpowers/handoffs/2026-08-28-metadata-reliability-pr.md
```

Expected: one PR targets `main`; GitHub renders real Markdown headings/lists rather than escaped
newline text. Return the PR URL and do not start another bundle.

- [ ] **Step 5: Check CI/review state and wait for the user-managed regular merge**

Run:

```powershell
gh pr checks
gh pr view --json number,url,state,mergeStateStatus,reviewDecision
```

Expected before merge: checks pass, required review is satisfied, and merge state is clean. Use a
regular merge commit so Bundle 14 remains visible in history. Do not merge the PR unless the user
explicitly asks; do not squash, rebase-merge, force-push, or bypass a failed check. If checks are
still running, use the environment's non-blocking wait/monitoring mechanism rather than holding a
shell command open for more than 60 seconds.

- [ ] **Step 6: Validate merged main and report the bundle boundary**

After the PR is merged, run:

```powershell
git switch main
git pull --ff-only origin main
npm run validate
git log -1 --oneline --decorate
git status --short --branch
```

Expected: merged `main` passes the complete gate and the worktree is clean. Report bundle/branch,
changed files/tasks, focused/full checks, review findings/fixes, PR URL/status, merge commit,
post-merge validation, version `0.3.0`, manual Chrome checks still required, and PATCH `0.3.1` as
separate release work. Only then may another bundle begin.

## Manual Chrome acceptance after the PR build

Load `dist/` from Bundle 14 into Chrome and verify:

1. Complete watch/Shorts/live tabs enrich normally and progress advances.
2. A loading video does not wait for `document_idle`; it enriches immediately or falls back within
   three seconds.
3. A discarded video stays discarded and uses its saved title; a pinned video stays ungrouped.
4. Unsupported YouTube and non-YouTube tabs remain untouched.
5. A 145-tab window shows completed/total, enriched/title-only/failed, active/timeouts, overall and
   current-operation timers, and ETA.
6. Slow injections use title fallback and the logical metadata phase advances near the 60-second
   budget instead of waiting indefinitely.
7. Cancel during metadata collection produces no classification/group mutation; Run again is not
   affected by late results from the cancelled run.
8. Copied diagnostics and console events contain aggregate counts only.
9. A second unchanged run uses valid cache entries; a later richer metadata result changes the
   fingerprint and is reclassified.
10. Managed-group reuse, unrelated user groups, native tab order, duplicate tabs, and current-window
    isolation remain deterministic.

Record observed duration, candidate/enriched/title-only/timeout/failure counts, Chrome version,
Ollama model, and whether the global budget was exercised in the Bundle 14 handoff. Do not describe
these Chrome-only checks as automated passes.
