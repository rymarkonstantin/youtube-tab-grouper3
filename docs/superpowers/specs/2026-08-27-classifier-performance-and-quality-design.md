# YouTube Tab Grouper 3 — Classifier Performance and Quality Addendum

**Date:** 2026-08-27
**Status:** Implemented; merged through Bundles 7–9
**Parent design:** `docs/superpowers/specs/2026-08-27-hybrid-classifier-design.md`

## Context

The hybrid classifier is operational with local Ollama, but testing exposed two limitations:

- A four-item or larger request can exceed the 30-second local request timeout on CPU-only systems.
- A small model can return a semantically unrelated available rule instead of the deterministic
  `Uncategorized` fallback.

The existing provider contract, current-window scope, privacy boundary, and grouping safety remain
unchanged. This addendum defines bounded performance controls and a smaller response contract.

## Goals

- Keep large runs responsive and recoverable on modest local hardware.
- Preserve successful classifications when another item or batch fails.
- Reduce prompt and generated-token volume in an explicit user-controlled mode.
- Make concurrency configurable for both local and remote providers.
- Keep classification semantic and rule-description-driven; do not introduce keyword matching.
- Keep reasons optional and out of persistent cache entries.

## Non-goals

- Automatic hardware benchmarking or model replacement.
- Cloud inference, media downloads, transcription, or additional browsing data.
- A confidence score that pretends to provide a model-independent correctness guarantee.
- Changing the default category taxonomy in this addendum.

## User settings

Extend `ClassifierConfig` with:

```ts
turboMode: boolean;  // default false
concurrency: number; // integer 1–8, default 1
```

Older stored configurations that omit these fields load as `turboMode: false` and
`concurrency: 1`. Invalid values are rejected without overwriting the stored configuration.

The Options page exposes independent controls:

- **Turbo mode** — off by default; enables compact prompts and asks for a short optional reason.
- **Concurrent batches** — a numeric control from 1 through 8; applies to local and remote
  providers and defaults to sequential processing (`1`).

Turbo mode does not change concurrency, and changing concurrency alone does not invalidate a
semantic cache decision.

## Batch and concurrency model

The provider-chain classifier owns request scheduling for both providers. It partitions work into
bounded batches of at most four items, then runs batches with the configured concurrency limit while
returning results in original item order.

Provider adapters receive one bounded batch at a time from the chain. An adapter may retain
defensive validation and single-request recovery, but it must not create a second normal scheduling
layer or exceed the chain's concurrency limit.

If a batch times out, it is recursively split into two smaller batches until single-item requests.
Single-item timeout or other operational failure affects only that item; successful items from
other batches remain eligible for planning and grouping. Caller cancellation still aborts the run.

Provider fallback remains one-time and provider-level: a local health/transport/model failure may
select the configured remote provider in Automatic mode. A partial batch result is not itself a
reason to switch providers.

The chain distinguishes a provider-level operational failure from an item-level incomplete result:
the former may trigger the existing one-time fallback policy, while the latter preserves valid
results and retries only missing item IDs on the same provider.

## Prompt contract

All metadata properties except `itemId` and `title` are optional. Empty properties are omitted.
The full normalized metadata remains available to the non-Turbo prompt, subject to existing
metadata normalization limits.

Turbo prompts use these transport-only limits:

| Field | Limit |
|---|---:|
| title | 200 characters |
| description | 600 characters |
| channel name | 100 characters |
| hashtags | 6 tags, 60 characters each |
| playlist title | 120 characters |

Turbo instructions explicitly state that `Uncategorized` is valid when no enabled rule is a
strong topical match and that `reason` is optional and at most 12 words when supplied. These are
prompt-size/performance controls, not a keyword classifier. The user can disable Turbo to retain
the richer prompt fields.

## Classification quality boundary

Structural validation can confirm that a response names an enabled rule, but it cannot prove that
the model made the right semantic choice. Quality is therefore controlled by the natural-language
rule descriptions, the primary-topic/fallback instructions, and manual acceptance—not by a
post-hoc keyword dictionary. The implementation must not silently reinterpret a valid result based
on words such as "garden", "knife", or "football". If those hard-negative examples remain
misclassified, refine the enabled rule descriptions or model choice and clear the semantic cache;
do not add a hidden keyword classifier.

## Response contract

The structured response requires one object per returned item with `itemId` and `ruleId`.
`reason` is optional, may be retained for transient diagnostics/UI use, and is never required for
group planning or cached decisions. Parsers continue to reject unknown item/rule IDs, duplicates,
empty reasons when present, reasons over the existing 500-character safety limit, and malformed
JSON. Turbo's 12-word instruction is a generation target rather than a second parser mode.

When a multi-item response is incomplete, valid returned items are preserved and missing IDs are
retried individually. If a retry fails, that item is omitted from the result so the coordinator
leaves its tab unchanged and reports it as failed.

## Cache and migration

The classification fingerprint includes the active provider, endpoint origin, model, classifier
schema version, and Turbo prompt mode. Concurrency is excluded because it does not alter semantic
input. Enabling/disabling Turbo therefore causes a fresh decision; changing only concurrency reuses
valid decisions. The Options save flow must preserve the cache for a concurrency-only change, while
provider/model/Turbo changes continue to invalidate it. Existing cache entries remain structurally
compatible and naturally miss when the fingerprint context changes.

## Diagnostics and privacy

Opt-in diagnostics report aggregate batch counts, configured concurrency, split/retry counts, and
safe failure categories. They never include titles, descriptions, channels, URLs, prompts,
responses, reasons, tokens, or credentials. Console traces may identify an operation, item count,
provider, status, and sanitized error type/message only.

## Testing and acceptance

The implementation must add tests for:

- optional reasons and strict validation of present reasons;
- Turbo metadata limits and optional-field omission;
- configuration defaults, 1–8 validation, and legacy-config defaults;
- sequential and bounded-concurrency scheduling for both providers;
- recursive timeout splitting and single-item failure isolation;
- result ordering across batches and incomplete-response recovery;
- cache invalidation when Turbo changes but not when concurrency changes;
- Options controls and persistence without secret leakage.

Manual acceptance uses 2, 13, and 180+ eligible tabs with a CPU-local Ollama model. Verify that
small batches complete, timed-out batches split, progress remains understandable, cached items are
skipped, failed tabs remain unchanged, and unrelated tabs/groups are untouched.

## Release guidance

These are backward-compatible performance and correctness improvements. Keep development builds at
`0.2.0`; use `0.2.1` when packaging the fixes for distribution under the repository versioning
policy.

## Resolved decisions

- The first recovery strategy is recursive timeout splitting, not a single retry of the full batch.
- Concurrency is a separate setting from Turbo mode, applies to local and remote providers, and is
  intentionally conservative by default (`1`) with an explicit upper bound (`8`).
- Turbo mode is opt-in and affects transport/prompt size only; it does not change the taxonomy or
  silently enable parallelism.
- The implementation belongs to the next main-thread SDD steps; this addendum is the reviewed
  design boundary, not an implementation checklist or a request to alter the parent design.
