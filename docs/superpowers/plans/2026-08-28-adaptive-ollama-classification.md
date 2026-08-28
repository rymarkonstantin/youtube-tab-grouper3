# Adaptive Ollama Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve local Ollama throughput and progress predictability with prepared run context and adaptive independent batches.

**Architecture:** Add a run-scoped prepared provider that caches prompt construction, sends stateless requests with `keep_alive`, and exposes provider capabilities. Replace fixed local scheduling with adaptive serial batches while retaining bounded remote concurrency and existing recovery.

**Tech Stack:** Strict TypeScript, esbuild, Vitest, Biome, Chrome Manifest V3, Ollama HTTP API.

**Spec:** `docs/superpowers/specs/2026-08-28-adaptive-ollama-classification-design.md`

## Global Constraints

- Keep the extension standalone and local-first; no new cloud service or API key.
- Process only eligible YouTube video tabs in the focused normal window.
- Preserve semantic rule descriptions, cache safety, deterministic ordering, cancellation, and safe grouping mutations.
- Keep Manifest V3 and existing approved permissions.
- Keep local development version `0.2.0`; bump only when packaged distribution requires it.

---

### Task 1: Provider capability and prepared run contract

**Files:**
- Create: `src/classifier/session.ts`
- Modify: `src/classifier/providers.ts`
- Test: `tests/classifier/session.test.ts`

**Interfaces:**
- Produce `PreparedClassificationRun` with `prepare`, `classifyBatch`, `maxConcurrency`, and `maxBatchSize` semantics.
- Consume existing `ClassifierInput`, `ClassificationResult`, and `AbortSignal` types.

- [ ] Write tests proving a run captures rules/model identity once, exposes local serial capability, and rejects use after disposal.
- [ ] Run `npm test -- --run tests/classifier/session.test.ts` and verify the new tests fail.
- [ ] Implement the narrow prepared-run contract and provider capability fields without changing grouping behavior.
- [ ] Run the focused test and `npm run typecheck`.
- [ ] Commit `feat(classifier): add prepared provider run contract`.

### Task 2: Ollama prompt preparation and keep-alive

**Files:**
- Modify: `src/classifier/ollama.ts`
- Modify: `src/classifier/prompt.ts`
- Test: `tests/classifier/ollama.test.ts`
- Test: `tests/classifier/prompt.test.ts`

**Interfaces:**
- Consume `PreparedClassificationRun` and existing bounded metadata/prompt builders.
- Produce one serialized rule context per run and include `keep_alive` on `/api/chat` requests.

- [ ] Add failing tests asserting rules are prepared once, request bodies remain stateless, and `keep_alive` is sent.
- [ ] Run the focused Ollama/prompt tests and verify failure.
- [ ] Implement prepared prompt/context reuse and keep-alive request options; do not add conversation history.
- [ ] Run focused tests, format, lint, and typecheck.
- [ ] Commit `feat(classifier): keep Ollama runs warm with prepared prompts`.

### Task 3: Adaptive local batch scheduler

**Files:**
- Create: `src/classifier/adaptive-batching.ts`
- Modify: `src/classifier/batching.ts`
- Test: `tests/classifier/adaptive-batching.test.ts`

**Interfaces:**
- Consume provider capabilities, item metadata, timeout predicate, and cancellation signal.
- Produce ordered results and aggregate progress including current batch size, average item duration, and ETA.

- [ ] Add failing tests for growth after successful batches, reduction after timeout/malformed output, serial local execution, stable ordering, and cancellation.
- [ ] Run the focused scheduler tests and verify failure.
- [ ] Implement token/item-bounded adaptive sizing with minimum 1, initial 4, maximum 12, and recursive recovery.
- [ ] Ensure remote providers continue using bounded configured concurrency.
- [ ] Run focused tests and the full classifier test suite.
- [ ] Commit `feat(classifier): adapt local Ollama batch sizes`.

### Task 4: Coordinator, diagnostics, and UI progress

**Files:**
- Modify: `src/run/coordinator.ts`
- Modify: `src/run/types.ts`
- Modify: `src/diagnostics.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/state.ts`
- Modify: `src/sidepanel/timer-ui.ts`
- Test: `tests/run/coordinator.test.ts`
- Test: `tests/diagnostics/*.test.ts`

**Interfaces:**
- Consume adaptive batch progress events.
- Produce sanitized preparation/batch/ETA diagnostics and user-visible progress without metadata.

- [ ] Add failing tests for preparation timing, adaptive batch counters, ETA updates, and redaction.
- [ ] Run focused tests and verify failure.
- [ ] Wire events through the coordinator and side panel while keeping cancellation and failed-tab semantics unchanged.
- [ ] Run focused tests and inspect the side-panel bundle for forbidden metadata fields.
- [ ] Commit `feat(ui): report adaptive classifier progress`.

### Task 5: Remove misleading local controls and document operation

**Files:**
- Modify: `src/options/*`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Test: `tests/options/*.test.ts`
- Test: `tests/docs/adaptive-ollama.test.ts`

**Interfaces:**
- Consume provider capability metadata and existing configuration validation.
- Produce provider-aware settings copy and documentation for local serial/adaptive behavior.

- [ ] Add failing tests proving local mode does not advertise ineffective parallel workers while remote mode retains bounded concurrency.
- [ ] Run focused tests and verify failure.
- [ ] Implement the smallest settings/UI change and document warm model, independent batches, and cache behavior.
- [ ] Run focused tests and `npm run validate`.
- [ ] Commit `docs(classifier): explain adaptive Ollama scheduling`.

### Task 6: Performance validation and release handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-adaptive-ollama-classification-design.md`
- Create: `.superpowers/sdd/2026-08-28-adaptive-ollama-classification/task-report.md`

**Interfaces:**
- Consume all prior scheduler, provider, UI, and diagnostic behavior.
- Produce documented benchmark procedure and release readiness report.

- [ ] Add regression tests for 2, 13, and 180+ item scheduling simulations.
- [ ] Run `npm run validate`, inspect `dist/manifest.json`, and scan for secrets/remote code.
- [ ] Record manual Chrome/Ollama acceptance steps, measured timings, and known limitations.
- [ ] Mark the spec implemented only after the bundle’s PR is merged and post-merge validation passes.
- [ ] Commit `docs(performance): record adaptive Ollama validation`.
