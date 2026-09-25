import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { checkPackage, libraryEntries, externalPredicate, sourceFiles } from "../../scripts/package-layout.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const exports = manifest.exports;

function sourceTarget(name) {
  const key = name === "yage" ? "." : `./${name.slice(5)}`;
  if (exports[key]) return typeof exports[key] === "string" ? exports[key] : exports[key]["yage-source"];
  return exports["./*"]["yage-source"].replace("*", key.slice(2));
}

test("root and source exports point to real files without needing dist", () => {
  assert.deepEqual(checkPackage(root, { built: false }), []);
  assert.equal(exports["."].import, "./dist/index.js");
  assert.equal(exports["."].types, "./dist/index.d.ts");
  assert.equal(exports["."]["yage-source"], "./engine/index.ts");
});

test("all engine self-imports are covered by the source export contract", () => {
  for (const file of sourceFiles(resolve(root, "engine")).filter((f) => /\.(ts|js)$/.test(f))) {
    const content = readFileSync(file, "utf8");
    for (const [, name] of content.matchAll(/(?:from\s+|import\s*)["'](yage(?:\/[^"']*)?)["']/g)) {
      assert.ok(existsSync(resolve(root, sourceTarget(name))), `${name} in ${file}`);
    }
  }
});

test("library entries include root, globals, registries, and the JS noise module", () => {
  const entries = libraryEntries(root);
  for (const name of ["index", "global", "game/QuickStart", "schemas/index", "systems/index", "vendor/noise/index"]) {
    assert.ok(entries[name], name);
  }
  assert.ok(Object.keys(entries).every((name) => !name.endsWith(".d")));
});

test("all declared runtime packages and subpaths remain external in the library build", () => {
  const external = externalPredicate(manifest);
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    assert.equal(external(name), true, name);
    assert.equal(external(`${name}/some-subpath`), true, name);
  }
  assert.equal(external("node:fs/promises"), true);
  assert.equal(external("path"), true);
  assert.equal(external("yage/game/QuickStart"), false);
  assert.equal(external("./local-module"), false);
  assert.equal(external("minecs-other-package"), false);
});

test("registration side effects and exact singleton peer versions are explicit", () => {
  assert.equal(manifest.sideEffects, true);
  for (const name of ["minecs", "pixi.js"]) {
    assert.equal(manifest.dependencies[name], undefined);
    assert.equal(manifest.devDependencies[name], manifest.peerDependencies[name]);
  }
});

test("build emits declarations separately from the full typecheck", () => {
  const config = JSON.parse(readFileSync(resolve(root, "tsconfig.build.json"), "utf8"));
  assert.equal(config.compilerOptions.emitDeclarationOnly, true);
  assert.equal(config.compilerOptions.noCheck, true);
  assert.ok(!config.include.some((path) => path.includes("test")));
  assert.equal(manifest.scripts.typecheck, "tsc --noEmit");
});
