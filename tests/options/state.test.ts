import { describe, expect, it } from "vitest";
import { createDefaultRuleConfig } from "../../src/rules/defaults";
import { addRule, deleteRule, moveRule, updateRule } from "../../src/options/state";
describe("options rule state", () => {
  it("adds a rule with the supplied immutable ID", () => {
    const next = addRule(createDefaultRuleConfig(), "generated-id");
    expect(next.rules.at(-2)).toMatchObject({
      id: "generated-id",
      name: "New category",
      color: "blue",
      enabled: true,
    });
    expect(next.rules.at(-1)?.id).toBe("uncategorized");
  });
  it("does not edit IDs or disable/delete the fallback", () => {
    const config = createDefaultRuleConfig();
    expect(updateRule(config, "uncategorized", { enabled: false }).rules.at(-1)?.enabled).toBe(
      true,
    );
    expect(deleteRule(config, "uncategorized")).toEqual(config);
    expect(updateRule(config, "programming", { id: "changed" } as never).rules[0]?.id).toBe(
      "programming",
    );
  });
  it("moves rules without changing their identity", () => {
    const moved = moveRule(createDefaultRuleConfig(), "fishing", -1);
    expect(moved.rules.slice(0, 2).map(({ id }) => id)).toEqual(["fishing", "programming"]);
  });
});
