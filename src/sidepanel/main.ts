import "./styles.css";
import { ClassificationCacheRepository } from "../cache/storage";
import { ChromeGroupsAdapter } from "../chrome/groups";
import { ChromeTabsAdapter } from "../chrome/tabs";
import { OllamaClassifierProvider } from "../classifier/ollama";
import {
  ProviderChainClassifier,
  ProviderUnavailableError,
  type SemanticClassifierProvider,
} from "../classifier/providers";
import { RemoteClassifierProvider } from "../classifier/remote";
import {
  InvalidStoredClassifierConfigError,
  loadOrInitializeClassifierConfig,
} from "../classifier/storage";
import { RunDiagnostics } from "../diagnostics";
import { InvalidStoredRuleConfigError, loadOrInitializeRuleConfig } from "../rules/storage";
import { runGrouping } from "../run/coordinator";
import type { RunSummary } from "../run/types";
import type { PanelState } from "./state";
import { toPanelViewModel } from "./state";

let currentRun: { controller: AbortController } | undefined;

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
    ["edit", view.editVisible],
  ] as const) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button) button.hidden = !visible;
  }
  const summary = document.querySelector<HTMLUListElement>("#summary");
  if (summary) {
    summary.replaceChildren();
    if (state.kind === "complete") {
      for (const [label, value] of [
        ["Eligible", state.summary.eligible],
        ["Grouped", state.summary.grouped],
        ["Cached", state.summary.cached],
        ["Uncategorized", state.summary.uncategorized],
        ["Skipped", state.summary.skipped],
        ["Failed", state.summary.failed],
      ] as const) {
        const item = document.createElement("li");
        item.textContent = `${label}: ${value}`;
        summary.append(item);
      }
    }
  }
}

function setBadge(text: string, color: string): void {
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color });
}

async function startRun(): Promise<void> {
  if (currentRun) return;
  const controller = new AbortController();
  currentRun = { controller };
  render({ kind: "checking" });
  setBadge("…", "#777777");
  try {
    const storage = chrome.storage.local;
    const [rules, classifierConfig] = await Promise.all([
      loadOrInitializeRuleConfig(storage),
      loadOrInitializeClassifierConfig(storage),
    ]);
    const diagnostics = new RunDiagnostics(classifierConfig.diagnosticsEnabled);
    const providers: Partial<Record<"ollama" | "remote", SemanticClassifierProvider>> = {
      ollama: new OllamaClassifierProvider(classifierConfig.local),
    };
    if (classifierConfig.remote.enabled)
      providers.remote = new RemoteClassifierProvider(classifierConfig.remote);
    const classifier = new ProviderChainClassifier({
      config: classifierConfig,
      providers,
      signal: controller.signal,
      onHealth: (providerId, health) => diagnostics.recordProviderHealth(providerId, health),
      onFallback: (from, to, reason) => diagnostics.recordFallback(from, to, reason),
      onSelected: (providerId) => diagnostics.recordProviderSelected(providerId),
    });
    const summary: RunSummary = await runGrouping(
      {
        loadRules: async () => rules,
        cache: new ClassificationCacheRepository(storage),
        tabs: new ChromeTabsAdapter(chrome),
        groups: new ChromeGroupsAdapter(chrome),
        classifier,
        classifierConfig,
      },
      {
        signal: controller.signal,
        onProgress: (progress) => render({ kind: "running", progress }),
        diagnostics,
      },
    );
    render({ kind: "complete", summary });
    setBadge(
      summary.failed ? "!" : summary.grouped > 999 ? "999+" : String(summary.grouped),
      summary.failed ? "#b3261e" : "#188038",
    );
  } catch (error) {
    if (error instanceof ProviderUnavailableError)
      render({ kind: "unavailable", message: error.message });
    else if (
      error instanceof InvalidStoredRuleConfigError ||
      error instanceof InvalidStoredClassifierConfigError
    )
      render({ kind: "configuration-error", message: error.message });
    else if (controller.signal.aborted) render({ kind: "cancelled" });
    else
      render({
        kind: "error",
        message: error instanceof Error ? error.message : "Unexpected error.",
      });
  } finally {
    currentRun = undefined;
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
    void startRun();
  });
  window.addEventListener("pagehide", () => currentRun?.controller.abort(), { once: true });
  void startRun();
}
if (typeof document !== "undefined")
  document.addEventListener("DOMContentLoaded", initializeSidePanel, { once: true });
