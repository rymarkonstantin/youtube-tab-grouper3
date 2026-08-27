import "./styles.css";
import { ClassificationCacheRepository } from "../cache/storage";
import { ChromeGroupsAdapter } from "../chrome/groups";
import { ChromeTabsAdapter } from "../chrome/tabs";
import { ChromeBuiltInClassifier, ChromeLanguageModelPort } from "../classifier/chrome-built-in";
import { ChromeLanguageApi } from "../classifier/language";
import { ActivationRequiredError, AiUnavailableError } from "../classifier/errors";
import { loadOrInitializeRuleConfig } from "../rules/storage";
import { runGrouping } from "../run/coordinator";
import type { RunSummary } from "../run/types";
import type { PanelState } from "./state";
import { toPanelViewModel } from "./state";

let currentRun: { controller: AbortController; pending?: ActivationRequiredError } | undefined;

function render(state: PanelState): void {
  const view = toPanelViewModel(state);
  const status = document.querySelector<HTMLElement>("#status");
  if (status) status.textContent = `${view.heading}: ${view.message}`;
  const progress = document.querySelector<HTMLProgressElement>("#progress");
  if (progress) {
    progress.hidden = view.progress === null;
    if (view.progress) {
      progress.value = view.progress.value;
      progress.max = view.progress.max;
    }
  }
  for (const [id, visible] of [
    ["prepare", view.prepareVisible],
    ["cancel", view.cancelVisible],
    ["run-again", view.runAgainVisible],
  ] as const) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button) button.hidden = !visible;
  }
}

function setBadge(text: string, color: string): void {
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color });
}

async function startRun(allowDownloads: boolean): Promise<void> {
  if (currentRun) return;
  const controller = new AbortController();
  currentRun = { controller };
  render({ kind: "checking" });
  setBadge("…", "#777777");
  try {
    const storage = chrome.storage.local;
    const config = await loadOrInitializeRuleConfig(storage);
    const classifier = new ChromeBuiltInClassifier(
      new ChromeLanguageApi(),
      new ChromeLanguageModelPort(),
      {
        allowDownloads,
        signal: controller.signal,
        onDownloadProgress: () => undefined,
        onPhase: () => undefined,
      },
    );
    const summary: RunSummary = await runGrouping(
      {
        loadRules: async () => config,
        cache: new ClassificationCacheRepository(storage),
        tabs: new ChromeTabsAdapter(chrome),
        groups: new ChromeGroupsAdapter(chrome),
        classifier,
      },
      {
        signal: controller.signal,
        onProgress: (progress) => render({ kind: "running", progress }),
      },
    );
    render({ kind: "complete", summary });
    setBadge(
      summary.failed ? "!" : String(Math.min(summary.grouped, 999)),
      summary.failed ? "#b3261e" : "#188038",
    );
  } catch (error) {
    if (error instanceof ActivationRequiredError) {
      currentRun.pending = error;
      render({ kind: "needs-activation", capability: error.capability });
      setBadge("!", "#777777");
    } else if (error instanceof AiUnavailableError)
      render({ kind: "unavailable", message: error.message });
    else if (controller.signal.aborted) render({ kind: "cancelled" });
    else
      render({
        kind: "error",
        message: error instanceof Error ? error.message : "Unexpected error.",
      });
  } finally {
    if (!currentRun?.pending) currentRun = undefined;
  }
}

export function initializeSidePanel(): void {
  document
    .querySelector<HTMLButtonElement>("#edit")
    ?.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  document
    .querySelector<HTMLButtonElement>("#cancel")
    ?.addEventListener("click", () => currentRun?.controller.abort());
  document.querySelector<HTMLButtonElement>("#run-again")?.addEventListener("click", () => {
    currentRun = undefined;
    void startRun(false);
  });
  document.querySelector<HTMLButtonElement>("#prepare")?.addEventListener("click", () => {
    const pending = currentRun?.pending;
    if (!pending || !navigator.userActivation.isActive) return;
    const controller = new AbortController();
    void pending.prepare({ signal: controller.signal, onDownloadProgress: () => undefined }).then(
      () => {
        currentRun = undefined;
        void startRun(false);
      },
      (error: unknown) =>
        render({
          kind: "error",
          message: error instanceof Error ? error.message : "Preparation failed.",
        }),
    );
  });
  window.addEventListener("pagehide", () => currentRun?.controller.abort(), { once: true });
  void startRun(false);
}
if (typeof document !== "undefined")
  document.addEventListener("DOMContentLoaded", initializeSidePanel, { once: true });
