import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("metadata reliability documentation", () => {
  it("documents timing, title fallback, progress, and privacy", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("3-second");
    expect(readme).toContain("60-second metadata budget");
    expect(readme).toContain("injectImmediately");
    expect(readme).toContain("saved tab title");
    expect(readme).toContain("145");
    expect(readme).toContain("late page results are ignored");
    expect(readme).toContain("no titles, URLs, or tab IDs");
  });

  it("keeps agent guidance aligned with Ollama and sequential focused specs", async () => {
    const agents = await readFile("AGENTS.md", "utf8");
    expect(agents).toContain("local-first Ollama");
    expect(agents).toContain("approved focused specification");
    expect(agents).toContain("Only one bundle branch and one pull request may be active at a time");
    expect(agents).not.toContain("Use Chrome's built-in on-device AI APIs");
    expect(agents).not.toContain("## Six-Bundle Delivery");
  });

  it("documents the required merge version bump", async () => {
    const [readme, packageJson, manifest] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("package.json", "utf8"),
      readFile("static/manifest.json", "utf8"),
    ]);

    expect(readme).toContain("Every merge to `main` requires a version bump");
    expect(JSON.parse(packageJson).version).toBe("0.3.1");
    expect(JSON.parse(manifest).version).toBe("0.3.1");
  });

  it("does not present the unconfirmed validation wrapper as completed", async () => {
    const body = await readFile(
      "docs/superpowers/handoffs/2026-08-28-metadata-reliability-pr.md",
      "utf8",
    );

    expect(body).toContain("Pending: rerun `npm run validate` in the normal PR environment.");
    expect(body).toContain(
      "Passed individually: `npm test`, `npm run format:check`, `npm run lint`",
    );
  });
});
