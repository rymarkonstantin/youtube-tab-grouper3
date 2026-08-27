import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distPath = path.resolve(root, "dist");

if (path.relative(root, distPath) !== "dist") {
  throw new Error("Refusing to build outside the repository dist directory.");
}

await rm(distPath, { recursive: true, force: true });
await cp(path.resolve(root, "static"), distPath, { recursive: true });

await build({
  entryPoints: {
    background: "src/background.ts",
    sidepanel: "src/sidepanel/main.ts",
    options: "src/options/main.ts",
  },
  absWorkingDir: root,
  bundle: true,
  format: "esm",
  target: "chrome138",
  entryNames: "[name]",
  outdir: "dist",
  sourcemap: false,
  logLevel: "info",
});
