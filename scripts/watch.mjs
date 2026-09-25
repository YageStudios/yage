import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const vite = join(require.resolve("vite/package.json"), "..", "bin", "vite.js");
const tsc = require.resolve("typescript/bin/tsc");
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
function start(file, args) {
  const child = spawn(process.execPath, [file, ...args], { cwd: root, stdio: "inherit" });
  children.add(child);
  child.on("error", (error) => { console.error(error); stop(1); });
  child.on("exit", (code) => { children.delete(child); if (!stopping) stop(code || 1); });
}
// Do not let the JS watcher erase declaration output owned by the TS watcher.
start(vite, ["build", "--watch", "--emptyOutDir", "false"]);
start(tsc, ["-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"]);
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
