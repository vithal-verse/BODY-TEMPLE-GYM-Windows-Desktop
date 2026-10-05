// Bundles the Electron main process and preload script with esbuild.
// better-sqlite3 stays external (native addon, shipped unpacked); everything else is inlined.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  legalComments: "none",
  tsconfig: "electron/tsconfig.json",
};

await build({
  ...common,
  entryPoints: ["electron/main/index.ts"],
  outfile: "dist-electron/main.js",
  external: ["electron", "better-sqlite3"],
});
// Sandboxed preload: may only require("electron"), so everything else is bundled in.
await build({
  ...common,
  entryPoints: ["electron/preload/index.ts"],
  outfile: "dist-electron/preload.js",
  external: ["electron"],
});
