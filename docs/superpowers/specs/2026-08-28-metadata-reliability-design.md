# YouTube Tab Grouper 3 — Metadata Collection Reliability

**Date:** 2026-08-28
**Status:** Approved for implementation planning

## SDD relationship

This focused specification extends the metadata-collection parts of the approved base design in
`2026-08-27-youtube-tab-grouper3-design.md`. It relies on the implemented hybrid-classifier and
adaptive-Ollama specifications for classification behavior; it does not restore the retired Chrome
Built-in AI runtime.

Where this document is more specific, it supersedes the base design's metadata timing, loading-tab,
discarded-tab, progress, and diagnostics behavior. All other current-window, privacy, semantic
classification, cache, revalidation, and native-group safety decisions remain unchanged.

The implementation is delivered sequentially as Bundle 14 on
`bundle/14-metadata-reliability`, starting from merged and validated release `0.3.0`. It uses one
branch and one pull request; it is not stacked on another bundle.

## Problem

A manual run with roughly 145 YouTube tabs remained in the metadata phase for more than 26 minutes.
The current collector limits its logical worker pool to eight, but each worker awaits
`chrome.scripting.executeScript()` without a deadline. Programmatic injection defaults to
`document_idle`; loading, frozen, or otherwise unresponsive pages can therefore occupy every worker
for an unbounded time. The title fallback runs only after an injection rejects, so it cannot recover
from an injection promise that does not settle.

The side panel currently reports the metadata phase as one opaque unit. Aggregate console
heartbeats show that work is pending, but neither the user nor copied diagnostics can distinguish
healthy progress from a stalled injection.

## Goals

- Bound the logical metadata phase so a slow page cannot block the complete run indefinitely.
- Preserve semantic quality by enriching tab-title metadata from stable YouTube page metadata when
  that enrichment is promptly available.
- Treat the Chrome tab URL and title as an immediate valid baseline rather than waiting for DOM
  access before deciding whether fallback is possible.
- Keep discarded tabs discarded and avoid waking them.
- Provide understandable metadata counts, elapsed time, ETA, and aggregate diagnostics for large
  windows.
- Preserve input order, duplicate-tab behavior, cancellation, cache correctness, and the rule that
  grouping mutation begins only after metadata collection and classification finish.
- Never log or expose titles, descriptions, channels, hashtags, playlist names, URLs, video IDs,
  tab IDs, prompts, responses, credentials, or raw exception messages.

## Non-goals

- Persisting a content script or continuously monitoring YouTube pages.
- Retrying metadata extraction repeatedly.
- Waking discarded tabs, reloading tabs, or waiting for every page to become complete.
- Adding a user-configurable metadata timeout or concurrency control in this bundle.
- Changing classifier prompts, semantic rules, provider scheduling, or native grouping ownership.
- Guaranteeing that Chrome cancels an already-issued `executeScript()` call. The API does not expose
  per-call cancellation; the extension bounds how long it awaits and ignores late results.

## Decision summary

Metadata collection becomes a two-level process:

1. Build normalized baseline metadata immediately from the parsed YouTube video identity and the
   Chrome tab title.
2. Attempt bounded DOM enrichment for eligible, non-discarded tabs using
   `injectImmediately: true`.

The collector retains eight logical enrichment workers. Each enrichment gets a three-second soft
deadline, and the complete metadata phase gets a 60-second global budget. A timeout, injection
error, unusable/stale page result, or exhausted global budget uses the baseline when its title is
valid. If neither page metadata nor baseline contains a usable title, that tab is an operational
metadata failure and remains unchanged.

This approach is preferred over title-only collection because descriptions and channels can improve
semantic classification, and over unbounded DOM collection because one slow page must not hold the
run indefinitely. It requires no new permission, dependency, storage schema, or classifier API.

## Eligibility and baseline behavior

The initial tab snapshot and pure URL parser remain authoritative.

- Supported `/watch`, `/shorts/`, and `/live/` video URLs are metadata candidates.
- Pinned tabs and unsupported/non-YouTube pages remain excluded and untouched.
- Every candidate receives a baseline normalization attempt from video identity plus
  `chrome.tabs.Tab.title` before DOM work is scheduled.
- Discarded candidates are never injected or awakened. A valid title produces a title-only metadata
  result; an unusable title produces a per-tab failure.
- All non-discarded candidates, including loading and complete tabs, may be injected with
  `injectImmediately: true`. Loading state therefore does not force title-only behavior, and
  injection does not deliberately wait for `document_idle`.
- If a loading page exposes only partial metadata, existing normalization precedence and bounds
  apply. The tab title remains the final fallback.
- Duplicate video tabs are kept as separate tab results in snapshot order. Existing work-item
  collapsing later in the coordinator still prevents duplicate semantic inference for identical
  normalized metadata.

Using title-only metadata can reduce classification quality, but title is already the product's
strongest signal. A title-only classification has a title-only metadata fingerprint. If a later run
successfully obtains richer metadata, the changed fingerprint causes a fresh classification rather
than reusing the weaker cached result.

## Timing and scheduling contract

The v1 constants are deliberately fixed:

| Limit | Value | Meaning |
|---|---:|---|
| Logical enrichment concurrency | 8 | At most eight enrichment attempts are actively awaited. |
| Per-tab soft deadline | 3 seconds | Stop awaiting one injection and resolve from the baseline. |
| Metadata phase budget | 60 seconds | Stop scheduling/awaiting enrichment and resolve remaining candidates from baselines. |

The per-tab deadline begins when that tab's injection is issued. The global budget begins when
metadata collection starts. The collector does not add retries after timeout or injection failure.

When the global budget is exhausted:

- queued candidates are completed immediately from their baselines;
- logically active candidates stop being awaited and are completed from their baselines;
- no additional page injection is issued;
- the run continues to cache lookup and classification with every valid result;
- the budget event is reported as degraded metadata quality, not as a global run failure.

Chrome may complete an abandoned injection later. Because `executeScript()` has no abort handle,
the actual browser promises can temporarily outlive the eight logical workers. The design does not
claim an eight-call browser-level cancellation guarantee. The 60-second budget bounds new calls,
and all late completions are ignored.

The 60-second contract is a logical application deadline. A severely blocked browser event loop
can delay JavaScript timers; diagnostics report actual elapsed time rather than claiming a stronger
real-time guarantee than Chrome can provide.

## Cancellation and late-result isolation

`TabsPort.collectMetadata` receives the current run's `AbortSignal` and a progress callback.
Cancellation differs from budget exhaustion:

- cancellation rejects the collection with the run's abort condition;
- no baseline results from that cancelled collection proceed to classification;
- no new enrichment work is scheduled;
- late injection results cannot emit progress, update diagnostics, write cache entries, or affect a
  later run.

Each collection call owns a run-scoped generation/token and settled state. Completion handlers check
that state before publishing an outcome. Starting a new run after cancellation creates a new token;
an old Chrome promise is incapable of mutating the new run's counters or results.

The coordinator continues to check cancellation before every phase and immediately before group
application. No group mutation occurs during metadata collection.

## Result and progress model

The tabs port continues returning one ordered success or failure result per metadata candidate. A
result also carries safe, closed-set source and issue values so the coordinator never needs a raw
Chrome exception and can retain the cause of a failed fallback:

```ts
type MetadataIssue =
  | "discarded"
  | "timeout"
  | "injection-error"
  | "stale-page"
  | "page-unavailable"
  | "budget-exhausted";

type TabMetadataResult =
  | {
      ok: true;
      tab: TabSnapshot;
      metadata: VideoMetadata;
      source: "page";
    }
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

interface MetadataProgress {
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
```

`completed` equals `enriched + titleOnly + failed`. `timedOut` is an informational subset of
completed outcomes rather than an additional outcome, and the UI labels it accordingly. Progress
contains counts and durations only.

ETA is calculated from completed logical enrichment attempts after the first attempt settles. It
is clamped to the remaining global budget and is `null` before there is enough timing information.
Baseline-only discarded results do not make enrichment appear artificially fast. ETA is advisory;
the fixed global budget is the reliability boundary.

## Run-summary accounting

The summary uses stable population meanings:

- `eligible` is the number of supported, unpinned YouTube video-tab candidates captured for
  metadata collection, including candidates that later fail;
- `skipped` is the captured window-tab count minus that candidate count;
- `grouped`, `cached`, `uncategorized`, and `failed` describe outcomes within the run and are not
  required to add up to `eligible` because a cached tab may also be grouped and later phases can
  fail independently.

This prevents a large metadata-failure count from being shown beside a misleadingly small
`eligible` count. Adding discarded title-only candidates can increase `eligible` and decrease
`skipped` compared with the current implementation, without waking or otherwise mutating those
tabs.

## Side-panel behavior

The existing overall-run and current-operation timers remain the two authoritative timers. The
metadata phase adds aggregate detail without introducing a popup or a new settings surface. A
representative state is:

```text
Working: metadata. 96/145 complete
Enriched: 72 · Title only: 20 · Failed: 4
Active: 8 · Timeouts: 4 · ETA: 00:16
```

The native progress bar uses `completed / total`. If the global budget is reached, the status says
that remaining tabs are being resolved from their saved titles and then advances normally. Tabs
without a usable saved title are still counted as failures. The user can cancel at any time. No
title, URL, or per-tab identifier appears in progress.

## Diagnostics and console logging

Diagnostics remain local, opt-in, aggregate, and in memory. The copied report adds:

- metadata candidate count;
- enriched, title-only, timeout, injection-error, budget-fallback, and no-title counts;
- maximum logical active enrichment count;
- metadata phase duration and whether the global budget was exhausted.

Console events remain sanitized and aggregate:

- `metadata:start` once;
- `metadata:progress` or `metadata:waiting` at most once every five seconds;
- `metadata:budget-exhausted` once when applicable;
- `metadata:cancelled` once when applicable;
- `metadata:complete` once.

There is no per-tab console logging. Known outcomes use the closed enum above; raw Chrome exception
messages are neither copied nor logged.

## Error behavior

- One injection rejection or timeout affects only that tab's enrichment.
- A valid tab-title baseline converts an enrichment problem into a successful title-only result.
- No usable page or tab title produces a metadata failure and leaves that tab unchanged.
- Global budget exhaustion does not fabricate metadata or semantic classifications.
- Cancellation aborts the complete run and preserves the existing no-pre-application-mutation
  guarantee.
- A tab that closes or navigates later is still removed by the existing pre-application
  revalidation.
- Unexpected collector-level programming errors propagate and produce zero group mutations because
  application has not started.

## Privacy and permissions

The design uses the existing `scripting` permission and YouTube host permissions. It adds no Chrome
permission, host permission, external service, telemetry, or storage field containing browsing
content.

Only supported YouTube video tabs from the captured current normal window are considered. The
collector reads the same bounded fields already approved for classification. Baselines, page
metadata, raw failures, and late results are not newly persisted. Optional remote-provider privacy
behavior remains governed by the implemented hybrid-classifier design.

## Testing strategy

Automated tests use fake timers and mocked Chrome calls; they never wait for real three- or
60-second deadlines.

Required coverage:

- immediate baseline normalization and existing field bounds;
- successful page enrichment with `injectImmediately: true`;
- loading-tab immediate injection and fallback from partial metadata;
- discarded-tab title-only success without injection or wake-up;
- three-second timeout with valid-title fallback;
- timeout without a usable title producing a per-tab failure;
- injection rejection and stale-page fallback;
- 60-second global-budget settlement of queued and active candidates;
- cancellation stopping scheduling and rejecting the collection;
- late injection results being ignored after timeout, cancellation, budget exhaustion, and a
  subsequent run;
- deterministic snapshot ordering and duplicate-tab results;
- logical concurrency never exceeding eight;
- a 145-tab simulation completing within the simulated budget;
- coordinator forwarding aggregate metadata progress while preserving no-mutation-before-
  classification behavior;
- side-panel rendering of counts, timers, timeouts, and ETA;
- copied diagnostics and console-event payloads containing no browsing metadata or raw errors.

The complete `npm run validate` gate remains required. Manual Chrome acceptance uses a large window
containing complete, loading, discarded, duplicated, and unsupported tabs. It verifies that the
metadata phase makes visible progress, completes near the application budget rather than waiting
indefinitely, preserves discarded/pinned/unsupported tabs, and still produces deterministic groups.

## Documentation and workflow reconciliation

Bundle 14 updates `README.md` with the metadata deadline, title-only fallback, progress, and
diagnostic behavior. It also reconciles `AGENTS.md` with the already-implemented local-first Ollama
architecture and replaces the obsolete implication that only Bundles 1–6 may ever exist with a
general sequential-bundle rule plus a historical bundle reference. Its source-of-truth section
will state that an approved focused specification supersedes the base specification only within the
focused specification's explicit scope.

These documentation changes describe already-approved/implemented architecture and this reviewed
feature; they do not expand provider or privacy scope.

## Release impact

Bundle 14 is a backward-compatible reliability, diagnostics, and UI correction. Development work
does not bump the version automatically. If the result is packaged after manual acceptance, the
smallest appropriate release is PATCH `0.3.1`, performed in a separate release PR that synchronizes
`package.json`, `package-lock.json`, and `static/manifest.json` and runs the full release gate.

## Acceptance criteria

- A slow or never-settling page cannot hold a logical metadata worker indefinitely.
- Loading pages are injected as soon as possible rather than deliberately waiting for
  `document_idle`.
- Discarded tabs are not awakened and can be classified from a usable saved title.
- Every successful fallback uses real normalized tab-title metadata; no metadata is invented.
- The logical metadata phase settles at the global budget even when all injection promises remain
  pending, subject only to browser event-loop scheduling.
- Cancellation and late results cannot leak work into classification, cache, diagnostics, or a
  later run.
- Progress is informative for large tab sets and contains no browsing content.
- Eligible and skipped summary counts use the stable candidate definitions in this specification.
- Operational metadata failures leave affected tabs unchanged.
- No native group mutation begins before metadata and classification finish.
- Existing semantic cache, provider selection, adaptive classification, grouping ownership,
  current-window isolation, and non-YouTube safety remain intact.
- Manifest permissions and storage schemas do not expand.
- Focused tests and `npm run validate` pass; remaining Chrome-only checks are explicitly recorded.

## Primary reference

- [Chrome `scripting.executeScript()`](https://developer.chrome.com/docs/extensions/reference/api/scripting#method-executeScript) — `injectImmediately` triggers injection as soon as possible instead of waiting for `document_idle`; the returned promise resolves after script execution completes.
