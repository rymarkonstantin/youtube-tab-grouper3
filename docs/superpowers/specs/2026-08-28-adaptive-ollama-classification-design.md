# YouTube Tab Grouper 3 — Adaptive Ollama Classification

**Date:** 2026-08-28
**Status:** Approved for planning

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
