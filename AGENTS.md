# YouTube Tab Grouper 3 Agent Guide

This repository contains the standalone `youtube-tab-grouper3` Chrome extension. The product uses
local-first Ollama semantic classification, with an explicitly enabled optional remote provider,
to group eligible YouTube video tabs in the currently focused normal Chrome window.

## Product Boundary

- Keep the project standalone. Do not depend on `youtube-tab-collector`, `youtube-tab-grouper`,
  `youtube-tab-grouper2`, or their runtime state, storage, APIs, or repository structure.
- Process only eligible YouTube video pages in the current normal Chrome window.
- Leave non-YouTube tabs, other windows, incognito windows, pinned tabs, and unsupported YouTube
  page types untouched.
- Classify by primary subject matter. Categories are persistent semantic descriptions, not a
  manually maintained keyword dictionary.
- Use the configured local-first Ollama classifier by default. An optional remote provider must be
  explicitly configured, enabled, and granted only its exact runtime origin permission. Do not add
  unapproved providers, telemetry, analytics, media downloads, audio inspection, transcription,
  comments scraping, or recommendation analysis.
- Keep the default taxonomy compact and editable, with `Uncategorized` as the deterministic
  semantic fallback. Operational failures leave affected tabs unchanged.
- Local Ollama classification uses one effective adaptive worker and independent stateless batches;
  configured concurrency must not be presented as local parallelism unless a tested capability
  reports otherwise. Remote providers may retain bounded configured concurrency. The model is kept
  warm between local batches, while semantic cache entries remain valid across scheduling-only
  changes.

## Source of Truth

Use this priority order when making decisions:

1. The current user request and explicit approvals.
2. The approved focused specification and plan for the current work, which supersede the base
   documents only within their explicit scope.
3. The approved base design specification at
   `docs/superpowers/specs/2026-08-27-youtube-tab-grouper3-design.md`.
4. The approved base implementation plan at
   `docs/superpowers/plans/2026-08-27-youtube-tab-grouper3.md`.
5. The current task and its acceptance criteria.
6. This `AGENTS.md`.
7. Existing implementation and tests.
8. General assumptions.

If these sources conflict, stop and explain the conflict before changing code. Do not silently
expand the product or replace semantic classification with keyword matching.

## Architecture and Expected Stack

- Chrome Manifest V3, targeting Chrome desktop 138+.
- Strict TypeScript with plain HTML/CSS; no React or additional UI framework.
- esbuild for fixed extension bundles, Vitest for automated tests, and Biome for formatting/linting.
- Local Ollama and optional remote-provider adapters behind narrow testable interfaces.
- `chrome.storage.local` for validated persistent rules and the bounded classification cache.
- Keep pure parsing, validation, classification-response, planning, and state logic independent of
  Chrome APIs so it remains unit-testable.

## Sequential Bundle Delivery

Only one bundle branch and one pull request may be active at a time. Every bundle starts from the
newly merged and validated `main` branch; never stack a bundle on an unmerged bundle.

### Historical foundation delivery

The following table applies only to historical Bundles 1–6. Later work must take its exact branch
name and task sequence from the applicable approved focused specification and plan.

| Bundle | Branch | Tasks |
|---|---|---|
| 1 — Foundation | `bundle/01-foundation` | Tasks 1–3 |
| 2 — Metadata and cache | `bundle/02-metadata-cache` | Tasks 4–5 |
| 3 — Semantic AI | `bundle/03-semantic-ai` | Tasks 6–8 |
| 4 — Grouping runtime | `bundle/04-grouping-runtime` | Tasks 9–11 |
| 5 — User interface | `bundle/05-user-interface` | Tasks 12–13 |
| 6 — Documentation and validation | `bundle/06-docs-validation` | Task 14 |

For each bundle:

1. Update local `main` from `origin/main` and create the exact branch listed above.
2. Implement its tasks in order with focused task commits.
3. Run task-level checks and then the complete `npm run validate` gate.
4. Request code review against current `origin/main`; fix Critical and Important findings on the
   same branch.
5. Open exactly one pull request into `main`, wait for checks and approval, and use a regular merge
   commit so the bundle boundary remains visible.
6. Refresh `main`, run post-merge validation, and only then start the next bundle.

The one-time remote-baseline bootstrap is procedural and belongs in the implementation plan, not
here. Never force-push, reset away history, or bypass a failed check. If `main` advances while a
bundle is in progress, update that bundle branch, rerun validation and review, and keep the same PR.

## Task Discipline

- Read the design specification, implementation plan, and current task before editing.
- Work only within the selected task and its bundle. Do not add speculative features, libraries,
  abstractions, or UI polish.
- Use red-green-refactor where practical: write a focused failing test, implement the smallest
  behavior, then refactor after the test passes.
- Preserve task-level commits and stop at every documented bundle boundary. Within an explicitly
  approved bundle, continue its tasks sequentially without requesting confirmation between tasks.
- Keep an isolated worktree optional. Never use parallel worktrees to deliver these bundles in
  parallel.

## Testing and Validation

Tests are expected for URL/page recognition, metadata normalization, rule validation and storage,
cache behavior, classifier response parsing and fallback, deterministic grouping plans, Chrome
adapters, coordinator behavior, UI state, manifest permissions, build integrity, and documented
acceptance requirements.

Before claiming a task or bundle is complete, run the relevant focused checks and the complete
validation command required by the plan. Report commands and results honestly; distinguish tests
that could not run because Chrome is unavailable from passing automated checks.

## Scope, Privacy, and Safety

- Request only the permissions approved by the design and plan.
- Inspect and transmit only the metadata required for local classification.
- Do not process browsing history beyond explicitly captured current-window tabs.
- Do not mutate Chrome groups until metadata collection and classification finish.
- Revalidate tab identity before mutation and isolate failures so one tab does not abort unrelated
  eligible tabs.
- Preserve unrelated user-created groups; only reuse groups that satisfy the managed-group ownership
  rules in the design.

For blocking ambiguity, stop and document the conflict, options, recommendation, and required
decision. For non-blocking ambiguity, make the smallest reasonable assumption and record it in the
task or bundle handoff.

## Repository Hygiene and Git

- Keep generated artifacts such as `dist/`, `coverage/`, and `node_modules/` ignored.
- Never commit secrets, API credentials, browsing data, local profiles, machine-specific IDE files,
  or unrelated formatting changes.
- Use concise Conventional Commit subjects, for example
  `feat(metadata): normalize YouTube video metadata`.
- Keep commits small and single-purpose. Do not mix implementation with unrelated repository work.
- Do not edit the design specification or implementation plan to hide unfinished work; update them
  only when a reviewed architectural decision or workflow change is actually required.

### Version increments

- Treat `package.json` as the release version source of truth; keep the packaged manifest version in
  sync with it.
- Use PATCH for backward-compatible fixes, diagnostics, performance improvements, and UI corrections.
- Use MINOR for new backward-compatible user-visible capabilities.
- Use MAJOR for breaking storage/configuration/behavior changes, removed behavior, a higher Chrome
  minimum, or material permission/privacy changes.
- Every merge to `main` requires a version bump. Use PATCH for ordinary compatible bundles unless
  an approved release plan requires a MINOR or MAJOR increment.
- Every uploaded Chrome package must have a higher version than the previously uploaded package.
- The current bundle must make its selected version increment before merge; version bumps are
  deliberate work, not a post-merge follow-up.
- Before packaging, identify the last uploaded version, choose the smallest appropriate bump, and
  update `package.json`, `package-lock.json`, and `static/manifest.json` together. Do not hand-edit
  generated `dist/` files; rebuild them from the synchronized sources.
- A release PR must run `npm run validate`, verify `dist/manifest.json` has the intended higher
  version, and state the selected bump and its rationale in the PR description.
- Do not claim a release is ready until the version test, build, distribution checks, and required
  manual Chrome acceptance have been completed or explicitly recorded as pending.

## Bundle Handoff

At each bundle boundary, report:

- bundle and branch;
- changed files and task coverage;
- tests and validation commands run, with results;
- review findings and resolutions;
- PR link/status and merge commit;
- post-merge `main` validation;
- assumptions, deviations, limitations, and any remaining manual Chrome checks.

Do not claim a bundle is complete until its pull request is merged and the merged `main` passes the
post-merge validation gate.
