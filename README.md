# YouTube Tab Grouper 3

## What it does

This standalone Manifest V3 extension semantically groups YouTube video tabs in the **current normal Chrome window**. Click the extension action, review the side-panel result, and matching tabs are placed in reusable native groups named `YT · <category>`. Rules and the bounded classification cache persist in `chrome.storage.local`.

It uses Chrome's on-device Prompt API, Language Detector API, and Translator API. Classification is driven by each category's natural-language description, not a maintained keyword dictionary. Title is the strongest signal; description and channel are contextual metadata.

## What it does not do

It does not move tabs between windows, process non-YouTube pages, download media, inspect audio, transcribe videos, scrape comments or recommendations, collect analytics, or use a cloud classifier. It has no dependency on `youtube-tab-collector`, `youtube-tab-grouper`, or `youtube-tab-grouper2`.

## How semantic grouping works

Enabled rules contain an id, name, Chrome group color, and semantic description. Chrome's local model chooses one primary topic for a batch of metadata. Overlaps are resolved deterministically by the model's constrained response and rule order; unclassifiable items use `Uncategorized`. Operational failures leave the affected tab unchanged. Cached decisions are keyed by video id, metadata fingerprint, and rules fingerprint, so edits invalidate stale classifications.

## Default categories

Programming, Fishing, Photography, History, Gaming, Technology, Science, Music, Entertainment, and Uncategorized are created on first use. Programming means software development; Technology covers broader devices and industry technology. Uncategorized is a fallback, not a keyword-maintenance queue.

## Chrome requirements

Use desktop Chrome 138 or newer with the built-in AI features available for your platform, hardware, language model, and profile. The first run may require a local model download and a user-activation click on **Prepare AI**. There is no cloud fallback or API key configuration.

Authoritative references: [Prompt API](https://developer.chrome.com/docs/ai/prompt-api), [Language Detector API](https://developer.chrome.com/docs/ai/language-detection), [Translator API](https://developer.chrome.com/docs/ai/translator-api), [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), and [Tab Groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups).

## Privacy

Only metadata from explicitly processed YouTube tabs is inspected. Title, description, channel name, hashtags, and playlist context may be normalized locally for classification. Inference and translation remain on-device; no browsing history, telemetry, analytics, or external classifier endpoint is used.

## Permissions

- `scripting`: read stable YouTube page metadata from supported video pages.
- `sidePanel`: provide the explicit grouping workflow UI.
- `storage`: persist rules and the local 500-entry cache.
- `tabGroups`: create, reuse, and color managed native groups.
- `https://*.youtube.com/*`: read supported YouTube video-page metadata.
- `https://youtu.be/*`: support YouTube's short-link form when it resolves to a video.

The extension intentionally does not request `tabs` or `activeTab`; it uses the permitted tab APIs and scripting only for the current window and approved YouTube hosts.

## Installation

1. Download or clone this repository.
2. Follow the development build steps below.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the generated `dist/` directory.
4. Pin the extension action if desired.

## Development

Requirements: Node.js with npm and Chrome 138+. Install the lockfile dependencies with:

```powershell
npm ci
```

The source is TypeScript, bundled with esbuild, and tested with Vitest. Formatting and linting use Biome.

## Build and load

```powershell
npm ci
npm run validate
```

`npm run validate` formats/checks source, runs tests, type-checks, builds `dist/`, and verifies the distribution manifest. Load `dist/` through `chrome://extensions` as described above. Generated `dist/` and coverage output are ignored by Git.

## Usage

Open YouTube videos in one normal Chrome window, click the extension action, and let the side panel process the captured tabs. If AI preparation is requested, click **Prepare AI** while the panel is active. The panel reports progress, grouped/cached/skipped/failed totals, and offers **Run again** or **Edit categories**. Repeating a run with unchanged tabs and rules converges to the same layout.

## Configuration

Open **Edit categories** to rename, describe, recolor, reorder, enable, disable, add, or delete rules. The fallback rule cannot be deleted or disabled. **Restore defaults** resets categories and clears the cache; **Clear classification cache** removes cached decisions without changing rules. Managed groups use the reserved `YT · ` prefix. Clean matching groups in the current window are reused. Eligible YouTube tabs may be moved out of an existing user-created group, but that group’s non-YouTube members and group properties are preserved; a contaminated matching group is left untouched rather than riskily repurposed.

The cache is limited to 500 entries and stores only video ID, metadata fingerprint, rules fingerprint, and selected rule ID. It does not store raw titles, descriptions, channels, URLs, translations, reasons, or timestamps.

## Page and edge-case behavior

- `/watch`, Shorts, live URLs, duplicate video tabs, and watch URLs with playlist parameters are eligible.
- Home, search, channel, standalone playlist, and other non-video YouTube pages remain untouched.
- Non-YouTube tabs are never moved.
- Loading or discarded tabs use available stable tab/title metadata; a tab that closes or navigates during a run is skipped safely.
- Pinned YouTube tabs remain pinned and ungrouped.
- Only tabs captured from the focused normal window are processed; incognito is prohibited by the manifest.
- Missing, unavailable, or unprepared AI causes zero group mutation until the user resolves it.
- One broken tab does not prevent other tabs from completing; operational failures leave that tab unchanged.

## Known limitations

Chrome's built-in AI availability, model download size, supported languages, and quality vary by Chrome channel, hardware, and profile. There is no offline fallback classifier beyond the available local model, and no automated browser-level acceptance test in this repository. Chrome itself must be used to verify native group behavior.

## Manual acceptance checklist

In a temporary Chrome profile, verify: no-YouTube and one-video runs; unseen English topics (`.NET Aspire`, perch crankbaits, Canon EOS R6); Russian/Ukrainian/Japanese metadata; Shorts/live/watch-playlist URLs; non-video pages untouched; discarded/loading/navigation races; pinned tabs; duplicate tabs; preserved user groups; clean managed-group reuse; Uncategorized fallback; unavailable AI with no mutation; rapid repeated invocation; deterministic second runs; category edit/reorder/disable/restore/cache clear; and stable handling of ambiguous topics such as “History of programming languages”. Record the result in the release handoff. If Chrome cannot be launched in the development environment, perform this checklist locally.
