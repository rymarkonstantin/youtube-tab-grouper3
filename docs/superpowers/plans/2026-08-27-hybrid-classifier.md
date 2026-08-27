# Hybrid Semantic Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Chrome Built-in AI with a local-first Ollama classifier and optional remote OpenAI-compatible fallback while preserving semantic grouping behavior.

**Architecture:** Keep the existing `VideoClassifier` coordinator boundary and introduce provider adapters behind it. Ollama is tried first; Automatic mode may fall back once to a configured remote provider. Provider settings, cache fingerprints, diagnostics, and side-panel status are updated without changing tab/group planning.

**Tech Stack:** TypeScript, Chrome MV3, `fetch`, `chrome.storage.local`, optional host permissions, Vitest, Biome, esbuild.

**Spec:** `docs/superpowers/specs/2026-08-27-hybrid-classifier-design.md`

## Global Constraints

- Keep current-window-only processing and native grouping unchanged.
- Do not use Chrome Prompt, Language Detector, or Translator APIs at runtime.
- Default to local Ollama at `http://127.0.0.1:11434` with model `qwen2.5:3b-instruct`.
- Remote classification is opt-in and uses only configured optional host permissions.
- Never log raw metadata, URLs, prompts, responses, credentials, or browsing history.
- Preserve semantic rule descriptions and multilingual input support.
- Keep cache entries bounded to 500 and fingerprint provider/model configuration.
- Every task uses red-green-refactor and ends with a focused commit.

### Task 1: Provider contracts and configuration model

**Files:** Create `src/classifier/providers.ts`, `src/classifier/config.ts`, `tests/classifier/config.test.ts`; modify `src/types.ts` only if shared types are required.

- [x] Write failing tests for `local-only`, `automatic`, and `remote-only` selection, default configuration, endpoint validation, and redaction of API keys.
- [x] Run `npm test -- tests/classifier/config.test.ts` and verify failure because the provider/config modules do not exist.
- [x] Implement typed provider input/output, `ClassifierConfig`, defaults, validation, and a provider-chain selector that returns deterministic fallback decisions.
- [x] Re-run focused tests, then `npm run format` and `npm run typecheck`.
- [x] Commit `feat: define hybrid classifier contracts`.

### Task 2: Ollama local provider

**Files:** Create `src/classifier/ollama.ts`, `tests/classifier/ollama.test.ts`; modify `src/classifier/prompt.ts` only to share the semantic JSON prompt if needed.

- [x] Write failing tests for request shape, model/endpoint selection, timeout/abort handling, unavailable runtime, malformed JSON, and valid multilingual classification responses.
- [x] Run the focused Ollama tests and verify expected failures.
- [x] Implement an Ollama adapter using `POST /api/chat` with structured JSON output instructions and no metadata logging.
- [x] Parse responses through the existing response validator and map transport/model errors to typed provider errors.
- [x] Run focused tests and commit `feat: add local ollama classifier`.

### Task 3: Remote OpenAI-compatible provider

**Files:** Create `src/classifier/remote.ts`, `tests/classifier/remote.test.ts`.

- [x] Write failing tests for authorization headers, request minimization, endpoint normalization, timeout/abort, non-2xx responses, malformed responses, and API-key redaction.
- [x] Run focused tests and verify red state.
- [x] Implement `POST <endpoint>/chat/completions` with the configured model and semantic JSON response contract.
- [x] Ensure request bodies contain metadata required for classification but never tab URLs or unrelated page data.
- [x] Run focused tests and commit `feat: add optional remote classifier`.

### Task 4: Storage, cache fingerprint, and permissions

**Files:** Create `src/classifier/storage.ts`, `tests/classifier/storage.test.ts`; modify `src/cache/fingerprint.ts`, `static/manifest.json`, `scripts/check-dist.mjs`.

- [x] Write failing tests for persistent defaults, customized settings preservation, invalid configuration recovery, provider/model fingerprint changes, and optional remote permission origin extraction.
- [x] Run focused tests and verify failure.
- [x] Implement versioned `classifierConfig` storage, include active provider/model/config version in classification fingerprints, and add loopback plus optional remote host permission declarations without broad host access.
- [x] Update distribution checks to assert the approved permissions and absence of Chrome AI permissions.
- [x] Run focused tests and commit `feat: persist hybrid classifier configuration`.

### Task 5: Coordinator integration and diagnostics

**Files:** Create `src/diagnostics.ts`, `tests/diagnostics.test.ts`; modify `src/run/coordinator.ts`, `src/run/types.ts`, `src/sidepanel/main.ts`.

- [x] Write failing tests for local-first selection, one-time remote fallback, no-fallback local-only behavior, operational failure isolation, aggregate diagnostics, redaction, and phase timing.
- [x] Run focused tests and verify failure.
- [x] Replace the Chrome AI construction path with configured provider construction while preserving `VideoClassifier` calls and grouping semantics.
- [x] Add opt-in aggregate diagnostics and a copy action that emits no raw metadata or secrets.
- [x] Run focused tests and commit `feat: integrate hybrid provider chain and diagnostics`.

### Task 6: Options and side-panel UX

**Files:** Modify `static/options.html`, `src/options/main.ts`, `src/options/styles.css`, `static/sidepanel.html`, `src/sidepanel/main.ts`, `src/sidepanel/styles.css`; add `tests/sidepanel/provider-state.test.ts`.

- [x] Write failing pure-state tests for mode selection, remote opt-in, missing credentials, provider status, fallback messaging, and diagnostic copy state.
- [x] Run focused tests and verify failure.
- [x] Add controls for mode, Ollama endpoint/model, remote endpoint/model/key, remote permission request, and diagnostics toggle; preserve existing category editor behavior.
- [x] Show selected provider, fallback reason, model setup guidance, and timer/phase status without displaying secrets.
- [x] Run `npm run validate`, inspect built manifest, scan for secrets/remote-code, and commit `feat: expose hybrid classifier settings`.

### Task 7: Documentation and release gate

**Files:** Modify `README.md`, create `tests/docs/hybrid-classifier-readme.test.ts`.

- [x] Write failing documentation assertions for Ollama installation/model setup, remote opt-in/privacy, modes, permissions, diagnostics, cache migration, and known limitations.
- [x] Run the focused documentation test and verify failure.
- [x] Document setup (`ollama serve`, model pull), configuration, provider fallback, privacy, optional permissions, diagnostics redaction, and troubleshooting.
- [x] Run `npm run format`, `npm run validate`, `git diff --check`, and inspect `dist/manifest.json`.
- [x] Commit `docs: document hybrid classifier setup and privacy`.

## Completion gate

Tasks 1–7 were implemented and reviewed on `feature/hybrid-classifier` and merged into `main` via PR #11. Post-merge automated validation passed: 31 test files / 138 tests, formatting, lint, typecheck, build, and distribution manifest checks. Remaining acceptance work is manual Chrome validation: local-only Ollama operation, configured remote fallback and permission prompting, multilingual metadata, missing-runtime behavior, native group reuse, pinned-tab and navigation races, secret redaction, and deterministic repeated grouping.
