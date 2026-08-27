import { expect, it } from "vitest";
import { fingerprintClassificationRules, fingerprintMetadata } from "../../src/cache/fingerprint";
import { createDefaultRuleConfig } from "../../src/rules/defaults";

const firstRule = (config: ReturnType<typeof createDefaultRuleConfig>) => {
  const rule = config.rules[0];
  if (!rule) throw new Error("Expected default rule");
  return rule;
};

it("is stable across object allocation and ignores rule colors", async () => {
  const first = createDefaultRuleConfig();
  const second = structuredClone(first);
  firstRule(second).color = "red";
  expect(await fingerprintClassificationRules(first)).toBe(
    await fingerprintClassificationRules(second),
  );
});

const semanticRuleMutations: Array<
  [string, (config: ReturnType<typeof createDefaultRuleConfig>) => void]
> = [
  [
    "description",
    (config) => {
      firstRule(config).description += " Includes runtime performance.";
    },
  ],
  [
    "enabled state",
    (config) => {
      firstRule(config).enabled = false;
    },
  ],
  [
    "order",
    (config) => {
      const first = config.rules[0];
      const second = config.rules[1];
      if (!first || !second) throw new Error("Expected default rules");
      [config.rules[0], config.rules[1]] = [second, first];
    },
  ],
  [
    "fallback",
    (config) => {
      config.fallbackRuleId = "fishing";
    },
  ],
];

it.each(semanticRuleMutations)("changes when %s changes", async (_label, mutate) => {
  const base = createDefaultRuleConfig();
  const edited = structuredClone(base);
  mutate(edited);
  expect(await fingerprintClassificationRules(base)).not.toBe(
    await fingerprintClassificationRules(edited),
  );
});

it("hashes normalized metadata without returning its text", async () => {
  const hash = await fingerprintMetadata({
    videoId: "v1",
    pageType: "watch",
    title: "Private title",
    channelName: "Channel",
  });
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(hash).not.toContain("Private title");
});
