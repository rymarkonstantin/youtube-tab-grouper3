# YouTube Tab Grouper 3 — Adaptive Ollama Classification

**Date:** 2026-08-28
**Status:** Implemented; merged through Bundles 11–13 (PRs #27–#29; merge commit `3201db6`)

## Goal

Make local Ollama classification complete large tab sets predictably by preparing one run-scoped
classification context, keeping the model loaded, using adaptive independent batches, and avoiding
misleading local parallelism.

## Design

Each run creates a prepared local classification session containing immutable enabled rules, the
fallback rule, prompt/schema version, model identity, and cancellation signal. The session builds
the bounded semantic prompt once in memory and sends independent JSON requests; it does not append
prior classifications to chat history. Every request uses `keep_alive` so model weights remain
loaded between batches. Local scheduling defaults to one worker and adapts batch size within a
token/item budget. A timeout or malformed response reduces the batch size and invokes existing
partial-response recovery.

Remote providers retain bounded parallel scheduling because their throughput characteristics differ.
The user-facing concurrency setting becomes provider-aware: it remains available for remote
classification, while local Ollama uses one worker unless an explicit capability check proves
parallel inference is beneficial.

## Operational decisions

- The current Ollama adapter reports `maxConcurrency: 1`. Local requests are therefore serial by
  default and remain serial until a future adapter provides a tested capability signal proving that
  parallel inference improves throughput on the active model/runtime. A configuration value alone
  never enables local parallelism.
- Adaptive local batches use an initial size of 4, a minimum of 1, and a maximum of 12. The
  scheduler also applies a deterministic bounded prompt-item budget; it grows only after a complete
  successful batch and shrinks after timeout, transport failure, or malformed/incomplete output.
- Each request is stateless. The adapter sends `keep_alive: "10m"` on Ollama chat requests so the
  model can remain loaded between batches, but it does not depend on conversational history or a
  separate preload request.
- A prepared run is immutable and run-scoped. It owns the validated rules, fallback, model/schema
  identity, precomputed rule context, and cancellation signal; it must be disposed after completion
  or cancellation and cannot be reused by a later run.
- Preparation or provider failure does not mutate tabs. Valid results from a partially malformed
  response are retained, missing items are retried through existing recovery, and irrecoverable
  items remain unchanged/uncategorized according to the existing fallback policy.
- Recovery is bounded: a failed batch splits until single-item batches, and each single item gets
  at most one recovery retry. Once that retry fails, the item is recorded as failed and remains
  unchanged. Automatic mode considers remote fallback only after local recovery is exhausted.
- Adaptive growth is deterministic: start at 4, increase by 2 after two consecutive complete
  successful batches, halve after timeout or malformed output, and clamp every size to 1–12.

## Removed/reduced redundancy

- Fixed four-item local batches are replaced by adaptive batches.
- Local concurrency is no longer treated as an automatic speed multiplier.
- Growing conversational history is explicitly disallowed.
- Prompt construction and metadata truncation are moved out of per-request work.
- Existing cache, structured response parsing, timeout splitting, partial recovery, diagnostics,
  cancellation, and deterministic ordering remain.

## Constraints and acceptance

- No new cloud service, API key, telemetry, media inspection, or non-YouTube processing.
- Rules remain editable semantic descriptions.
- Failed items remain unchanged and one item failure does not abort successful items.
- Run progress reports preparation, batch size, completed items, average item time, and ETA.
- Tests compare fixed scheduling with adaptive local scheduling for 2, 13, and 180+ items.
- The addendum is delivered in sequential branches/PRs from merged `main`; no bundle may be stacked
  on an unmerged bundle.
- Performance validation reports timings and recovery counts but does not require absolute duration
  thresholds, because Ollama latency depends on the host, model, and thermal state.
