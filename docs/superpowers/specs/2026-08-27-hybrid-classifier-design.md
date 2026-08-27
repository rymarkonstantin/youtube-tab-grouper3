# YouTube Tab Grouper 3 — Hybrid Classifier Design

**Date:** 2026-08-27  
**Status:** Approved; implemented and merged via PR #11

## Problem

Chrome's built-in AI APIs are not consistently available across profiles and devices, and their Prompt API surface is changing. The extension needs a semantic classifier that works when Chrome's local model is unavailable while preserving a privacy-first local path.

## Decision summary

Use a provider chain with an explicit mode:

```text
Local only       → Ollama on localhost → Uncategorized on unavailable/error
Automatic        → Ollama on localhost → optional remote provider → Uncategorized
Remote only      → optional remote provider → Uncategorized
```

The default mode is `Automatic`, but remote fallback is disabled until the user configures and explicitly enables it. The existing `VideoClassifier` contract remains the coordinator boundary.

## Goals

- Remove the runtime dependency on Chrome Prompt, Language Detector, and Translator APIs.
- Keep semantic classification based on natural-language rule descriptions, not a keyword dictionary.
- Support multilingual titles and descriptions through the selected model.
- Keep local classification available offline through Ollama.
- Provide an optional remote fallback for reliability and model quality.
- Preserve deterministic rule selection, cache invalidation, current-window scope, and safe grouping behavior.
- Make provider failures diagnosable without logging browsing content.

## Non-goals

- Bundling a large model inside the extension.
- Downloading or analyzing video media, audio, comments, or recommendations.
- Sending metadata remotely by default.
- Sharing configuration or runtime state with the other YouTube extensions.
- Requiring a particular cloud vendor.

## Provider interface

```ts
interface SemanticClassifierProvider {
  readonly id: "ollama" | "remote";
  classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassificationResult[]>;
  health(signal: AbortSignal): Promise<ProviderHealth>;
}

interface ClassifierInput {
  items: ClassificationItem[];
  rules: GroupRule[];
  fallbackRuleId: string;
}
```

The provider chain selects one provider per run. A remote retry is allowed only after a local availability/transport/model failure in `Automatic` mode; malformed semantic responses are treated as provider failures and never produce grouping mutations.

## Local Ollama provider

The default local endpoint is `http://127.0.0.1:11434`. The model name is configurable, with a documented example such as `qwen2.5:3b-instruct`. The provider sends only the classifier input required for the current run and requests a constrained JSON response containing one result per item. It must not log prompts or metadata.

The extension declares narrowly scoped localhost access. A health check distinguishes “Ollama not installed/running”, “model missing”, timeout, and malformed response. The UI offers setup guidance but does not attempt to install software or models.

## Optional remote provider

The remote provider uses a configurable OpenAI-compatible `chat/completions` endpoint, model, and API key. The key is stored only in `chrome.storage.local` and is never committed or logged. The request contains title/description/channel/hashtags/playlist metadata and semantic rules, but no tab URL, browsing history, or media.

Remote access is disabled until explicitly enabled. The options page requests a runtime optional host permission for the configured origin; no broad `<all_urls>` permission is added. If permission is denied, the provider remains unavailable and the run falls back to `Uncategorized` without mutating groups.

## Configuration and cache

Persist provider settings in a versioned `classifierConfig` object in `chrome.storage.local`:

```ts
interface ClassifierConfig {
  mode: "local-only" | "automatic" | "remote-only";
  local: { endpoint: string; model: string };
  remote: { enabled: boolean; endpoint: string; model: string; apiKey: string };
  diagnosticsEnabled: boolean;
}
```

Validation restricts local endpoints to loopback HTTP(S), validates remote URLs, limits field sizes, and never overwrites customized values on startup. The classification cache fingerprint includes the active provider id, endpoint origin, model, and classifier configuration version, so changing provider/model/settings invalidates prior decisions.

## Diagnostics

Diagnostics are opt-in and local-only. The default is disabled. A run records aggregate events in memory and exposes **Copy diagnostics** as redacted text:

- run duration and current-operation durations;
- tab counts: total, eligible, skipped, cached, grouped, uncategorized, failed;
- metadata extraction success/failure categories and concurrency peak;
- provider health result, selected provider, fallback reason, batch/retry counts;
- grouping operation failures by category, without tab titles or URLs.

No title, description, channel, URL, prompt, response, token, API key, or raw exception payload is logged. Diagnostics are not uploaded and are cleared when the panel closes unless copied.

## Permissions and privacy

Retain `scripting`, `sidePanel`, `storage`, and `tabGroups`, plus existing YouTube host access. Add loopback host access for Ollama. Remote origins use `optional_host_permissions` requested only after user opt-in. No Chrome built-in AI permission or broad host permission is required.

Local-only mode keeps metadata and inference on the device. Automatic/remote modes clearly disclose that the minimum metadata for the current YouTube tabs and semantic rules is sent to the configured remote endpoint. Non-YouTube tabs remain untouched and are never sent.

## Failure and fallback behavior

- Local-only failure: show provider/setup error and perform zero group mutations.
- Automatic with remote disabled: show local failure and use `Uncategorized` only for items that remain classifiable under the defined fallback policy; operational failures leave tabs unchanged.
- Automatic with remote enabled: try remote once after local failure; if remote fails, leave affected tabs unchanged and report the reason.
- Remote-only without permission/credentials: show configuration error and perform zero group mutations.
- Cancellation, tab closure, navigation, and duplicate invocation retain existing coordinator semantics.

## Migration

Existing semantic category rules remain compatible. Existing classification cache entries are invalidated by the new provider fingerprint. Chrome AI settings are ignored after migration and may be removed in a later cleanup release; no Chrome AI runtime state is read or reused.

## Testing strategy

Add pure tests for provider selection, configuration validation, endpoint/permission decisions, cache fingerprints, response parsing, malformed responses, fallback policy, diagnostics redaction, and deterministic provider-chain behavior. Mock provider ports for coordinator tests. Browser-level tests remain manual and use the README acceptance matrix.

## Open implementation choices

Before coding, confirm the default Ollama model and whether the first remote implementation should target one concrete vendor or remain OpenAI-compatible. The architecture intentionally keeps both behind the provider interface so either choice does not affect grouping logic.
