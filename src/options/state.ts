import type { GroupRule, RuleConfig } from "../types";
export type EditableRuleFields = Pick<GroupRule, "name" | "description" | "color" | "enabled">;
const clone = (config: RuleConfig): RuleConfig => structuredClone(config);
export function addRule(config: RuleConfig, id: string): RuleConfig {
  const next = clone(config);
  const fallbackIndex = next.rules.findIndex(({ id: value }) => value === next.fallbackRuleId);
  next.rules.splice(fallbackIndex < 0 ? next.rules.length : fallbackIndex, 0, {
    id,
    name: "New category",
    description: "Describe the primary subject matter for this category.",
    color: "blue",
    enabled: true,
  });
  return next;
}
export function updateRule(
  config: RuleConfig,
  id: string,
  patch: Partial<EditableRuleFields>,
): RuleConfig {
  const next = clone(config);
  const rule = next.rules.find(({ id: value }) => value === id);
  if (!rule) return next;
  Object.assign(rule, {
    name: patch.name ?? rule.name,
    description: patch.description ?? rule.description,
    color: patch.color ?? rule.color,
    enabled: id === next.fallbackRuleId ? true : (patch.enabled ?? rule.enabled),
  });
  return next;
}
export function deleteRule(config: RuleConfig, id: string): RuleConfig {
  if (id === config.fallbackRuleId) return clone(config);
  const next = clone(config);
  next.rules = next.rules.filter(({ id: value }) => value !== id);
  return next;
}
export function moveRule(config: RuleConfig, id: string, offset: -1 | 1): RuleConfig {
  const next = clone(config);
  const index = next.rules.findIndex(({ id: value }) => value === id);
  if (index < 0) return next;
  const target = Math.max(0, Math.min(next.rules.length - 1, index + offset));
  if (target !== index) {
    const current = next.rules[index];
    const replacement = next.rules[target];
    if (current && replacement) [next.rules[index], next.rules[target]] = [replacement, current];
  }
  return next;
}
