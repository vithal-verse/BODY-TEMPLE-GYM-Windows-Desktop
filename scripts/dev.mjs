// Development runner: Next.js dev server (hot reload) + Electron pointed at it.
// Data goes to ./.dev-data (git-ignored) so development never touches a real gym database.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const PORT = 3000;
const URL = `http://localhost:${PORT}`;
const run = (cmd, args, opts = {}) => spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });

await new Promise((resolve, reject) => run("node", ["scripts/build-electron.mjs"]).on("exit", (c) => (c === 0 ? resolve() : reject(new Error("electron build failed")))));

const next = run("npx", ["next", "dev", "-p", String(PORT)]);
const stop = () => next.kill();
process.on("exit", stop);

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Next.js dev server did not start");
}
await waitForServer();

const electron = run(require("electron"), ["."], {
  env: { ...process.env, BTG_DEV_URL: URL, BTG_DATA_DIR: path.resolve(".dev-data") },
});
electron.on("exit", () => {
  stop();
  process.exit(0);
});
