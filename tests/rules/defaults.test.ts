import { describe, expect, it } from "vitest";
import { createDefaultRuleConfig } from "../../src/rules/defaults";

describe("default rule configuration", () => {
  it("contains the compact semantic taxonomy in deterministic order", () => {
    const config = createDefaultRuleConfig();

    expect(config.schemaVersion).toBe(1);
    expect(config.fallbackRuleId).toBe("uncategorized");
    expect(config.rules.map(({ id }) => id)).toEqual([
      "programming",
      "fishing",
      "photography",
      "history",
      "gaming",
      "technology",
      "science",
      "music",
      "entertainment",
      "uncategorized",
    ]);
    expect(config.rules.find(({ id }) => id === "programming")).toMatchObject({
      name: "Programming",
      color: "green",
      enabled: true,
    });
  });

  it("returns an independent copy", () => {
    const first = createDefaultRuleConfig();
    const firstRule = first.rules[0];
    if (!firstRule) throw new Error("Expected a programming default rule.");
    firstRule.name = "Changed";
    expect(createDefaultRuleConfig().rules[0]?.name).toBe("Programming");
  });
});
