import { GROUP_COLORS, type GroupColor, type GroupRule, type RuleConfig } from "../types";

export interface RuleValidationIssue {
  path: string;
  message: string;
}

export type RuleConfigValidation =
  | { ok: true; value: RuleConfig }
  | { ok: false; issues: RuleValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === "string" && (GROUP_COLORS as readonly string[]).includes(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function addIssue(issues: RuleValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

export function validateRuleConfig(value: unknown): RuleConfigValidation {
  const issues: RuleValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "", message: "Configuration must be an object." }] };
  }

  if (value.schemaVersion !== 1) {
    addIssue(issues, "schemaVersion", "Schema version must be 1.");
  }

  const fallbackRuleId = value.fallbackRuleId;
  if (typeof fallbackRuleId !== "string") {
    addIssue(issues, "fallbackRuleId", "Fallback rule ID must be a string.");
  }

  const rawRules = value.rules;
  if (!Array.isArray(rawRules)) {
    addIssue(issues, "rules", "Rules must be an array.");
    return { ok: false, issues };
  }
  if (rawRules.length === 0) {
    addIssue(issues, "rules", "At least one rule is required.");
  }
  if (rawRules.length > 24) {
    addIssue(issues, "rules", "No more than 24 rules are allowed.");
  }

  const normalizedRules: GroupRule[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  rawRules.forEach((rawRule, index) => {
    const path = `rules[${index}]`;
    if (!isRecord(rawRule)) {
      addIssue(issues, path, "Rule must be an object.");
      return;
    }

    const id = rawRule.id;
    let normalizedId: string | undefined;
    if (typeof id !== "string") {
      addIssue(issues, `${path}.id`, "Rule ID must be a string.");
    } else if (id.length < 1 || id.length > 80 || id.trim() !== id || hasControlCharacter(id)) {
      addIssue(
        issues,
        `${path}.id`,
        "Rule ID must be 1–80 characters without padding or controls.",
      );
    } else if (ids.has(id)) {
      addIssue(issues, `${path}.id`, "Rule IDs must be unique.");
    } else {
      ids.add(id);
      normalizedId = id;
    }

    const name = rawRule.name;
    let normalizedName: string | undefined;
    if (typeof name !== "string") {
      addIssue(issues, `${path}.name`, "Rule name must be a string.");
    } else {
      normalizedName = name.trim();
      if (
        normalizedName.length < 1 ||
        normalizedName.length > 60 ||
        hasControlCharacter(name)
      ) {
        addIssue(
          issues,
          `${path}.name`,
          "Rule name must be 1–60 characters after trimming and contain no controls.",
        );
      }
      const foldedName = normalizedName.toLowerCase();
      if (names.has(foldedName)) {
        addIssue(issues, `${path}.name`, "Rule names must be unique ignoring case.");
      } else {
        names.add(foldedName);
      }
    }

    const description = rawRule.description;
    let normalizedDescription: string | undefined;
    if (typeof description !== "string") {
      addIssue(issues, `${path}.description`, "Rule description must be a string.");
    } else {
      normalizedDescription = description.trim();
      if (
        normalizedDescription.length < 1 ||
        normalizedDescription.length > 600 ||
        hasControlCharacter(description)
      ) {
        addIssue(
          issues,
          `${path}.description`,
          "Rule description must be 1–600 characters after trimming and contain no controls.",
        );
      }
    }

    const color = rawRule.color;
    if (!isGroupColor(color)) {
      addIssue(issues, `${path}.color`, "Rule color is not supported by Chrome.");
    }

    const enabled = rawRule.enabled;
    if (typeof enabled !== "boolean") {
      addIssue(issues, `${path}.enabled`, "Rule enabled value must be boolean.");
    }

    if (
      normalizedId !== undefined &&
      normalizedName !== undefined &&
      normalizedDescription !== undefined &&
      isGroupColor(color) &&
      typeof enabled === "boolean"
    ) {
      normalizedRules.push({
        id: normalizedId,
        name: normalizedName,
        description: normalizedDescription,
        color,
        enabled,
      });
    }
  });

  if (typeof fallbackRuleId === "string") {
    const fallback = normalizedRules.find(({ id }) => id === fallbackRuleId);
    if (fallback === undefined) {
      addIssue(issues, "fallbackRuleId", "Fallback rule ID must refer to a rule.");
    } else if (!fallback.enabled) {
      addIssue(issues, "fallbackRuleId", "The fallback rule must remain enabled.");
    }
  }

  if (issues.length > 0 || typeof fallbackRuleId !== "string") {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      fallbackRuleId,
      rules: normalizedRules,
    },
  };
}
