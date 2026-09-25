import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// Tests the real npm commands in an isolated, dependency-free fixture, not the game runtime.
test("npm link then npm link yage expose conditional package exports in a separate project", () => {
  const root = mkdtempSync(join(tmpdir(), "yage-npm-link-"));
  try {
    const engine = join(root, "yage"), example = join(root, "example");
    mkdirSync(join(engine, "engine", "game"), { recursive: true });
    mkdirSync(example);
    const original = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    const fixture = { name: "yage", version: original.version, type: "module", exports: original.exports };
    writeFileSync(join(engine, "package.json"), JSON.stringify(fixture));
    writeFileSync(join(engine, "engine", "game", "QuickStart.ts"), "export const fixture = true;\n");
    const gameManifest = JSON.stringify({ name: "link-consumer", version: "1.0.0", private: true, type: "module" });
    writeFileSync(join(example, "package.json"), gameManifest);
    const env = { ...process.env, npm_config_prefix: join(root, "prefix"), npm_config_cache: join(root, "cache"), npm_config_update_notifier: "false" };
    const command = (cwd, args) => {
      const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
        cwd, env, encoding: "utf8", timeout: 20000, shell: process.platform === "win32",
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    };
    command(engine, ["link", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"]);
    command(example, ["link", "yage", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"]);
    assert.equal(realpathSync(join(example, "node_modules", "yage")), realpathSync(engine));
    assert.equal(readFileSync(join(example, "package.json"), "utf8"), gameManifest);
    const resolve = (conditions) => {
      const result = spawnSync(process.execPath, [
        ...conditions, "--input-type=module", "-e", "console.log(import.meta.resolve('yage/game/QuickStart'))",
      ], { cwd: example, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    assert.ok(resolve(["--conditions=yage-source"]).endsWith("/engine/game/QuickStart.ts"));
    assert.ok(resolve([]).endsWith("/dist/game/QuickStart.js"));
  } finally { rmSync(root, { force: true, recursive: true }); }
});
