# Bundle 13 Task 6 — Adaptive Ollama validation and release handoff

## Status

Pre-merge validation complete on `bundle/13-adaptive-release`. The adaptive Ollama specification
remains **Approved for planning** until the Bundle 13 pull request is merged and post-merge
validation passes. A follow-up documentation commit should then change the status to Implemented
and record the merge commit, as required by the implementation plan.

The development/package version remains `0.2.0`; no distribution package was requested. The
version increment policy is documented in `README.md` and `AGENTS.md`.

## Validation coverage

- Added deterministic scheduling simulations for 2, 13, and 181 items. They verify ordered,
  complete results, the initial four-item batch, the 1–12 adaptive batch bounds, and zero failed
  items.
- Added cache-fingerprint regression coverage proving concurrency-only changes preserve semantic
  decisions while provider/model, schema, and metadata changes invalidate them.
- Updated the README to state that the initial adaptive request contains at most four items.

## Automated checks

- Focused regression test: `npm test -- --run tests/performance/adaptive-validation.test.ts`
  — 1 file, 5 tests passed; Vitest test duration 12 ms (total command duration 282 ms).
- Full gate: `npm run validate` — passed on 2026-08-28: 41 test files / 224 tests, formatting,
  lint, typecheck, build, and distribution checks all passed.
- `dist/manifest.json`: inspect after build for Manifest V3, version `0.2.0`, and only approved
  permissions; `npm run check:dist` performs the automated distribution checks.
- Secret scan: inspect tracked source and generated `dist/` for API keys, bearer tokens, private
  keys, and unrelated credentials; configuration field names and test placeholders are expected.
- Remote-code scan: inspect for `eval`, `new Function`, remote dynamic imports, and external
  script sources. None are permitted.

## Manual Chrome/Ollama acceptance

Not run in this environment. Before release, use desktop Chrome 138+ with a local CPU Ollama
model and record wall-clock timings for 2, 13, and 180+ eligible tabs. For each run record item
count, provider/model, Turbo, configured concurrency, preparation time, total time, batch sizes,
average item time, ETA behavior, split/recovery counts, grouped/cached/uncategorized/skipped/
failed totals, and cancellation behavior.

Verify adaptive growth and reduction, warm-model behavior between independent requests, cache reuse,
multilingual titles (English, Russian, Belarusian, Japanese), unavailable Ollama, Automatic-mode
fallback, malformed/timeout recovery, pinned tabs, duplicates, navigation/close races, unrelated
groups, non-YouTube tabs, other windows, incognito, deterministic repeated runs, and redacted
diagnostics. Do not claim these checks passed until they are executed in Chrome.

## Known limitations

Automated tests do not launch Chrome or Ollama and therefore cannot verify native tab-group
mutation, model download/warm-up behavior, provider connectivity, permission prompts, or actual
host-dependent inference timings. The manual matrix is required before distribution packaging.

## Commit

`docs(performance): record adaptive Ollama validation`
