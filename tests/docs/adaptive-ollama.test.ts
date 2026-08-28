import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("adaptive Ollama documentation", () => {
  it("documents provider-aware concurrency and local scheduling", async () => {
    const readme = await readFile("README.md", "utf8");
    const agents = await readFile("AGENTS.md", "utf8");

    expect(readme).toContain("one effective worker");
    expect(readme).toContain(
      "higher configured value never falsely promises local parallel inference",
    );
    expect(readme).toContain("Remote classification\nretains the configured bounded worker limit");
    expect(readme).toContain("keep_alive");
    expect(readme).toContain("independent stateless batches");
    expect(readme).toContain("scheduling settings such as");
    expect(agents).toContain("one effective adaptive worker");
    expect(agents).toContain("tested capability");
  });
});
