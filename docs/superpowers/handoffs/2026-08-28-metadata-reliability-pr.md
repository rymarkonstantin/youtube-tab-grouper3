## Summary

- build immediate saved-title baselines for eligible YouTube video tabs
- bound page enrichment with immediate injection, per-tab deadlines, and a global phase budget
- expose aggregate metadata progress and redacted diagnostics
- align README and AGENTS guidance with the shipped Ollama architecture and sequential bundles

## SDD

- Spec: `docs/superpowers/specs/2026-08-28-metadata-reliability-design.md`
- Plan: `docs/superpowers/plans/2026-08-28-metadata-reliability.md`

## Validation

Confirmed: `npm run validate` passed (44 test files, 261 tests; format, lint, typecheck, build, and distribution checks passed).

Passed individually: `npm test`, `npm run format:check`, `npm run lint`, `npm run typecheck`,
`npm run build`, and `npm run check:dist`.

- focused metadata, Chrome adapter, coordinator, diagnostics, side-panel, and documentation tests
- built manifest/permission/version inspection
- secret, raw-metadata-log, and remote-code scan

## Version

Updated to `0.3.1` (PATCH). Every merge to `main` requires a version bump; ordinary compatible
bundles use PATCH unless an approved release plan requires MINOR or MAJOR. Package, lockfile, and
manifest versions are synchronized.

## Manual Chrome acceptance

Pending after loading the Bundle 14 build: complete/loading/discarded tabs, 145-tab bounded metadata
progress, cancellation, late results, cache convergence, and preservation of pinned, unsupported,
non-YouTube, and unrelated grouped tabs.
