import "./styles.css";
import { ClassificationCacheRepository } from "../cache/storage";
import type { ClassifierConfig, ClassifierConfigValidationIssue } from "../classifier/config";
import {
  InvalidStoredClassifierConfigError,
  loadOrInitializeClassifierConfig,
  remotePermissionOrigin,
  restoreDefaultClassifierConfig,
  saveClassifierConfig,
} from "../classifier/storage";
import { GROUP_COLORS, type RuleConfig } from "../types";
import {
  InvalidStoredRuleConfigError,
  loadOrInitializeRuleConfig,
  restoreDefaultRuleConfig,
  saveRuleConfig,
} from "../rules/storage";
import type { RuleValidationIssue } from "../rules/validation";
import { classifierSettingsCacheImpact, classifierSettingsView } from "./classifier-state";
import { addRule, deleteRule, moveRule, updateRule } from "./state";

type ValidationIssue = RuleValidationIssue | ClassifierConfigValidationIssue;

let config: RuleConfig | undefined;
let classifierConfig: ClassifierConfig | undefined;

function getConfig(): RuleConfig {
  if (!config) throw new Error("Category settings are not initialized.");
  return config;
}

function getClassifierConfig(): ClassifierConfig {
  if (!classifierConfig) throw new Error("Classifier settings are not initialized.");
  return classifierConfig;
}

const rulesRoot = () => document.querySelector<HTMLElement>("#rules");
const getStatus = () => document.querySelector<HTMLElement>("#status");

function showStatus(message: string): void {
  const status = getStatus();
  if (status) status.textContent = message;
}

function renderValidationIssues(issues: ValidationIssue[]): void {
  const list = document.querySelector<HTMLUListElement>("#validation-issues");
  if (!list) return;
  list.replaceChildren();
  for (const issue of issues) {
    const item = document.createElement("li");
    item.textContent = `${issue.path || "configuration"}: ${issue.message}`;
    list.append(item);
  }
}

function readText(id: string): string {
  return document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "";
}

function readChecked(id: string): boolean {
  return document.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false;
}

function readNumber(id: string): number {
  return Number(document.querySelector<HTMLInputElement>(`#${id}`)?.value);
}

function updateClassifierFromForm(): void {
  const current = getClassifierConfig();
  const mode = document.querySelector<HTMLSelectElement>("#classifier-mode")?.value;
  if (mode !== "local-only" && mode !== "automatic" && mode !== "remote-only") return;
  classifierConfig = {
    ...current,
    mode,
    local: { endpoint: readText("local-endpoint"), model: readText("local-model") },
    remote: {
      enabled: readChecked("remote-enabled"),
      endpoint: readText("remote-endpoint"),
      model: readText("remote-model"),
      apiKey: readText("remote-api-key"),
    },
    diagnosticsEnabled: readChecked("diagnostics-enabled"),
    turboMode: readChecked("turbo-mode"),
    concurrency: readNumber("concurrency"),
  };
}

function renderRules(): void {
  const container = rulesRoot();
  if (!container || !config) return;
  renderValidationIssues([]);
  container.replaceChildren();
  for (const rule of config.rules) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = rule.name;
    fieldset.append(legend);
    const name = document.createElement("input");
    name.value = rule.name;
    name.setAttribute("aria-label", `${rule.name} name`);
    name.addEventListener("change", () => {
      config = updateRule(getConfig(), rule.id, { name: name.value });
    });
    const description = document.createElement("textarea");
    description.value = rule.description;
    description.setAttribute("aria-label", `${rule.name} description`);
    description.addEventListener("change", () => {
      config = updateRule(getConfig(), rule.id, { description: description.value });
    });
    const color = document.createElement("select");
    color.setAttribute("aria-label", `${rule.name} color`);
    for (const value of GROUP_COLORS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = value === rule.color;
      color.append(option);
    }
    color.addEventListener("change", () => {
      config = updateRule(getConfig(), rule.id, { color: color.value as typeof rule.color });
    });
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = rule.enabled;
    enabled.disabled = rule.id === config?.fallbackRuleId;
    enabled.setAttribute("aria-label", `${rule.name} enabled`);
    enabled.addEventListener("change", () => {
      config = updateRule(getConfig(), rule.id, { enabled: enabled.checked });
    });
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "Move up";
    up.addEventListener("click", () => {
      config = moveRule(getConfig(), rule.id, -1);
      renderRules();
    });
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "Move down";
    down.addEventListener("click", () => {
      config = moveRule(getConfig(), rule.id, 1);
      renderRules();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.disabled = rule.id === config?.fallbackRuleId;
    remove.addEventListener("click", () => {
      config = deleteRule(getConfig(), rule.id);
      renderRules();
    });
    fieldset.append(name, description, color, enabled, up, down, remove);
    container.append(fieldset);
  }
}

async function renderRemoteStatus(): Promise<void> {
  if (!classifierConfig) return;
  const origin = remotePermissionOrigin(classifierConfig.remote.endpoint);
  const hasPermission =
    origin !== null && classifierConfig.remote.enabled
      ? await chrome.permissions.contains({ origins: [origin] })
      : false;
  const view = classifierSettingsView(classifierConfig, hasPermission);
  const message = document.querySelector<HTMLElement>("#remote-status");
  if (message) {
    message.textContent = view.remoteMessage;
    message.dataset.tone = view.remoteCanBeUsed ? "neutral" : "warning";
  }
  const permission = document.querySelector<HTMLButtonElement>("#request-remote-permission");
  if (permission) permission.hidden = !view.remoteNeedsPermission;
  const concurrencyMessage = document.querySelector<HTMLElement>("#concurrency-help");
  if (concurrencyMessage) concurrencyMessage.textContent = view.concurrencyMessage;
}

function renderClassifierSettings(): void {
  if (!classifierConfig) return;
  const setValue = (id: string, value: string) => {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    if (control) control.value = value;
  };
  const setChecked = (id: string, value: boolean) => {
    const control = document.querySelector<HTMLInputElement>(`#${id}`);
    if (control) control.checked = value;
  };
  setValue("classifier-mode", classifierConfig.mode);
  setValue("local-endpoint", classifierConfig.local.endpoint);
  setValue("local-model", classifierConfig.local.model);
  setChecked("remote-enabled", classifierConfig.remote.enabled);
  setValue("remote-endpoint", classifierConfig.remote.endpoint);
  setValue("remote-model", classifierConfig.remote.model);
  setValue("remote-api-key", classifierConfig.remote.apiKey);
  setChecked("diagnostics-enabled", classifierConfig.diagnosticsEnabled);
  setChecked("turbo-mode", classifierConfig.turboMode);
  setValue("concurrency", String(classifierConfig.concurrency));
  void renderRemoteStatus();
}

function hideRuleControls(): void {
  for (const id of ["rules", "add", "save", "clear-cache"]) {
    const element = document.querySelector<HTMLElement>(`#${id}`);
    if (element) element.hidden = id === "rules";
  }
}

function registerClassifierControls(): void {
  for (const id of [
    "classifier-mode",
    "local-endpoint",
    "local-model",
    "remote-enabled",
    "remote-endpoint",
    "remote-model",
    "remote-api-key",
    "diagnostics-enabled",
    "turbo-mode",
    "concurrency",
  ]) {
    document.querySelector<HTMLElement>(`#${id}`)?.addEventListener("change", () => {
      if (!classifierConfig) return;
      updateClassifierFromForm();
      void renderRemoteStatus();
    });
  }
  document
    .querySelector<HTMLButtonElement>("#save-classifier")
    ?.addEventListener("click", async () => {
      try {
        const previous = getClassifierConfig();
        updateClassifierFromForm();
        const next = getClassifierConfig();
        const cacheImpact = classifierSettingsCacheImpact(previous, next);
        classifierConfig = await saveClassifierConfig(chrome.storage.local, next);
        if (cacheImpact.clearClassificationCache)
          await new ClassificationCacheRepository(chrome.storage.local).clear();
        renderValidationIssues([]);
        showStatus(
          cacheImpact.clearClassificationCache
            ? "Classifier settings saved and semantic cache cleared."
            : "Classifier settings saved; semantic cache preserved.",
        );
        renderClassifierSettings();
      } catch (error) {
        showStatus(error instanceof Error ? error.message : "Unable to save classifier settings.");
        renderValidationIssues(
          error instanceof InvalidStoredClassifierConfigError ? error.issues : [],
        );
      }
    });
  document
    .querySelector<HTMLButtonElement>("#restore-classifier")
    ?.addEventListener("click", async () => {
      if (!window.confirm("Restore default classifier settings?")) return;
      try {
        const previous = getClassifierConfig();
        classifierConfig = await restoreDefaultClassifierConfig(chrome.storage.local);
        const cacheImpact = classifierSettingsCacheImpact(previous, classifierConfig);
        if (cacheImpact.clearClassificationCache)
          await new ClassificationCacheRepository(chrome.storage.local).clear();
        renderValidationIssues([]);
        showStatus(
          cacheImpact.clearClassificationCache
            ? "Classifier defaults restored and semantic cache cleared."
            : "Classifier defaults restored; semantic cache preserved.",
        );
        renderClassifierSettings();
      } catch (error) {
        showStatus(
          error instanceof Error ? error.message : "Unable to restore classifier defaults.",
        );
      }
    });
  document
    .querySelector<HTMLButtonElement>("#request-remote-permission")
    ?.addEventListener("click", async () => {
      try {
        updateClassifierFromForm();
        const current = getClassifierConfig();
        const origin = remotePermissionOrigin(current.remote.endpoint);
        const view = classifierSettingsView(current, false);
        if (!view.remoteNeedsPermission || origin === null) {
          showStatus(view.remoteMessage);
          return;
        }
        classifierConfig = await saveClassifierConfig(chrome.storage.local, current);
        const granted = await chrome.permissions.request({ origins: [origin] });
        showStatus(
          granted ? "Remote endpoint access allowed." : "Remote endpoint access was not allowed.",
        );
        await renderRemoteStatus();
      } catch (error) {
        showStatus(
          error instanceof Error ? error.message : "Unable to request remote endpoint access.",
        );
      }
    });
}

async function initialize(): Promise<void> {
  document.querySelector<HTMLButtonElement>("#restore")?.addEventListener("click", async () => {
    if (!window.confirm("Restore default categories?")) return;
    try {
      config = await restoreDefaultRuleConfig(chrome.storage.local);
      await new ClassificationCacheRepository(chrome.storage.local).clear();
      for (const id of ["rules", "add", "save", "clear-cache"]) {
        const element = document.querySelector<HTMLElement>(`#${id}`);
        if (element) element.hidden = false;
      }
      renderRules();
      showStatus("Defaults restored and cache cleared.");
    } catch (error) {
      renderValidationIssues([]);
      showStatus(error instanceof Error ? error.message : "Unable to restore defaults.");
    }
  });
  document.querySelector<HTMLButtonElement>("#add")?.addEventListener("click", () => {
    config = addRule(getConfig(), crypto.randomUUID());
    renderRules();
  });
  document.querySelector<HTMLButtonElement>("#save")?.addEventListener("click", async () => {
    try {
      config = await saveRuleConfig(chrome.storage.local, getConfig());
      showStatus("Categories saved.");
      renderRules();
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Unable to save categories.");
      renderValidationIssues(error instanceof InvalidStoredRuleConfigError ? error.issues : []);
    }
  });
  document.querySelector<HTMLButtonElement>("#clear-cache")?.addEventListener("click", async () => {
    if (!window.confirm("Clear classification cache?")) return;
    try {
      await new ClassificationCacheRepository(chrome.storage.local).clear();
      showStatus("Classification cache cleared.");
    } catch (error) {
      renderValidationIssues([]);
      showStatus(error instanceof Error ? error.message : "Unable to clear cache.");
    }
  });
  registerClassifierControls();
  try {
    config = await loadOrInitializeRuleConfig(chrome.storage.local);
    renderRules();
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Stored category configuration is invalid.",
    );
    renderValidationIssues(error instanceof InvalidStoredRuleConfigError ? error.issues : []);
    hideRuleControls();
  }
  try {
    classifierConfig = await loadOrInitializeClassifierConfig(chrome.storage.local);
    renderClassifierSettings();
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Stored classifier configuration is invalid.",
    );
    renderValidationIssues(error instanceof InvalidStoredClassifierConfigError ? error.issues : []);
  }
}

export function initializeOptions(): void {
  void initialize();
}

if (typeof document !== "undefined")
  document.addEventListener("DOMContentLoaded", initializeOptions, { once: true });
