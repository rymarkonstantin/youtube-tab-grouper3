import { access, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distPath = path.resolve(root, "dist");
const manifest = JSON.parse(await readFile(path.resolve(distPath, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, "138");
assert.deepEqual(manifest.permissions, ["scripting", "sidePanel", "storage", "tabGroups"]);
assert.deepEqual(manifest.host_permissions, ["https://*.youtube.com/*", "https://youtu.be/*"]);
assert.equal(manifest.incognito, "not_allowed");
assert.equal(manifest.background.service_worker, "background.js");
assert.equal(manifest.side_panel.default_path, "sidepanel.html");
assert.equal(manifest.options_page, "options.html");
assert.equal(manifest.action.default_popup, undefined);

for (const forbidden of ["tabs", "activeTab", "aiLanguageModelOriginTrial"]) {
  assert.equal(
    manifest.permissions.includes(forbidden),
    false,
    `Forbidden permission: ${forbidden}`,
  );
}

for (const artifact of [
  "manifest.json",
  "sidepanel.html",
  "options.html",
  "background.js",
  "sidepanel.js",
  "sidepanel.css",
  "options.js",
  "options.css",
]) {
  await access(path.resolve(distPath, artifact));
}

console.log("Distribution manifest and referenced artifacts are valid.");
