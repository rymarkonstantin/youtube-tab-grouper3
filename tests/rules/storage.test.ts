import { describe, expect, it } from "vitest";
import { createDefaultRuleConfig } from "../../src/rules/defaults";
import {
  InvalidStoredRuleConfigError,
  loadOrInitializeRuleConfig,
  restoreDefaultRuleConfig,
  saveRuleConfig,
} from "../../src/rules/storage";
import { MemoryStorage } from "../helpers/memory-storage";

function firstRule(config: ReturnType<typeof createDefaultRuleConfig>) {
  const rule = config.rules[0];
  if (!rule) throw new Error("Expected a programming default rule.");
  return rule;
}

describe("rule storage", () => {
  it("initializes defaults only when the key is absent", async () => {
    const storage = new MemoryStorage();
    const loaded = await loadOrInitializeRuleConfig(storage);
    expect(loaded).toEqual(createDefaultRuleConfig());
    expect(storage.setCalls).toHaveLength(1);
  });

  it("preserves a valid customized configuration", async () => {
    const custom = createDefaultRuleConfig();
    firstRule(custom).name = "Software";
    const storage = new MemoryStorage({ ruleConfigV1: custom });
    expect(await loadOrInitializeRuleConfig(storage)).toEqual(custom);
    expect(storage.setCalls).toHaveLength(0);
  });

  it("does not overwrite invalid existing data", async () => {
    const storage = new MemoryStorage({ ruleConfigV1: { schemaVersion: 99 } });
    await expect(loadOrInitializeRuleConfig(storage)).rejects.toBeInstanceOf(
      InvalidStoredRuleConfigError,
    );
    expect(storage.setCalls).toHaveLength(0);
  });

  it("returns clones instead of mutable storage state", async () => {
    const storage = new MemoryStorage();
    const loaded = await loadOrInitializeRuleConfig(storage);
    firstRule(loaded).name = "Changed";
    expect(firstRule(await loadOrInitializeRuleConfig(storage)).name).toBe("Programming");
  });

  it("validates saves and restores defaults deliberately", async () => {
    const storage = new MemoryStorage();
    await expect(saveRuleConfig(storage, { schemaVersion: 1 })).rejects.toThrow();
    expect(await restoreDefaultRuleConfig(storage)).toEqual(createDefaultRuleConfig());
  });
});
