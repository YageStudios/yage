import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isBuiltin } from "node:module";

export function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }).sort();
}

export function libraryEntries(root) {
  const sourceRoot = join(root, "engine");
  return Object.fromEntries(sourceFiles(sourceRoot)
    .filter((file) => /\.(ts|js)$/.test(file) && !/\.(d|test|spec)\.ts$/.test(file))
    .map((file) => [relative(sourceRoot, file).replaceAll("\\", "/").replace(/\.(ts|js)$/, ""), file]));
}

export function externalPredicate(manifest) {
  const packages = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  return (id) => isBuiltin(id) || [...packages].some((name) => id === name || id.startsWith(`${name}/`));
}

export function checkPackage(root, { built = true } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const errors = [];
  const check = (target, label) => {
    if (!existsSync(resolve(root, target))) errors.push(`${label}: missing ${target}`);
  };
  for (const [name, target] of Object.entries(manifest.exports)) {
    if (name.includes("*")) continue;
    if (typeof target === "string") { check(target, name); continue; }
    for (const [condition, path] of Object.entries(target)) {
      if (built || !path.startsWith("./dist/")) check(path, `${name} (${condition})`);
    }
  }
  // Every engine module has a stable JS entry and declarations, not only the root.
  if (built) for (const name of Object.keys(libraryEntries(root))) {
    check(`dist/${name}.js`, name);
    check(`dist/${name}.d.ts`, name);
  }
  if (manifest.sideEffects !== true) errors.push("Registration side effects must be preserved.");
  for (const name of ["minecs", "pixi.js"]) {
    if (manifest.dependencies?.[name] || !manifest.peerDependencies?.[name]) {
      errors.push(`${name} must be a peer, not a private runtime dependency.`);
    }
  }
  return errors;
}
