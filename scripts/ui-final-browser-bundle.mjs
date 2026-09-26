/** Dependency-free local test bundler. TypeScript is already a development dependency. No eval or network fetches. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
const require = createRequire(import.meta.url);
export function browserBundle(root, entry = "test/ui-final/browser.mjs") {
  const local = join(root, "node_modules/typescript/lib/typescript.js");
  const global = existsSync(local) ? "" : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const ts = require(existsSync(local) ? local : join(global, "typescript/lib/typescript.js"));
  const sources = [];
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith(".js")) sources.push(path);
    }
  }
  walk(join(root, ".ui-final-build/engine"));
  if (existsSync(join(root, ".ui-final-build/examples"))) walk(join(root, ".ui-final-build/examples"));
  sources.push(join(root, entry));
  const modules = [...new Set(sources)].map(path => {
    const id = `/${relative(root, path).replaceAll("\\", "/")}`;
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, sourceMap: false } }).outputText;
    return `${JSON.stringify(id)}: function(module, exports, require) {\n${code}\n}`;
  });
  return `(function(){ "use strict"; const modules = {${modules.join(",\n")}}; const cache = Object.create(null);
function load(id, parent = "/") {
  if (id.startsWith(".")) {
    const parts = parent.split("/"); parts.pop();
    for (const part of id.split("/")) { if (part === "..") parts.pop(); else if (part !== ".") parts.push(part); }
    id = parts.join("/");
  }
  if (cache[id]) return cache[id].exports;
  if (!modules[id]) throw new Error("UI Final test bundle missing module: " + id);
  const module = cache[id] = { exports: {} }; modules[id](module, module.exports, next => load(next, id)); return module.exports;
}
load(${JSON.stringify(`/${entry}`)}); })();`;
}
