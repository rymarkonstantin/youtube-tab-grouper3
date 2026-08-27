import { createDefaultRuleConfig } from "./defaults";
import { validateRuleConfig, type RuleValidationIssue } from "./validation";
import type { RuleConfig } from "../types";
import type { StorageAreaLike } from "../storage";

export const RULE_CONFIG_STORAGE_KEY = "ruleConfigV1";

export class InvalidStoredRuleConfigError extends Error {
  constructor(public readonly issues: RuleValidationIssue[]) {
    super("Stored rule configuration is invalid.");
    this.name = "InvalidStoredRuleConfigError";
  }
}

function cloneConfig(config: RuleConfig): RuleConfig {
  return structuredClone(config);
}

function validateOrThrow(value: unknown): RuleConfig {
  const result = validateRuleConfig(value);
  if (!result.ok) {
    throw new InvalidStoredRuleConfigError(structuredClone(result.issues));
  }
  return result.value;
}

export async function loadOrInitializeRuleConfig(storage: StorageAreaLike): Promise<RuleConfig> {
  const stored = await storage.get(RULE_CONFIG_STORAGE_KEY);
  if (Object.hasOwn(stored, RULE_CONFIG_STORAGE_KEY)) {
    return cloneConfig(validateOrThrow(stored[RULE_CONFIG_STORAGE_KEY]));
  }

  const defaults = createDefaultRuleConfig();
  await storage.set({ [RULE_CONFIG_STORAGE_KEY]: cloneConfig(defaults) });
  return cloneConfig(defaults);
}

export async function saveRuleConfig(
  storage: StorageAreaLike,
  value: unknown,
): Promise<RuleConfig> {
  const config = validateOrThrow(value);
  await storage.set({ [RULE_CONFIG_STORAGE_KEY]: cloneConfig(config) });
  return cloneConfig(config);
}

export async function restoreDefaultRuleConfig(storage: StorageAreaLike): Promise<RuleConfig> {
  return saveRuleConfig(storage, createDefaultRuleConfig());
}
