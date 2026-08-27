import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hybrid classifier README guidance", () => {
  it("documents local Ollama setup and the available classifier modes", async () => {
    const readme = await readFile("README.md", "utf8");

    expect(readme).toContain("## Semantic classifier setup");
    expect(readme).toContain("ollama serve");
    expect(readme).toContain("ollama pull qwen2.5:3b-instruct");
    expect(readme).toContain("Local only");
    expect(readme).toContain("Automatic");
    expect(readme).toContain("Remote only");
  });

  it("documents remote opt-in, permissions, privacy, diagnostics, and cache migration", async () => {
    const readme = await readFile("README.md", "utf8");

    for (const requiredText of [
      "optional_host_permissions",
      "explicitly enabled",
      "API key",
      "tab URL",
      "Copy diagnostics",
      "redacted",
      "## Cache migration",
      "## Troubleshooting",
      "## Known limitations",
    ])
      expect(readme).toContain(requiredText);
  });
});
