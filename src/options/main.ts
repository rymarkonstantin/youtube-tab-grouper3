import "./styles.css";
import { ClassificationCacheRepository } from "../cache/storage";
import { GROUP_COLORS, type RuleConfig } from "../types";
import {
  loadOrInitializeRuleConfig,
  restoreDefaultRuleConfig,
  saveRuleConfig,
} from "../rules/storage";
import { addRule, deleteRule, moveRule, updateRule } from "./state";

let config: RuleConfig | undefined;
function getConfig(): RuleConfig {
  if (!config) throw new Error("Options are not initialized.");
  return config;
}
const root = () => document.querySelector<HTMLElement>("#rules");
function render(): void {
  const container = root();
  if (!container || !config) return;
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
      render();
    });
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "Move down";
    down.addEventListener("click", () => {
      config = moveRule(getConfig(), rule.id, 1);
      render();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.disabled = rule.id === config?.fallbackRuleId;
    remove.addEventListener("click", () => {
      config = deleteRule(getConfig(), rule.id);
      render();
    });
    fieldset.append(name, description, color, enabled, up, down, remove);
    container.append(fieldset);
  }
}
async function initialize(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#status");
  try {
    config = await loadOrInitializeRuleConfig(chrome.storage.local);
    render();
  } catch (error) {
    if (status)
      status.textContent =
        error instanceof Error ? error.message : "Stored configuration is invalid.";
    for (const id of ["rules", "add", "save", "clear-cache"]) {
      const element = document.querySelector<HTMLElement>(`#${id}`);
      if (element) element.hidden = id === "rules";
    }
    return;
  }
  document.querySelector<HTMLButtonElement>("#add")?.addEventListener("click", () => {
    config = addRule(getConfig(), crypto.randomUUID());
    render();
  });
  document.querySelector<HTMLButtonElement>("#save")?.addEventListener("click", async () => {
    try {
      config = await saveRuleConfig(chrome.storage.local, config);
      if (status) status.textContent = "Saved.";
      render();
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "Unable to save.";
    }
  });
  document.querySelector<HTMLButtonElement>("#restore")?.addEventListener("click", async () => {
    if (!window.confirm("Restore default categories?")) return;
    config = await restoreDefaultRuleConfig(chrome.storage.local);
    await new ClassificationCacheRepository(chrome.storage.local).clear();
    render();
    if (status) status.textContent = "Defaults restored and cache cleared.";
  });
  document.querySelector<HTMLButtonElement>("#clear-cache")?.addEventListener("click", async () => {
    if (!window.confirm("Clear classification cache?")) return;
    await new ClassificationCacheRepository(chrome.storage.local).clear();
    if (status) status.textContent = "Classification cache cleared.";
  });
}
export function initializeOptions(): void {
  void initialize();
}
if (typeof document !== "undefined")
  document.addEventListener("DOMContentLoaded", initializeOptions, { once: true });
