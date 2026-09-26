import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, ["scripts/build-ui-final.mjs"], { cwd: root, stdio: "inherit" });
const files = readdirSync(resolve(root, "test/ui-final")).filter(file => file.endsWith(".test.mjs")).map(file => `test/ui-final/${file}`);
execFileSync(process.execPath, ["--experimental-vm-modules", "--test", ...files], { cwd: root, stdio: "inherit" });
