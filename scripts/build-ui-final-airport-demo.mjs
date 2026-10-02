import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserBundle } from "./ui-final-browser-bundle.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv.includes("--no-build"))
    execFileSync(process.execPath, ["scripts/build-ui-final.mjs"], { cwd: root, stdio: "inherit" });
const bundle = browserBundle(root, "examples/ui-final-airport/offline.mjs").replaceAll("</script", "<\\/script");
const output = resolve(root, ".ui-final-build/ui-final-airport-demo.html");
await writeFile(output, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:"><title>Sky Harbor · Isometric terminal</title><style>html,body{margin:0;background:#f1f3e8;min-height:100%;}body{overflow-x:hidden}</style></head><body><script>${bundle}</script></body></html>`);
console.log(`Offline airport demo: ${output}`);
