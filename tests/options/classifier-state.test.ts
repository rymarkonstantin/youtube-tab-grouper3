import { describe, expect, it } from "vitest";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
import { classifierSettingsCacheImpact } from "../../src/options/classifier-state";

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
});
