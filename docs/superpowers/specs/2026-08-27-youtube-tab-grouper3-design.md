# YouTube Tab Grouper 3 — Design Specification

**Date:** 2026-08-27
**Status:** Approved for implementation planning

## Summary

`youtube-tab-grouper3` will be a standalone Chrome Manifest V3 extension that groups actual YouTube video tabs in the current normal Chrome window by primary subject matter. It will use Chrome's built-in, on-device AI APIs rather than a remote service or a maintained keyword dictionary.

Clicking the extension icon opens a side panel. When the required local models are ready, grouping starts automatically. If Chrome must download a model or translation pack, the side panel requests the required user interaction and displays progress. The extension inspects only eligible YouTube tabs in that window, classifies them against persistent semantic rules, and places them into native Chrome tab groups titled `YT · <category>`.

The repository was empty except for `.git` when this design was created, so there is no existing implementation to preserve.

## Goals

- Classify YouTube videos semantically from their topic, not from a curated keyword vocabulary.
- Process only the current normal Chrome window.
- Support normal watch pages, Shorts, and live-video pages.
- Leave non-YouTube tabs and unsupported YouTube pages out of the processing set.
- Store editable category definitions and a bounded classification cache in `chrome.storage.local`.
- Use Chrome's Prompt, Language Detector, and Translator APIs entirely on-device.
- Create or safely reuse native Chrome groups without overwriting unrelated user groups.
- Converge to the same tab layout when inputs and rules have not changed.
- Isolate pure logic so URL recognition, validation, response handling, caching, and grouping plans are thoroughly testable outside Chrome.
- Request only narrowly scoped Manifest V3 permissions.

## Non-goals

- Moving tabs between windows. That remains the responsibility of `youtube-tab-collector`.
- Sharing runtime state, configuration, code, APIs, or storage with `youtube-tab-collector`, `youtube-tab-grouper`, or `youtube-tab-grouper2`.
- Continuous background monitoring.
- Classifying YouTube home, search, channel, standalone playlist, or other non-video pages.
- Downloading video media, analyzing images or audio, transcribing, scraping comments, or analyzing recommendations.
- Cloud classification, API keys, analytics, or telemetry.
- Incognito operation.
- A framework-based UI.

## Browser and AI constraints

The extension targets Chrome desktop 138 or newer. Chrome 138 is the first stable release with the Prompt API available to Chrome extensions. The Prompt API is not available in extension service workers, so inference must run in an extension document. The side panel is that document.

Chrome manages and downloads Gemini Nano and the specialized language models. The extension must feature-detect every built-in AI API and use its `availability()` result rather than assuming that a device can run it. Foundation-model availability depends on Chrome, the operating system, hardware, storage, and initial download connectivity.

When an availability result is `downloadable` or `downloading`, session creation may require meaningful user activation. The side panel pauses and presents a button before triggering that download. This rule also applies if a previously unseen language needs a Translator language pack during an otherwise automatic run.

There is no cloud fallback. If a required API or model is unavailable, the extension explains the condition and makes no grouping changes.

## Architecture

```text
Extension action
    ↓
Side-panel run coordinator
    ├── capture current normal window
    ├── load and validate rules
    ├── discover eligible tabs
    ├── inject on-demand metadata reader
    ├── resolve local cache hits
    ├── detect and normalize languages
    ├── classify through the Prompt API
    ├── build a pure grouping plan
    ├── revalidate tab identity
    ├── apply native tab groups
    └── display status

Service worker
    └── configure action-click side-panel behavior

Options page
    └── edit rules, restore defaults, and clear cache
```

### Component responsibilities

The side panel owns the full run because it is both a document capable of using the built-in AI APIs and a durable place to show downloads and progress. It directly invokes narrow adapters for Chrome tabs, scripting, storage, AI, and tab groups.

The service worker does not classify or coordinate a run. It only configures the extension action to open the side panel. This keeps service-worker restarts irrelevant to in-progress AI state.

The metadata reader is programmatically injected only when the user invokes the extension and only into eligible YouTube pages. No persistent content script runs on every navigation.

The options page reads and writes the same validated storage model as the side panel. It contains no classifier logic.

The classifier is exposed behind one purposeful boundary:

```ts
interface VideoClassifier {
  classify(
    videos: VideoMetadata[],
    rules: GroupRule[],
    fallbackRuleId: string,
  ): Promise<ClassificationResult[]>;
}
```

The boundary supports test doubles and a future classifier replacement without introducing a general plugin system.

## Run sequence

1. The user clicks the extension action.
2. Chrome opens the side panel associated with that browser window.
3. The side panel captures the active tab's `windowId`, verifies that it belongs to a normal, non-incognito window, and uses that fixed ID for the complete run.
4. Storage loads and validates the rule configuration. Missing configuration is initialized once from defaults. Invalid existing configuration stops the run and links to repair controls; it is never silently overwritten.
5. The extension queries that window and snapshots tab identity, URL, index, group, pin, load, discard, and incognito state.
6. Pure URL parsing selects eligible video pages. Pinned tabs are removed from the processing set.
7. Available metadata is collected. Discarded tabs are not awakened and use their existing tab title. Loading tabs use whatever stable metadata is available, with the tab title as fallback.
8. Cache entries are resolved using the video ID plus metadata and classification-rule fingerprints. Uncached tab copies with the same video and metadata fingerprints are collapsed into one classification work item and receive the same result.
9. Remaining metadata and custom rule text are language-detected. Unsupported Prompt API inputs are translated locally to English when Chrome supports the required pair.
10. Remaining unique work items are classified in small context-aware batches.
11. The extension validates the complete response set and performs one isolated per-video retry for missing or failed results.
12. A pure grouping plan is generated from successful results and the original tab order.
13. Immediately before mutation, each target tab is queried again. Closed, moved, navigated, or newly pinned tabs are removed from the plan.
14. Native groups are created or reused and moved into their deterministic positions.
15. The side panel and action badge report the outcome.

Metadata collection and classification complete before any group mutation begins. Closing the side panel before application therefore leaves groups unchanged. Chrome does not provide an atomic multi-group transaction; if the panel closes or a Chrome API call fails during application, a later run converges the partial state.

## Persistent rule model

```ts
type GroupColor = chrome.tabGroups.ColorEnum;

interface GroupRule {
  id: string;
  name: string;
  description: string;
  color: GroupColor;
  enabled: boolean;
}

interface RuleConfig {
  schemaVersion: 1;
  fallbackRuleId: string;
  rules: GroupRule[];
}
```

Rule IDs are immutable. Default IDs are readable slugs; user-created IDs use `crypto.randomUUID()`. The options page never exposes ID editing.

Rule array order serves three purposes:

- final managed-group order;
- options-page display order;
- the deterministic tie-break when two semantic topics are otherwise equally primary.

There are no v1 `examples`, `exclude`, or numeric `priority` fields. Examples and exclusions would increase configuration surface without a demonstrated classification problem. Ordered rules provide the only needed tie-breaker.

Validation requires:

- a supported schema version;
- at least the configured fallback rule;
- unique immutable IDs;
- unique names after trimming and case folding, because names become group titles;
- between 1 and 60 trimmed characters per name and between 1 and 600 trimmed characters per description, without control characters;
- no more than 24 total rules, including disabled rules and the fallback;
- a valid Chrome tab-group color;
- a fallback ID that resolves to an enabled rule.

The fallback may be renamed, recolored, and reordered, but it cannot be disabled or deleted while selected as the fallback.

## Default taxonomy

| ID | Name | Color | Semantic description |
|---|---|---|---|
| `programming` | Programming | green | Software development, programming languages, frameworks, software architecture, developer tools, coding tutorials, and software engineering. |
| `fishing` | Fishing | blue | Recreational fishing, fishing techniques, tackle, lures, fish species, fishing equipment, and fishing trips. |
| `photography` | Photography | pink | Cameras, lenses, analog and digital photography, lighting, composition, shooting techniques, and photographic editing. |
| `history` | History | yellow | Historical people, events, civilizations, periods, primary sources, and historical analysis. |
| `gaming` | Gaming | purple | Video games, gameplay, esports, reviews, game design, and game lore. Software implementation is primarily Programming. |
| `technology` | Technology | cyan | Consumer and industry technology, electronics, devices, computing products, and technology trends that are not mainly software development. |
| `science` | Science | orange | Scientific subjects, research, experiments, mathematics, nature, medicine, and space. |
| `music` | Music | red | Music, performances, instruments, composition, theory, recording, and production. |
| `entertainment` | Entertainment | grey | Film, television, comedy, celebrity, and pop culture. This is a subject category, not a label for anything entertaining. |
| `uncategorized` | Uncategorized | grey | Use only when no enabled topical category is sufficiently appropriate. |

The classifier prompt explicitly treats topic or subject matter as primary. Format, intent, and channel are secondary evidence. A camera review is Photography rather than Reviews. Game-engine code is Programming, while game lore is Gaming. For cross-topic videos, the model selects the subject receiving the strongest substantive emphasis.

## Supported pages and video identity

Eligible URL forms are:

- `https://youtube.com/watch?v=<videoId>` and subdomain equivalents;
- `https://youtube.com/shorts/<videoId>` and subdomain equivalents;
- `https://youtube.com/live/<videoId>` and subdomain equivalents;
- unresolved `https://youtu.be/<videoId>` links.

Hostname checks use exact host boundaries rather than substring matching. A normal watch URL remains eligible when it contains playlist, live, timestamp, or tracking parameters. The canonical video ID is derived only from the `v` parameter or the relevant path segment.

Unsupported pages include home, search, channel, standalone playlist, feed, account, studio, and arbitrary YouTube paths. They are reported as skipped and never injected or grouped.

## Metadata model and extraction

```ts
interface VideoMetadata {
  videoId: string;
  pageType: "watch" | "short" | "live";
  title: string;
  description?: string;
  channelName?: string;
  hashtags?: string[];
  playlistTitle?: string;
}
```

The injected reader prefers stable page metadata:

1. canonical and Open Graph metadata;
2. Schema.org or equivalent semantic metadata;
3. the current document title;
4. the `chrome.tabs.Tab.title` snapshot.

It does not depend on YouTube's generated CSS class names. Before classification, whitespace is normalized and fields are bounded to 300 characters for title, 1,500 for description, 200 for channel, 300 for playlist title, and ten hashtags of at most 100 characters each. Hashtags are taken only from semantic metadata or the bounded description. Playlist title is included only when stable page metadata exposes it; a raw playlist ID is not useful semantic context and is not sent to the model.

Title is required for classification and is explicitly identified as the strongest signal. Channel is contextual evidence and can never deterministically select a category.

The model receives an opaque run-local item ID, title, bounded description, channel, hashtags, and playlist title. It does not receive the tab ID, URL, video ID, cookies, page HTML, comments, recommendations, or media.

## Language handling

Chrome's Prompt API currently accepts English, Japanese, Spanish, German, and French. Support is still feature-detected because Chrome can change capabilities.

For each uncached video, the extension detects the dominant language of its joined metadata:

- Prompt-supported input remains in its original language.
- Other supported Translator inputs are translated locally to English.
- Custom category names and descriptions that use an unsupported Prompt language are likewise translated for that run.
- If detection is inconclusive, the extension first treats the text as English and handles a resulting `NotSupportedError` through the isolated retry path.
- If the required translation pair is unavailable, that item is an operational failure and is left unchanged.

Translation and detection sessions are destroyed after the run. Translated text is not persisted.

## Semantic classification

The selected approach is direct, constrained classification in small batches.

Each fresh Prompt API session receives a system prompt containing:

- the topic-first decision rule;
- all enabled semantic rule IDs, names, and descriptions in their configured order;
- instructions to select exactly one primary rule;
- instructions to use the fallback only when no topical rule is sufficiently appropriate;
- instructions that format and channel are secondary;
- instructions to return only the constrained structure.

Each user prompt contains a small array of normalized video metadata. The output uses a JSON Schema equivalent to:

```ts
interface BatchClassificationResponse {
  results: Array<{
    itemId: string;
    ruleId: string;
    reason: string;
  }>;
}
```

The schema restricts `ruleId` to the enabled IDs, including the fallback. Runtime validation additionally requires exactly one result for every requested item and rejects duplicate item IDs, unknown IDs, missing entries, extra entries, empty reasons, and malformed JSON.

The classifier requests `temperature: 0` and `topK: 1`, after confirming those values against `LanguageModel.params()`. It creates a fresh session for each batch so prior classifications cannot influence later batches. It starts with at most eight unique videos, measures context usage with the response constraint included, and repeatedly reduces the batch before prompting when necessary. If the rule prompt alone cannot fit, the run reports a configuration error instead of silently omitting rules.

If a batch call or response fails, only unresolved items are retried once, individually, in fresh sessions. A failed retry produces an operational failure, not a fabricated semantic fallback.

No numeric confidence is requested or exposed. Gemini Nano does not provide a calibrated confidence value suitable for a product threshold. Semantic uncertainty is represented by the explicit fallback rule.

Reasons exist only for current-run diagnostics and are never cached.

## Classification cache

Successful classifications are stored locally as bounded entries:

```ts
interface ClassificationCacheEntry {
  videoId: string;
  metadataFingerprint: string;
  rulesFingerprint: string;
  ruleId: string;
}
```

The metadata fingerprint is a SHA-256 digest of normalized classifier metadata. The classification-rule fingerprint is a SHA-256 digest of the ordered enabled rule IDs, names, descriptions, and fallback selection. Color changes do not invalidate semantic results; name, description, enabled state, order, or fallback changes do.

The cache stores no title, description, channel, URL, translation, reason, or timestamp. Its array order supplies least-recently-used eviction. A hit is promoted to the front. The cache is capped at 500 entries.

Failures are never cached. Entries referencing deleted rules are misses. Restoring defaults or selecting Clear cache removes all entries. Editing rules safely invalidates old entries by fingerprint even if they remain until normal eviction.

## Group ownership and reuse

Chrome exposes no persistent extension-owned metadata field for a tab group, and group IDs last only for a browser session. The design therefore reserves a visible title prefix:

```text
YT · Programming
YT · Fishing
YT · Uncategorized
```

Only an exact current-window title `YT · <current rule name>` is a reuse candidate. A candidate is reusable only when:

- it is not a shared group;
- it contains no pinned tab;
- it contains no non-YouTube tab;
- it contains no unsupported YouTube page;
- it contains no tab excluded from the successful current plan.

A candidate containing any protected tab is left completely untouched, and the extension creates a clean group with the same expected title. This can temporarily yield duplicate titles, but it preserves unrelated content. On later runs, the clean group remains the reusable candidate.

When several clean candidates exist, the planner chooses the leftmost candidate deterministically. Eligible tabs are moved out of other duplicates; groups that become empty are removed automatically by Chrome. If a stored candidate disappears while another category is being applied, application validates it and creates a replacement instead of failing the entire run.

Only clean prefix-owned groups have their title and color synchronized with configuration. Their collapsed state is preserved. New groups use Chrome's default expanded state.

Renaming a category creates or reuses its new expected title. Eligible YouTube tabs leave the old group. An old group disappears if emptied, but it remains unchanged if it contains protected tabs.

## Deterministic grouping plan

The grouping planner is pure: it receives tab snapshots, group snapshots, successful classifications, and rules, then returns intended tab assignments and group positions without invoking Chrome.

The plan follows these rules:

1. Include every successfully classified, unpinned eligible video tab, including duplicate copies of the same video.
2. Preserve original tab order within each category.
3. Include only categories that have at least one successful target tab.
4. Order categories according to persistent rule order.
5. Anchor the complete managed block at the original index of the first eligible unpinned YouTube video tab.
6. Preserve the relative order of every non-YouTube and otherwise protected tab.

Grouping eligible YouTube tabs can shift the displayed indices of surrounding tabs, but non-YouTube IDs are never passed to group, ungroup, or move calls. A user-created group may lose an eligible YouTube tab because the product intentionally manages all eligible video tabs; its non-YouTube members, title, color, and collapsed state are not changed.

Immediately before application, each target must still:

- exist;
- belong to the captured window;
- be unpinned;
- resolve to the same canonical video ID;
- remain an eligible page.

Invalidated targets are removed. The remaining plan preserves its original rule and tab ordering.

Group application is sequential and failure-isolated by category. One failed group is reported while later groups continue. Repeating the command after a partial failure converges toward the same plan.

## User interface

### Side panel

The side panel has a compact state machine:

- **Checking:** inspect Chrome AI capabilities and current-window candidates.
- **Needs activation:** show a Prepare AI and group tabs button for required downloads.
- **Running:** show phase, progress, Cancel, and a disabled duplicate-run action.
- **Complete:** show grouped, cached, uncategorized, skipped, and failed counts, plus Run again.
- **Unavailable:** explain the missing API or device/model requirement without changing tabs.
- **Configuration error:** explain the validation issue and link to Edit categories.

If all assets required by the current run are already available, opening the side panel begins automatically. If a new translation pack is discovered mid-run, the run pauses safely before grouping and asks for another user activation.

Closing the side panel aborts active AI requests through `AbortController`. An in-memory run guard prevents a second invocation in the same side-panel document. Chrome supplies one extension side-panel document per window, so different normal windows can be processed independently when explicitly invoked in each.

The action badge shows an activity marker while running, the grouped count on success, and `!` when a run finishes incompletely. The normal result remains visible in the tab strip, so there is no completion popup.

### Options page

The options page uses plain HTML, CSS, and TypeScript. It supports:

- adding a semantic category;
- editing name, description, color, and enabled state;
- deleting non-fallback categories;
- moving categories up and down with accessible buttons;
- saving only after full validation;
- restoring defaults after confirmation;
- clearing the classification cache;
- showing that order controls tie-breaking and group order;
- showing that the `YT · ` prefix is reserved for managed groups.

Changes are explicit-save rather than autosave. A failed save retains the edited form and presents field-level errors. Successful saves use one `chrome.storage.local.set()` call for the complete configuration envelope.

## Status and error policy

| Situation | Behavior |
|---|---|
| No eligible YouTube tabs | No mutation; report No video tabs found. |
| One eligible tab | Classify and create or reuse a one-tab group. |
| Unsupported YouTube page | Leave untouched; count as skipped. |
| Pinned YouTube video | Leave untouched; count as skipped. |
| Discarded video tab | Do not wake it; classify from the existing title when possible. |
| Loading video tab | Use available stable metadata and title fallback. |
| Empty or unusable title | Leave unchanged; report insufficient metadata. |
| No suitable semantic rule | Assign to `Uncategorized`. |
| Required AI API unavailable | Leave the whole window unchanged; show requirements. |
| Required translation pair unavailable | Leave that tab unchanged; continue other tabs. |
| Batch response malformed | Retry unresolved items individually once. |
| Individual retry fails | Leave that tab unchanged; continue. |
| Tab closes | Remove it during revalidation or catch the Chrome error. |
| Tab navigates to another video | Skip it during revalidation; the next run handles it. |
| Tab moves to another window | Skip it; never move it back. |
| Invocation repeated quickly | Existing run remains authoritative; duplicate action is disabled. |
| Existing user group | Move only eligible YouTube members; preserve all other properties and tabs. |
| Contaminated matching managed group | Leave it untouched and create/reuse a clean managed group. |
| Duplicate video tabs | Classify once through cache where possible; group every tab copy. |
| Group API failure | Report that category, continue later categories, converge next run. |
| Invalid stored rules | Do not overwrite; stop and offer repair or restore. |
| Incognito | Extension cannot be enabled because the manifest declares `not_allowed`. |

## Manifest and permissions

The intended manifest capabilities are:

```json
{
  "manifest_version": 3,
  "minimum_chrome_version": "138",
  "permissions": [
    "scripting",
    "sidePanel",
    "storage",
    "tabGroups"
  ],
  "host_permissions": [
    "https://*.youtube.com/*",
    "https://youtu.be/*"
  ],
  "incognito": "not_allowed"
}
```

Permission purposes are:

- `scripting`: inject the metadata reader at invocation time;
- `sidePanel`: open and host the AI workflow;
- `storage`: persist rules and the local cache;
- `tabGroups`: query and update native group metadata;
- YouTube host permissions: read URL/title for matching tabs and inject only on those hosts.

The `tabs` permission is intentionally omitted. Host permissions expose sensitive URL/title fields only for matching YouTube tabs, while non-sensitive tab enumeration and grouping APIs do not require the broad browsing-activity permission. `activeTab` is insufficient because the command intentionally processes more than the active tab and is therefore also omitted.

The expired `aiLanguageModelOriginTrial` permission is not included. There are no permissions for notifications, history, web requests, cookies, downloads, clipboard, or arbitrary hosts.

## Privacy and security

- The extension has no external classifier, API key, analytics, telemetry, or application network client.
- Chrome itself downloads and manages local AI models and language packs. Video metadata is processed on-device and is not sent to Google or another third party for inference.
- Only metadata from explicitly processed YouTube video tabs is read.
- The cache contains video IDs, hashes, and rule IDs, is capped, and can be cleared by the user.
- Incognito operation is disabled because `chrome.storage.local` is otherwise shared with regular mode.
- No remote script, `eval`, dynamic code loading, or remotely hosted executable code is permitted.
- Extension HTML uses the default Manifest V3 content security policy and DOM text APIs for status and user data.
- Model reasons and exception messages are rendered as text, not injected HTML.

## Project structure and tooling

The implementation will use strict TypeScript, plain HTML/CSS, and no production package dependencies.

```text
src/
├── background.ts
├── sidepanel/
│   ├── main.ts
│   └── styles.css
├── options/
│   ├── main.ts
│   └── styles.css
├── metadata/
│   ├── youtube-url.ts
│   ├── page-extractor.ts
│   └── normalize.ts
├── classifier/
│   ├── classifier.ts
│   ├── chrome-built-in.ts
│   ├── language.ts
│   └── response.ts
├── rules/
│   ├── defaults.ts
│   ├── validation.ts
│   └── storage.ts
├── grouping/
│   ├── plan.ts
│   ├── ownership.ts
│   └── apply.ts
├── cache/
│   ├── fingerprint.ts
│   └── storage.ts
└── types.ts

static/
├── manifest.json
├── sidepanel.html
├── options.html
└── icons/

tests/
scripts/
docs/superpowers/specs/
```

The exact file split may combine a very small pair of modules during implementation, but the responsibility boundaries remain as specified.

Development dependencies are limited to:

- TypeScript for strict type checking;
- esbuild for deterministic bundles with fixed filenames;
- Vitest for automated tests;
- Biome for formatting and linting;
- Chrome and Chromium built-in-AI type declarations.

A small Node build script bundles the background, side-panel, and options entry points, then copies verified static files into `dist/`. The metadata extractor is a self-contained serializable function passed to `chrome.scripting.executeScript`, avoiding a permanent content script.

`dist/`, coverage output, and local caches are ignored. `package-lock.json` is committed. There are no runtime dependencies or secrets.

## Automated testing

Pure tests cover at least:

- exact YouTube hostname matching and lookalike rejection;
- watch, Shorts, live, short-link, and unsupported URL recognition;
- canonical video ID parsing and playlist-context behavior;
- metadata normalization and bounded fields;
- first-use rule initialization without later overwrite;
- rule validation, unique names, immutable IDs, ordering, and fallback protection;
- language-routing decisions through fake Language Detector and Translator adapters;
- prompt construction and current enabled-rule ordering;
- constrained response parsing, including malformed JSON, missing items, duplicates, extra items, and unknown rules;
- semantic fallback versus operational failure;
- cache fingerprints, hits, invalidation, deleted rules, promotion, eviction, and absence of raw metadata;
- managed-group ownership, contaminated and shared groups, duplicates, user groups, and renamed categories;
- grouping plans for zero, one, and many tabs;
- pinned, discarded, loading, duplicate, closed, moved, and navigated tabs;
- preservation of non-YouTube relative order;
- deterministic results across repeated plan generation;
- per-category application failure isolation through mocked Chrome adapters.

Chrome's built-in model quality is not asserted by unit tests. Prompt fixtures test the contract, schema, and parser. A manual acceptance matrix tests representative semantic examples such as unseen terminology, overlapping subjects, and multilingual titles.

## Validation before implementation completion

The finished implementation must pass:

1. dependency installation from the committed lockfile;
2. Biome format check;
3. Biome lint check;
4. Vitest suite;
5. strict TypeScript type checking;
6. clean production build;
7. built-manifest JSON and referenced-file integrity checks;
8. permission review against this design;
9. repository scan for secret-like values and accidental API keys;
10. `.gitignore` review for generated artifacts.

When Chrome can be launched, manual validation also covers:

- first model download and progress;
- model-already-available automatic runs;
- multilingual detection and translation;
- watch, Shorts, live, playlist-context, SPA navigation, loading, and discarded tabs;
- pinned-tab behavior without changing pin state;
- user-created and prefix-owned groups;
- repeated runs and category edits;
- panel closure and rapid repeated invocation.

If Chrome cannot be launched in the implementation environment, the final handoff explicitly records that limitation while still completing every static, build, and automated check.

## Documentation

The completed `README.md` will explain:

- product purpose and non-goals;
- standalone relationship to `youtube-tab-collector` and the older groupers;
- current-window-only behavior;
- semantic rule and Chrome built-in AI approach;
- default categories;
- Chrome/device/model requirements;
- on-device privacy and cache contents;
- installation, development, build, unpacked loading, and usage;
- options-page configuration and cache clearing;
- permissions and why each is required;
- supported and unsupported page types;
- fallback, pinned, discarded, user-group, and failure behavior;
- known limitations and manual testing steps.

This specification records the architectural decisions. No additional architecture document or redundant ADR collection is needed.

## Known limitations

- Chrome desktop 138 or newer is required.
- Gemini Nano is not available on every device and requires an initial browser-managed download.
- On-device inference can be slower and less capable than a current cloud model.
- The side panel must stay open until group application completes.
- A discarded tab is classified from its saved title only and may have less context.
- Language support depends on Chrome's current Prompt and Translator capabilities.
- The visible `YT · ` prefix is required for durable ownership recognition.
- Existing user groups can lose eligible YouTube members because this extension intentionally manages every eligible unpinned video tab in the invoked window.
- The extension does not continuously regroup tabs after YouTube SPA navigation; the user invokes it again.

## Primary references

- [Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- [Chrome built-in AI getting started](https://developer.chrome.com/docs/ai/get-started)
- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Chrome Prompt API extension sample](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/ai.gemini-on-device)
- [Chrome Tab Groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome extension permission declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome incognito manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)
