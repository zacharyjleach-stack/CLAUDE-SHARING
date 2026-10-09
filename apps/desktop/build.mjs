// Bundles main + renderer into single self-contained CJS files with
// esbuild, so the packaged app ships with no node_modules at all (avoids
// npm workspaces hoisting fighting electron-builder's dependency pruning).
// `electron` itself stays external — it's provided by the Electron runtime.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron"],
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/main/index.ts"], outfile: "dist/main/index.js" });
await build({ ...common, entryPoints: ["src/renderer/renderer.ts"], outfile: "dist/renderer/renderer.js" });

mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer/index.html", "dist/renderer/index.html");
cpSync("src/renderer/styles.css", "dist/renderer/styles.css");
