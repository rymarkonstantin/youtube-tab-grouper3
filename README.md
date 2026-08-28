# YouTube Tab Grouper 3

## Versioning and releases

The extension and package use synchronized three-part Semantic Versioning. `PATCH` is for
backward-compatible bug fixes, diagnostics, performance work, or small UI corrections. `MINOR`
is for new backward-compatible user-visible capabilities; the hybrid classifier, timers,
classifier settings, adaptive Ollama scheduling, and metadata-reliability improvements are included in `0.3.1`. `MAJOR` is for breaking configuration or storage
changes, removed behavior, a higher minimum Chrome version, or material permission/privacy
changes. Every merge to `main` requires a version bump: use PATCH for ordinary compatible bundles
unless an approved release plan requires MINOR or MAJOR. Every uploaded Chrome package must use a
higher manifest version. `package.json` is the release source of truth, and `package-lock.json`
and `static/manifest.json` must remain synchronized with it. Validation fails if the manifest
version diverges.

The current release version is `0.3.1`. Future compatible fixes should use a PATCH increment, and
future compatible user-visible capabilities should use a MINOR increment.

## What it does

This standalone Manifest V3 extension semantically groups YouTube video tabs in the **current normal Chrome window**. Click the extension action, review the side-panel result, and matching tabs are placed in reusable native groups named `YT · <category>`. Rules and the bounded classification cache persist in `chrome.storage.local`.

Classification is local-first. By default the extension asks a locally running Ollama model to choose each video's primary subject from category descriptions written in natural language. It does not use a maintained keyword dictionary. Title is the strongest signal; description, channel, hashtags, and playlist context add context. An optional OpenAI-compatible remote classifier can be explicitly enabled as a fallback.

## What it does not do

It does not move tabs between windows; process non-YouTube pages; download media; inspect audio; transcribe videos; scrape comments or recommendations; collect analytics; or share state with `youtube-tab-collector`, `youtube-tab-grouper`, or `youtube-tab-grouper2`.

The runtime does not depend on Chrome Prompt, Language Detector, or Translator APIs. It does not install Ollama or download models for you.

## How semantic grouping works

Enabled rules contain an id, name, Chrome group color, and semantic description. The selected model returns one primary-topic rule per batch using a constrained JSON response. Overlaps are resolved by the model's primary-topic decision and rule order; a valid unclassifiable response uses `Uncategorized`. A provider, metadata, tab-race, or grouping operation failure leaves the affected tab unchanged.

Managed groups use the reserved `YT · ` prefix. Clean matching managed groups in the current window are reused. A matching user-created group is never repurposed when it contains unrelated tabs or has changed properties.

## Default categories

Programming, Fishing, Photography, History, Gaming, Technology, Science, Music, Entertainment, and Uncategorized are created on first use. Programming means software development; Technology covers broader devices and industry technology. Uncategorized is a deterministic semantic fallback, not a keyword-maintenance queue.

## Chrome requirements

Use desktop Chrome 138 or newer. Chrome's built-in AI availability and model downloads are not required. The extension is unavailable in incognito by design.

For local classification, install [Ollama](https://ollama.com/download) separately. The default endpoint is `http://127.0.0.1:11434` and the default model is `qwen2.5:3b-instruct`.

## Semantic classifier setup

Install Ollama, start its local server, and pull the default model before your first local run:

```powershell
ollama serve
ollama pull qwen2.5:3b-instruct
```

If Ollama is already running as a background service, only the model pull may be needed. Open **Edit categories** and use the **Semantic classifier** section to change the loopback endpoint or model. The extension only accepts loopback HTTP(S) endpoints for Ollama.

Choose one mode:

| Mode | Behavior |
| --- | --- |
| **Local only** | Use Ollama only. A local provider failure changes no tabs. |
| **Automatic** (default) | Use Ollama first. It tries the configured remote provider once only when local Ollama is unavailable or fails. Remote fallback is off until configured and explicitly enabled. |
| **Remote only** | Use the configured remote provider. Missing credentials or permission changes no tabs. |

### Optional remote fallback

Remote classification is intentionally off by default. To enable it, enter an HTTPS OpenAI-compatible base endpoint, model, and API key in **Edit categories**, enable remote fallback, save, and click **Allow remote endpoint** when Chrome asks. The extension requests access only for that configured origin at runtime. A loopback remote endpoint can also be used for a compatible local service.

Remote mode sends only the metadata needed to classify the currently processed video tabs—title, description when available, channel name, hashtags, playlist context—and the semantic category rules. It never sends a tab URL, browsing history, media, audio, comments, recommendations, or non-YouTube tab data. The API key is stored in `chrome.storage.local`, is never committed, and is never shown in diagnostics or logged by the extension.

## Privacy

In **Local only** mode, metadata and inference stay on the device through Ollama. In **Automatic** mode, the same is true unless you explicitly enable and authorize the remote fallback. **Remote only** sends the minimum classification metadata described above to the endpoint you choose.

There is no telemetry, analytics, browsing-history collection, or background tab monitoring. The extension only reads metadata when you explicitly start a current-window grouping run.

## Permissions

- `scripting`: read stable metadata from supported YouTube video pages.
- `sidePanel`: provide the explicit grouping workflow UI.
- `storage`: persist categories, classifier configuration, and the bounded 500-entry cache.
- `tabGroups`: create, reuse, and color managed native groups.
- `https://*.youtube.com/*` and `https://youtu.be/*`: inspect supported YouTube video pages.
- Loopback HTTP(S) host access for the local Ollama endpoint.
- `optional_host_permissions` declares `https://*/*`, but Chrome is asked at runtime only for the exact configured remote origin after opt-in. It is not a permanently granted broad host permission.

The extension intentionally does not request `tabs`, `activeTab`, Chrome built-in AI permissions, or an always-on remote host permission.

## Installation

1. Download or clone this repository.
2. Build it using the steps below.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the generated `dist/` directory.
4. Pin the extension action if desired.

## Development

Requirements: Node.js with npm, desktop Chrome 138+, and Ollama only if you want to exercise local classification. Install the lockfile dependencies with:

```powershell
npm ci
```

The source is TypeScript, bundled with esbuild, and tested with Vitest. Formatting and linting use Biome.

## Build and load

```powershell
npm ci
npm run validate
```

`npm run validate` checks formatting and linting, runs tests, type-checks, builds `dist/`, and verifies the distribution manifest. Load `dist/` through `chrome://extensions` as described above. Generated `dist/` and coverage output are ignored by Git.

## Usage

Open YouTube videos in one normal Chrome window and click the extension action. The side panel captures that window's tabs at that moment, shows its current phase and selected provider, then reports grouped, cached, skipped, failed, and Uncategorized totals. It can show a local-Ollama setup message or an Automatic-mode fallback message without exposing endpoints or credentials.

Use **Run again** after changing tabs or settings. Repeating a run with unchanged tabs, rules, and provider settings converges to the same layout.

### Metadata collection reliability

Every eligible tab first gets an immediate normalized baseline from its URL and saved tab title.
For non-discarded tabs, page enrichment uses `injectImmediately` with eight logical workers, so a
loading page is attempted without waiting for `document_idle`. Each attempt has a 3-second soft
deadline; after it, a usable saved tab title is used as title-only metadata. The whole phase has a
60-second metadata budget. On budget exhaustion, queued and no-longer-awaited enrichment attempts
resolve from their baselines, while tabs without a usable title remain unchanged.

Discarded tabs remain discarded: they are never injected or awakened, and use their saved tab
title when it is usable. A title-only result has a title-only cache fingerprint. When a later run
obtains richer page metadata, its different fingerprint triggers reclassification instead of using
the weaker cached decision.

During metadata collection, the panel shows completed, enriched, title-only, failed, active, and
timeout counts alongside the existing overall and current-operation timers. ETA is advisory and
based on settled enrichment attempts; timeouts are a subset of completed results. If the budget is
reached, the panel explains that remaining tabs are resolving from saved titles. Cancellation stops
the run before classification or grouping, and late page results are ignored. The 60-second limit
is a logical application deadline: a blocked browser event loop can delay timers, so actual elapsed
time remains authoritative.

## Configuration

Open **Edit categories** to rename, describe, recolor, reorder, enable, disable, add, or delete rules. The fallback rule cannot be deleted or disabled. **Restore defaults** resets categories and clears the cache; **Clear classification cache** removes cached decisions without changing rules.

The same page controls the classifier mode, local Ollama endpoint/model, opt-in remote endpoint/model/API key, exact-origin remote permission, and the diagnostics toggle. Saving semantic/provider settings clears the cache so a changed model or provider cannot reuse an old decision; changing concurrency alone preserves cached decisions.

### Performance controls

**Turbo mode is off by default.** When enabled, prompts use bounded transport fields (title 200
characters, description 600, channel 100, six hashtags of 60 characters, and playlist title 120)
and request an optional short reason. Turbo changes prompt size only; it does not change the
taxonomy or enable parallel processing.

**Concurrent batches** accepts an integer from **1 through 8** and defaults to 1. The setting is
provider-aware: local Ollama reports one effective worker and uses adaptive serial batches, so a
higher configured value never falsely promises local parallel inference. Remote classification
retains the configured bounded worker limit. Every provider preserves the original item order.

Local Ollama prepares one run-scoped prompt/rule context, keeps the selected model warm with
`keep_alive`, and sends independent stateless batches rather than growing conversational history.
The initial request contains at most four items; adaptive batch size starts at 4, grows after
complete successful batches, and shrinks after timeout or malformed output within the documented
1–12 bounds. Cached semantic decisions are reused when
their provider/model/schema/input fingerprint is unchanged; scheduling settings such as
concurrency do not invalidate them.

If a batch times out, the chain uses **recursive timeout splitting** (`4 → 2 → 1`) and isolates a
single-item failure so successful items can still be grouped. Incomplete responses use
**partial-response recovery**: valid items are retained and missing item IDs are retried on the
same provider. A provider-level failure may still trigger the configured one-time remote fallback.
Cancellation stops the run without mutating affected tabs.

## Cache migration

The cache is limited to 500 entries and contains only video ID, metadata fingerprint, rules fingerprint, and selected rule ID. It never contains raw titles, descriptions, channels, URLs, prompts, responses, API keys, translations, reasons, or timestamps.

The hybrid release fingerprints a cached decision with the active provider id, endpoint origin, model, and classifier schema version. Therefore cache entries from the former Chrome-built-in classifier do not match; changing provider/model configuration also causes a fresh semantic decision. This is intentional and does not alter category rules.

Changing concurrency alone does not invalidate a semantic cache decision. Changing Turbo mode,
provider, endpoint, or model does invalidate matching entries because it can change the classifier
input or output behavior.

## Diagnostics

Diagnostics are disabled by default. When enabled in settings, **Copy diagnostics** appears after a run. It copies an in-memory, local-only, redacted report with aggregate phase durations, provider health/selection/fallback, batch counts, failure categories, and run totals. Metadata diagnostics include candidate, enriched, title-only, timeout, injection-error, budget-fallback, no-title, maximum-logical-active, duration, and budget-exhausted counts.

The report never includes titles, URLs, or tab IDs; console traces follow the same rule. Copied diagnostics contain no titles, URLs, or tab IDs. Neither includes descriptions, channels, prompts, responses, token counts, API keys, reasons, or raw exception payloads. They are aggregate, sanitized, not uploaded, and cleared when the side panel closes.

## Page and edge-case behavior

- `/watch`, Shorts, live URLs, duplicate video tabs, and watch URLs with playlist parameters are eligible.
- Home, search, channel, standalone playlist, and other non-video YouTube pages remain untouched.
- Non-YouTube tabs are never moved.
- Loading tabs are injected immediately when possible; discarded tabs remain asleep and use a valid saved title only. A tab that closes or navigates during a run is skipped safely.
- Pinned YouTube tabs remain pinned and ungrouped.
- Only tabs captured from the focused normal Chrome window are processed; incognito is prohibited by the manifest.
- If no configured provider is available, or a provider fails for the current batch, the extension performs zero grouping mutations for that unclassified work.
- One metadata, tab, or group-operation failure does not prevent unrelated eligible tabs from completing.

## Troubleshooting

- **Ollama is unavailable:** start `ollama serve`, confirm the configured loopback endpoint, then run `ollama pull <your-model>`. The default is `ollama pull qwen2.5:3b-instruct`.
- **Model missing:** pull the model name shown in the side panel, or change the local model setting to one already installed in Ollama.
- **Remote fallback is unavailable:** verify that remote classification is enabled, endpoint/model/API key are filled in, and grant the exact-origin permission with **Allow remote endpoint**. Use HTTPS for non-loopback services.
- **A run leaves tabs unchanged:** inspect the side-panel provider status; operational failures deliberately do not force a weak category or mutate groups.
- **Metadata progress is slow or shows title-only results:** a page that does not enrich within three seconds falls back to its saved title. The complete phase resolves within the 60-second metadata budget unless the browser event loop itself is blocked; tabs with no usable title remain unchanged.
- **Unexpected grouping result after a settings change:** run again. Provider/model changes intentionally invalidate cached classifications.

## Known limitations

Ollama must be installed and a suitable model must be downloaded separately; model quality, speed, memory use, and multilingual accuracy vary by model and hardware. The remote adapter targets OpenAI-compatible `chat/completions` JSON responses and may not work with every vendor without compatible structured-output support. Remote classification has the privacy implications described above and requires a user-managed endpoint and credential.

There is no bundled offline model and no automated browser-level test for native Chrome tab-group behavior. Chrome itself must be used to verify group behavior, optional permission prompts, and provider connectivity.

The metadata deadlines bound what the extension awaits, not Chrome's underlying page-script work.
Chrome can settle an abandoned injection later, but its result cannot update a cancelled, timed-out,
or budget-exhausted run.

## Manual acceptance checklist

Manual Chrome acceptance remains pending for the Bundle 14 build. Test 2, 13, and 180+ eligible tabs, plus a 145-tab metadata-reliability case, using a CPU-local Ollama model. For each size, verify small batches complete, progress remains understandable, cached classifications
are skipped, timed-out batches split, failed tabs remain unchanged, and unrelated tabs/groups are
untouched. Also verify local-only grouping with `qwen2.5:3b-instruct`; unavailable Ollama causes no
mutation; Automatic mode falls back once only after a configured remote permission grant; Remote
only rejects missing configuration safely; and copied diagnostics are redacted. Verify unseen
English topics (`.NET Aspire`, perch crankbaits, Canon EOS R6), Russian/Belarusian/Japanese
metadata, Shorts/live/watch-playlist URLs, non-video pages untouched, discarded/loading/navigation
races, pinned tabs, duplicate tabs, preserved user groups, clean managed-group reuse, Uncategorized
fallback, rapid repeated invocation, deterministic second runs, and category edit/reorder/disable/
restore/cache clear. For the 145-tab case, include complete, loading, discarded, duplicate, and
unsupported tabs; verify visible metadata progress, completion near the logical budget, title-only
fallback, cancellation, ignored late results, cache convergence, and preserved pinned, unsupported,
non-YouTube, and unrelated grouped tabs.

Record manual Chrome results in the release handoff. If Chrome cannot be launched in the development environment, perform this checklist locally before release.
