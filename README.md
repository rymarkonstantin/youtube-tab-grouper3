# YouTube Tab Grouper 3

## Versioning and releases

The extension and package use synchronized three-part Semantic Versioning. `PATCH` is for
backward-compatible bug fixes, diagnostics, performance work, or small UI corrections. `MINOR`
is for new backward-compatible user-visible capabilities; the hybrid classifier, timers, and
classifier settings are included in `0.2.0`. `MAJOR` is for breaking configuration or storage
changes, removed behavior, a higher minimum Chrome version, or material permission/privacy
changes. Documentation-only, test-only, and development-only changes do not require a version
bump unless they are packaged for a Chrome release. Every uploaded Chrome package must use a
higher manifest version. `package.json` is the release source of truth. Validation fails if the
manifest version diverges.

The current development version remains `0.2.0`. These performance and quality fixes become
`0.2.1` only when packaged for distribution; packaging is the point at which the manifest must be
bumped to a higher version.

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

## Configuration

Open **Edit categories** to rename, describe, recolor, reorder, enable, disable, add, or delete rules. The fallback rule cannot be deleted or disabled. **Restore defaults** resets categories and clears the cache; **Clear classification cache** removes cached decisions without changing rules.

The same page controls the classifier mode, local Ollama endpoint/model, opt-in remote endpoint/model/API key, exact-origin remote permission, and the diagnostics toggle. Saving classifier settings clears the cache so a changed model or provider cannot reuse an old decision.

### Performance controls

**Turbo mode is off by default.** When enabled, prompts use bounded transport fields (title 200
characters, description 600, channel 100, six hashtags of 60 characters, and playlist title 120)
and request an optional short reason. Turbo changes prompt size only; it does not change the
taxonomy or enable parallel processing.

**Concurrent batches** accepts an integer from **1 through 8** and defaults to 1 (sequential
processing). The provider chain schedules bounded batches of **at most four items** and preserves
the original item order. The same concurrency limit applies to local and remote providers.

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

Diagnostics are disabled by default. When enabled in settings, **Copy diagnostics** appears after a run. It copies an in-memory, local-only, redacted report with aggregate phase durations, provider health/selection/fallback, batch counts, failure categories, and run totals.

The report never includes titles, descriptions, channels, URLs, prompts, responses, token counts,
API keys, reasons, or raw exception payloads. It is not uploaded and is cleared when the side panel
closes. Console traces are likewise aggregate and sanitized.

## Page and edge-case behavior

- `/watch`, Shorts, live URLs, duplicate video tabs, and watch URLs with playlist parameters are eligible.
- Home, search, channel, standalone playlist, and other non-video YouTube pages remain untouched.
- Non-YouTube tabs are never moved.
- Loading or discarded tabs use available stable tab/title metadata; a tab that closes or navigates during a run is skipped safely.
- Pinned YouTube tabs remain pinned and ungrouped.
- Only tabs captured from the focused normal Chrome window are processed; incognito is prohibited by the manifest.
- If no configured provider is available, or a provider fails for the current batch, the extension performs zero grouping mutations for that unclassified work.
- One metadata, tab, or group-operation failure does not prevent unrelated eligible tabs from completing.

## Troubleshooting

- **Ollama is unavailable:** start `ollama serve`, confirm the configured loopback endpoint, then run `ollama pull <your-model>`. The default is `ollama pull qwen2.5:3b-instruct`.
- **Model missing:** pull the model name shown in the side panel, or change the local model setting to one already installed in Ollama.
- **Remote fallback is unavailable:** verify that remote classification is enabled, endpoint/model/API key are filled in, and grant the exact-origin permission with **Allow remote endpoint**. Use HTTPS for non-loopback services.
- **A run leaves tabs unchanged:** inspect the side-panel provider status; operational failures deliberately do not force a weak category or mutate groups.
- **Unexpected grouping result after a settings change:** run again. Provider/model changes intentionally invalidate cached classifications.

## Known limitations

Ollama must be installed and a suitable model must be downloaded separately; model quality, speed, memory use, and multilingual accuracy vary by model and hardware. The remote adapter targets OpenAI-compatible `chat/completions` JSON responses and may not work with every vendor without compatible structured-output support. Remote classification has the privacy implications described above and requires a user-managed endpoint and credential.

There is no bundled offline model and no automated browser-level test for native Chrome tab-group behavior. Chrome itself must be used to verify group behavior, optional permission prompts, and provider connectivity.

## Manual acceptance checklist

Run the manual matrix with **2, 13, and 180+ eligible tabs** using a CPU-local Ollama model. For
each size, verify small batches complete, progress remains understandable, cached classifications
are skipped, timed-out batches split, failed tabs remain unchanged, and unrelated tabs/groups are
untouched. Also verify local-only grouping with `qwen2.5:3b-instruct`; unavailable Ollama causes no
mutation; Automatic mode falls back once only after a configured remote permission grant; Remote
only rejects missing configuration safely; and copied diagnostics are redacted. Verify unseen
English topics (`.NET Aspire`, perch crankbaits, Canon EOS R6), Russian/Belarusian/Japanese
metadata, Shorts/live/watch-playlist URLs, non-video pages untouched, discarded/loading/navigation
races, pinned tabs, duplicate tabs, preserved user groups, clean managed-group reuse, Uncategorized
fallback, rapid repeated invocation, deterministic second runs, and category edit/reorder/disable/
restore/cache clear.

Record manual Chrome results in the release handoff. If Chrome cannot be launched in the development environment, perform this checklist locally before release.
