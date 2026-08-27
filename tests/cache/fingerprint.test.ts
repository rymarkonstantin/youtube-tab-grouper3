import { expect, it } from "vitest";
import { fingerprintClassificationRules, fingerprintMetadata } from "../../src/cache/fingerprint";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
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

it("changes when the active provider or model changes", async () => {
  const rules = createDefaultRuleConfig();
  const config = createDefaultClassifierConfig();
  const baseline = await fingerprintClassificationRules(rules, config, "ollama");

  const localModelChanged = structuredClone(config);
  localModelChanged.local.model = "llama3.2:3b";
  expect(await fingerprintClassificationRules(rules, localModelChanged, "ollama")).not.toBe(
    baseline,
  );

  const remote = structuredClone(config);
  remote.remote = {
    enabled: true,
    endpoint: "https://api.example.test/v1",
    model: "gpt-4.1-mini",
    apiKey: "secret",
  };
  const remoteBaseline = await fingerprintClassificationRules(rules, remote, "remote");
  expect(remoteBaseline).not.toBe(baseline);

  remote.remote.model = "gpt-4.1-nano";
  expect(await fingerprintClassificationRules(rules, remote, "remote")).not.toBe(remoteBaseline);
});
