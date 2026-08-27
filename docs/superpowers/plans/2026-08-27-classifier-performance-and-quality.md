# Classifier Performance and Quality Addendum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded batching, configurable concurrency, Turbo prompt limits, incomplete-response recovery, and diagnostics while preserving semantic classification and safe grouping.

**Architecture:** Keep `ProviderChainClassifier` as the single scheduler. It partitions uncached classification items into batches of at most four, runs those batches with a configured concurrency limit, recursively splits timed-out batches, and returns results in original order. Ollama and remote adapters remain transport-only providers; prompt shaping, response validation, and recovery stay behind narrow pure helpers.

**Tech Stack:** TypeScript, Chrome MV3, `fetch`, `chrome.storage.local`, Vitest, Biome, esbuild.

**Spec:** `docs/superpowers/specs/2026-08-27-classifier-performance-and-quality-design.md`

## Global Constraints

- Keep the existing current-window scope, semantic rule descriptions, grouping plan, cache safety, and privacy boundary unchanged.
- Do not introduce keyword matching, hardware benchmarking, model replacement, cloud inference by default, media analysis, or additional browsing data.
- Default `turboMode` is `false`; default `concurrency` is `1`; valid concurrency is the integer range `1–8`.
- Provider batches contain at most four items and preserve input result order.
- A local provider-level failure may trigger the existing one-time remote fallback only in Automatic mode; a partial batch result never triggers provider fallback.
- Operational failure of one item leaves that item unchanged while successful items continue to planning and grouping.
- Diagnostics and console traces remain aggregate and redacted: never log titles, descriptions, channels, URLs, prompts, responses, reasons, tokens, or credentials.
- Existing stored configurations and cache entries remain readable; omitted new settings normalize to their defaults.
- Turbo mode changes prompt transport limits only. It does not alter taxonomy, enable concurrency, or add a keyword classifier.
- Keep development version `0.2.0`; use `0.2.1` only when packaging these fixes for distribution.

## Bundle Delivery

This addendum is delivered as three sequential bundles. Each bundle starts from the newly merged
`main`, uses one dedicated branch and one pull request, passes review and `npm run validate`, and
must be merged before the next bundle starts.

| Bundle | Branch | Tasks | Scope |
|---|---|---|---|
| 7 — Performance foundation | `bundle/07-performance-foundation` | 1–2 | Configuration migration, Turbo prompts, cache fingerprint, optional reasons, response parsing |
| 8 — Provider scheduling | `bundle/08-provider-scheduling` | 3–4 | Bounded concurrency, timeout splitting, partial recovery, Ollama/remote integration |
| 9 — UX and release | `bundle/09-performance-release` | 5–6 | Diagnostics, progress/options UI, documentation, release validation |

Only one bundle branch and pull request may be active at a time. The first bundle branch may carry
the already completed local Task 1–2 commits, but no bundle work is considered complete until its
pull request is merged into `main`.

---

### Task 1: Configuration migration, cache fingerprint, and prompt modes

**Files:** Modify `src/classifier/config.ts`, `src/classifier/storage.ts`, `src/cache/fingerprint.ts`, and `src/classifier/prompt.ts`; test `tests/classifier/config.test.ts`, `tests/classifier/storage.test.ts`, `tests/cache/fingerprint.test.ts`, and new `tests/classifier/prompt.test.ts`.

**Interfaces:** Extend `ClassifierConfig` with `turboMode: boolean` and `concurrency: number`. Add legacy-field normalization to `loadOrInitializeClassifierConfig()`. Add `buildBatchPrompt(items, options?: { turboMode?: boolean })` and an optional Turbo argument to `buildClassifierSystemPrompt()`.

- [ ] Write failing tests for legacy defaults, validation of `1–8`, Turbo-vs-non-Turbo fingerprints, concurrency-only fingerprint stability, Turbo field limits, optional-field omission, and the optional 12-word reason instruction.
- [ ] Run `npm test -- tests/classifier/config.test.ts tests/classifier/storage.test.ts tests/cache/fingerprint.test.ts tests/classifier/prompt.test.ts` and verify the expected failures.
- [ ] Normalize omitted legacy fields, reject malformed explicit values, include Turbo mode but not concurrency in the classifier fingerprint, and implement the exact limits: title 200, description 600, channel 100, six hashtags of 60 each, playlist 120.
- [ ] Run the focused tests, `npm run format:check`, and `npm run typecheck`.
- [ ] Commit `feat(classifier): add turbo mode and concurrency settings`.

### Task 2: Optional reasons and partial response validation

**Files:** Modify `src/classifier/response.ts` and `src/types.ts` only if the shared reason type is required; test `tests/classifier/response.test.ts`.

**Interfaces:** `createClassificationResponseSchema()` requires `itemId` and `ruleId`; `reason` is optional and bounded when present. Full parsing returns ordered results; partial parsing preserves valid returned items and omits malformed or missing items.

- [ ] Write failing tests for missing reasons, trimmed reasons, empty/overlong reasons, unknown fields/IDs, duplicates, and partial valid-item recovery.
- [ ] Run `npm test -- tests/classifier/response.test.ts` and verify red.
- [ ] Update schema and parsers while preserving strict item/rule validation and input ordering; never synthesize a reason for cache or grouping.
- [ ] Run response and classifier tests, then commit `feat(classifier): allow optional classification reasons`.

### Task 3: Bounded provider scheduling and timeout recovery

**Files:** Create `src/classifier/batching.ts`; modify `src/classifier/providers.ts`; test `tests/classifier/batching.test.ts` and `tests/classifier/providers.test.ts`.

**Interfaces:** Add a pure `runClassificationBatches<T>(items, options)` scheduler with `maxBatchSize`, `concurrency`, `classifyBatch`, and `isTimeout`, returning ordered results and aggregate split/recovery counts. Extend `ProviderChainClassifierOptions` with concurrency and safe aggregate callbacks. Keep `ProviderChainClassifier.classify()` as the coordinator-facing API.

- [ ] Write failing tests for concurrency `1`, maximum eight active batches, batch size four, result ordering, recursive timeout splitting `4 → 2 → 1`, single-item isolation, cancellation, and valid results from incomplete responses.
- [ ] Run `npm test -- tests/classifier/batching.test.ts tests/classifier/providers.test.ts` and verify red.
- [ ] Implement a stable-index worker pool that stops on abort, splits only typed timeout errors, retries missing IDs on the same provider, and omits unrecoverable items.
- [ ] Integrate it into the provider chain while keeping local-to-remote fallback provider-level and one-time.
- [ ] Run focused tests and typecheck, then commit `feat(classifier): schedule bounded concurrent batches`.

### Task 4: Ollama and remote adapter integration

**Files:** Modify `src/classifier/ollama.ts`, `src/classifier/remote.ts`, and prompt wiring; test `tests/classifier/ollama.test.ts` and `tests/classifier/remote.test.ts`.

**Interfaces:** Each adapter receives one bounded batch and performs one transport request. Both accept Turbo prompt options and optional reasons. Typed timeout errors are exposed to the scheduler; adapters do not implement a second normal scheduling layer.

- [ ] Write failing tests for one-request-per-batch behavior, Turbo limits, optional reasons, malformed/incomplete responses, and cancellation.
- [ ] Run focused adapter tests and verify red.
- [ ] Remove adapter-owned normal multi-batch scheduling/recovery, retain defensive parsing and request-body deadlines, and expose timeout classification for the chain.
- [ ] Run all classifier tests and commit `feat(classifier): integrate bounded provider recovery`.

### Task 5: Diagnostics, coordinator progress, and options UI

**Files:** Modify `src/diagnostics.ts`, `src/run/coordinator.ts`, `src/run/types.ts`, side-panel files, options files, and static HTML; test diagnostics, coordinator, provider-state, and new options-state tests.

**Interfaces:** Diagnostics add aggregate concurrency, batch, split, recovery, and Turbo fields. `RunProgress` reports batch-level progress. Options persist Turbo/concurrency, preserve cache for concurrency-only changes, and invalidate cache when Turbo changes.

- [ ] Write failing tests for redacted counters, multi-batch progress, settings persistence, concurrency-only cache preservation, and Turbo cache invalidation.
- [ ] Run focused tests and verify red.
- [ ] Implement coordinator callbacks and diagnostics counters without raw metadata; preserve successful batches and leave failed items unchanged.
- [ ] Add an off-by-default Turbo checkbox and numeric concurrency control constrained to `1–8`, with explanatory copy.
- [ ] Show completed batches/items, configured concurrency, split/recovery status, and timers in the side panel without secrets.
- [ ] Run focused tests, formatting, lint, and typecheck; commit `feat(ui): expose classifier performance controls`.

### Task 6: Documentation, release version, and validation gate

**Files:** Modify `README.md`; add documentation/version tests; update the addendum status after merge; modify `package.json` and `static/manifest.json` only for the explicit `0.2.1` distribution packaging decision.

**Interfaces:** Documentation covers Turbo, concurrency, bounded batches, recovery, cache semantics, diagnostics privacy, and the 2/13/180+ manual matrix. Version checks keep package and manifest versions synchronized.

- [ ] Write failing documentation/version tests for all required behavior and synchronized versions.
- [ ] Run focused tests and verify red for the new requirements.
- [ ] Document setup, controls, recovery, privacy, troubleshooting, and the distinction between development `0.2.0` and distribution `0.2.1`.
- [ ] Run `npm run format`, `npm run validate`, and `git diff --check`.
- [ ] Inspect `dist/manifest.json`, run the scoped secret/remote-code scan, and record manual acceptance results for 2, 13, and 180+ tabs.
- [ ] Commit `docs(release): document classifier performance controls`.

## Completion Gate

Within each bundle, complete tasks sequentially with focused tests and review. At every bundle
boundary, run the complete validation gate, open exactly one pull request, wait for review/checks,
merge it into `main`, synchronize local `main`, and rerun `npm run validate` before opening the next
bundle. Before the final bundle merge, verify local-only classification, Turbo off/on behavior,
concurrency `1` and `8`, recursive timeout splitting, partial-response recovery, multilingual
metadata, cache reuse/invalidation, cancellation, missing Ollama/model, remote fallback,
diagnostics redaction, and deterministic grouping. After Bundle 9 merges, mark the addendum
implemented and decide whether to package `0.2.1`.
