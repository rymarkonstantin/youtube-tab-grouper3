import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASSIFIER_CONFIG,
  createDefaultClassifierConfig,
  redactClassifierConfig,
  selectProviderChain,
  validateClassifierConfig,
} from "../../src/classifier/config";

describe("hybrid classifier configuration", () => {
  it("provides local-first automatic defaults", () => {
    expect(createDefaultClassifierConfig()).toEqual(DEFAULT_CLASSIFIER_CONFIG);
    expect(DEFAULT_CLASSIFIER_CONFIG).toMatchObject({
      mode: "automatic",
      local: { endpoint: "http://127.0.0.1:11434", model: "qwen2.5:3b-instruct" },
      remote: { enabled: false },
    });
  });

  it.each([
    ["local-only", ["ollama"]],
    ["automatic", ["ollama", "remote"]],
    ["remote-only", ["remote"]],
  ] as const)("selects the deterministic %s provider chain", (mode, expected) => {
    const config = {
      ...createDefaultClassifierConfig(),
      mode,
      remote: { ...createDefaultClassifierConfig().remote, enabled: true },
    };
    expect(selectProviderChain(config)).toEqual(expected);
  });

  it("does not select a disabled remote provider", () => {
    const config = { ...createDefaultClassifierConfig(), mode: "automatic" as const };
    expect(selectProviderChain(config)).toEqual(["ollama"]);
    expect(
      selectProviderChain({
        ...config,
        mode: "remote-only",
        remote: { ...config.remote, enabled: false },
      }),
    ).toEqual([]);
  });

  it("validates loopback local and secure remote endpoints", () => {
    expect(validateClassifierConfig(createDefaultClassifierConfig()).ok).toBe(true);
    const invalid = {
      ...createDefaultClassifierConfig(),
      local: { endpoint: "https://example.test", model: "" },
      remote: { ...createDefaultClassifierConfig().remote, enabled: true, endpoint: "not a url" },
    };
    const result = validateClassifierConfig(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map(({ path }) => path)).toEqual(
        expect.arrayContaining(["local.endpoint", "local.model", "remote.endpoint"]),
      );
  });

  it("redacts remote credentials without mutating configuration", () => {
    const config = {
      ...createDefaultClassifierConfig(),
      remote: { ...createDefaultClassifierConfig().remote, apiKey: "secret-value" },
    };
    expect(redactClassifierConfig(config).remote.apiKey).toBe("[redacted]");
    expect(config.remote.apiKey).toBe("secret-value");
  });
});
