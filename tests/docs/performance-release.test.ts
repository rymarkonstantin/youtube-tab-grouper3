import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync("README.md", "utf8");
const spec = readFileSync(
  "docs/superpowers/specs/2026-08-27-classifier-performance-and-quality-design.md",
  "utf8",
);

describe("classifier performance and release documentation", () => {
  it("documents the performance controls and recovery behavior", () => {
    for (const requiredText of [
      "Turbo mode is off by default",
      "Concurrent batches",
      "1 through 8",
      "at most four items",
      "recursive timeout splitting",
      "partial-response recovery",
      "concurrency alone does not invalidate",
      "cached classifications",
      "2, 13, and 180+ eligible tabs",
    ]) {
      expect(readme).toContain(requiredText);
    }
  });

  it("documents diagnostics privacy and release version increments", () => {
    for (const requiredText of [
      "PATCH",
      "MINOR",
      "MAJOR",
      "Documentation-only, test-only, and development-only changes",
      "Every uploaded Chrome package",
      "`package.json` is the release source of truth",
      "development version remains `0.2.0`",
      "`0.2.1` only when packaged for distribution",
      "never includes titles",
    ]) {
      expect(readme).toContain(requiredText);
    }
  });

  it("marks the addendum specification implemented after the release work", () => {
    expect(spec).toContain("**Status:** Implemented");
    expect(spec).toContain("0.2.0");
  });
});
