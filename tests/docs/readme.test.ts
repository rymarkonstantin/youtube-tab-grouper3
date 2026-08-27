import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("README", () => {
  it("documents the complete shipped product", async () => {
    const readme = await readFile("README.md", "utf8");
    for (const heading of [
      "# YouTube Tab Grouper 3",
      "## What it does",
      "## What it does not do",
      "## How semantic grouping works",
      "## Default categories",
      "## Chrome requirements",
      "## Privacy",
      "## Permissions",
      "## Installation",
      "## Development",
      "## Build and load",
      "## Usage",
      "## Configuration",
      "## Page and edge-case behavior",
      "## Known limitations",
      "## Manual acceptance checklist",
    ])
      expect(readme).toContain(heading);
    expect(readme).toContain("youtube-tab-collector");
    expect(readme).toContain("current normal Chrome window");
    expect(readme).toContain("chrome.storage.local");
    expect(readme).toContain("YT · ");
    expect(readme).toContain("npm run validate");
  });
});
