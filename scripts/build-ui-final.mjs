import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localCompiler = join(root, "node_modules/typescript/bin/tsc");
rmSync(join(root, ".ui-final-build"), { recursive: true, force: true });
const args = ["-p", "tsconfig.ui-final.json"];
execFileSync(existsSync(localCompiler) ? process.execPath : "tsc", existsSync(localCompiler) ? [localCompiler, ...args] : args, { cwd: root, stdio: "inherit" });
function rewrite(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) rewrite(path);
    else if (item.name.endsWith(".js")) {
      const code = readFileSync(path, "utf8").replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
        (match, before, path, after) => /\.[a-z]+$/i.test(path) ? match : `${before}${path}.js${after}`);
      writeFileSync(path, code);
    }
  }
}
rewrite(join(root, ".ui-final-build"));
console.log("UI Final: isolated TypeScript build passed.");
