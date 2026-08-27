import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("declares exactly the approved permissions and boundaries", async () => {
    const manifest = JSON.parse(await readFile("static/manifest.json", "utf8"));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("138");
    expect(manifest.permissions).toEqual(["scripting", "sidePanel", "storage", "tabGroups"]);
    expect(manifest.host_permissions).toEqual(["https://*.youtube.com/*", "https://youtu.be/*"]);
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.permissions).not.toContain("activeTab");
    expect(manifest.incognito).toBe("not_allowed");
    expect(manifest.side_panel.default_path).toBe("sidepanel.html");
    expect(manifest.options_page).toBe("options.html");
    expect(manifest.action.default_popup).toBeUndefined();
  });
});
