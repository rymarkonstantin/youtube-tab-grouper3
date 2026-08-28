import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("release version", () => {
  it("keeps the package and Chrome manifest versions synchronized", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      version?: unknown;
    };
    const manifest = JSON.parse(readFileSync(resolve(root, "static/manifest.json"), "utf8")) as {
      version?: unknown;
    };
    const lockfile = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")) as {
      version?: unknown;
      packages?: { ""?: { version?: unknown } };
    };

    expect(packageJson.version).toBe("0.3.1");
    expect(manifest.version).toBe(packageJson.version);
    expect(lockfile.version).toBe(packageJson.version);
    expect(lockfile.packages?.[""]?.version).toBe(packageJson.version);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
