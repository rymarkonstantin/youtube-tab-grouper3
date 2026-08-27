import { describe, expect, it } from "vitest";
import { createDefaultRuleConfig } from "../../src/rules/defaults";
import { validateRuleConfig } from "../../src/rules/validation";

function ruleAt(config: ReturnType<typeof createDefaultRuleConfig>, index: number) {
  const rule = index < 0 ? config.rules.at(index) : config.rules[index];
  if (!rule) throw new Error(`Expected rule at index ${index}.`);
  return rule;
}

describe("validateRuleConfig", () => {
  it("accepts and trims a valid configuration", () => {
    const input = createDefaultRuleConfig();
    ruleAt(input, 0).name = "  Programming  ";
    const result = validateRuleConfig(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rules[0]?.name).toBe("Programming");
  });

  it.each([
    [
      "duplicate IDs",
      (c: ReturnType<typeof createDefaultRuleConfig>) => (ruleAt(c, 1).id = ruleAt(c, 0).id),
    ],
    [
      "case-folded duplicate names",
      (c: ReturnType<typeof createDefaultRuleConfig>) => (ruleAt(c, 1).name = "PROGRAMMING"),
    ],
    [
      "disabled fallback",
      (c: ReturnType<typeof createDefaultRuleConfig>) => (ruleAt(c, -1).enabled = false),
    ],
    [
      "missing fallback",
      (c: ReturnType<typeof createDefaultRuleConfig>) => (c.fallbackRuleId = "missing"),
    ],
  ])("rejects %s", (_label, mutate) => {
    const input = createDefaultRuleConfig();
    mutate(input);
    expect(validateRuleConfig(input).ok).toBe(false);
  });

  it("rejects more than 24 rules and invalid colors", () => {
    const input = createDefaultRuleConfig();
    input.rules = Array.from({ length: 25 }, (_, index) => ({
      id: `rule-${index}`,
      name: `Rule ${index}`,
      description: "A semantic category description.",
      color: index === 0 ? ("teal" as never) : "blue",
      enabled: true,
    }));
    input.fallbackRuleId = "rule-24";
    expect(validateRuleConfig(input).ok).toBe(false);
  });

  it("rejects blank, padded, overlong, or control-character IDs", () => {
    for (const id of ["", " padded", "x".repeat(81), "bad\u0000id"]) {
      const input = createDefaultRuleConfig();
      ruleAt(input, 0).id = id;
      expect(validateRuleConfig(input).ok).toBe(false);
    }
  });
});
