import { describe, expect, it } from "vitest";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
import {
  classifierConcurrencyMessage,
  classifierSettingsCacheImpact,
  classifierSettingsView,
} from "../../src/options/classifier-state";

describe("classifier settings cache impact", () => {
  it("preserves semantic cache entries for a concurrency-only setting change", () => {
    const before = createDefaultClassifierConfig();
    const after = { ...before, concurrency: 4 };

    expect(classifierSettingsCacheImpact(before, after)).toEqual({
      clearClassificationCache: false,
    });
  });

  it("invalidates semantic cache entries when Turbo mode changes", () => {
    const before = createDefaultClassifierConfig();
    const after = { ...before, turboMode: true };

    expect(classifierSettingsCacheImpact(before, after)).toEqual({
      clearClassificationCache: true,
    });
  });

  it("does not advertise configured parallel workers for local Ollama", () => {
    expect(classifierConcurrencyMessage("local-only", 8)).toContain("one adaptive worker");
    expect(classifierConcurrencyMessage("local-only", 8)).not.toContain("8 concurrent");
    expect(
      classifierSettingsView(
        { ...createDefaultClassifierConfig(), mode: "local-only", concurrency: 8 },
        false,
      ).concurrencyMessage,
    ).toContain("one adaptive worker");
  });

  it("keeps bounded concurrency visible for remote providers", () => {
    expect(classifierConcurrencyMessage("remote-only", 4)).toContain("up to 4 concurrent batches");
    expect(classifierConcurrencyMessage("automatic", 4)).toContain("remote fallback");
  });
});
