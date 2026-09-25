import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { yage, yageJson5 } from "../../tooling/vite.mjs";

const engineRoot = fileURLToPath(new URL("../../", import.meta.url));
function fixture(t, version = "0.0.24") {
  const root = mkdtempSync(join(tmpdir(), "yage game with spaces-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const packages = {
    minecs: { version },
    "pixi.js": { version: "7.4.2", dependencies: { "@pixi/core": "7.4.2" } },
    "@pixi/core": { version: "7.4.2", dependencies: { "@pixi/math": "7.4.2" } },
    "@pixi/math": { version: "7.4.2" },
  };
  for (const [name, pkg] of Object.entries(packages)) {
    const path = join(root, "node_modules", name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "package.json"), JSON.stringify({ name, ...pkg }));
  }
  return root;
}
function server() {
  const watcher = new EventEmitter();
  const state = { invalidations: 0, messages: [], watched: [] };
  watcher.add = (paths) => state.watched.push(...paths);
  return {
    state, watcher, httpServer: new EventEmitter(),
    moduleGraph: { invalidateAll: () => state.invalidations++ },
    ws: { send: (message) => state.messages.push(message) },
  };
}

test("Node can import yage/vite without window, an engine build, or browser dependencies", () => {
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(typeof yage, "function");
});

test("source config uses exports, keeps caller settings, and dedupes transitive Pixi modules", (t) => {
  const root = fixture(t);
  const config = yage()[0].config({
    root, resolve: { dedupe: ["another-lib"], conditions: ["custom"] },
    server: { fs: { allow: [root, "/explicit/shared"] } },
    optimizeDeps: { exclude: ["another-lib"] },
  });
  assert.deepEqual(config.resolve.conditions, ["yage-source", "custom"]);
  assert.equal(config.resolve.preserveSymlinks, false);
  assert.equal(config.resolve.alias, undefined);
  assert.deepEqual(config.resolve.dedupe, ["another-lib", "minecs", "pixi.js", "@pixi/core", "@pixi/math"]);
  assert.ok(config.server.fs.allow.includes(engineRoot.replace(/\/$/, "")));
  assert.ok(config.server.fs.allow.includes("/explicit/shared"));
  assert.deepEqual(config.optimizeDeps.exclude, ["another-lib", "yage"]);
  assert.ok(config.optimizeDeps.include.includes("yage > lodash"));
  assert.ok(config.optimizeDeps.include.includes("minecs"));
});

test("default conditions retain Vite's client conditions", (t) => {
  const config = yage()[0].config({ root: fixture(t) });
  assert.deepEqual(config.resolve.conditions, ["yage-source", "module", "browser", "development|production"]);
});

test("compiled-package mode does not select source or add a source watcher", (t) => {
  const plugin = yage({ source: false })[0];
  const config = plugin.config({ root: fixture(t) });
  assert.ok(!config.resolve.conditions.includes("yage-source"));
  assert.equal(config.optimizeDeps.exclude, undefined);
  assert.equal(config.server, undefined);
  const s = server(); plugin.configureServer(s);
  assert.equal(s.watcher.listenerCount("all"), 0);
});

test("an incompatible ECS peer gives an actionable error", (t) => {
  assert.throws(() => yage()[0].config({ root: fixture(t, "0.0.22") }), /requires 0\.0\.24/);
});

test("missing game peers are not silently resolved from the engine's private dependencies", (t) => {
  const root = fixture(t);
  rmSync(join(root, "node_modules", "minecs"), { recursive: true });
  assert.throws(() => yage()[0].config({ root }), /Missing minecs/);
});

test("preserving symlinks and optimizing engine source are rejected", (t) => {
  const root = fixture(t);
  assert.throws(() => yage()[0].config({ root, resolve: { preserveSymlinks: true } }), /preserveSymlinks/);
  assert.throws(() => yage()[0].config({ root, optimizeDeps: { include: ["yage/game/QuickStart"] } }), /optimizeDeps/);
});

test("raw/url JSON5 and unrelated files bypass the JSON5 parser", async () => {
  const plugin = yageJson5();
  for (const file of ["/ui.json5?raw", "/ui.jsonc?url", "/ui.json5?import&raw", "/index.ts", "/data.json"]) {
    assert.equal(await plugin.transform("not JSON", file), null);
  }
  assert.equal(yage({ json5: false }).length, 1);
});

test("engine change/add/unlink events invalidate glob transforms and debounce one full reload", async (t) => {
  const plugin = yage()[0]; const s = server();
  t.after(() => plugin.closeBundle());
  plugin.configureServer(s);
  const file = join(engineRoot, "engine", "schemas", "NewComponent.ts");
  for (const event of ["change", "add", "unlink"]) s.watcher.emit("all", event, file);
  await delay(110);
  assert.equal(s.state.invalidations, 1);
  assert.deepEqual(s.state.messages, [{ type: "full-reload", path: "*" }]);
  assert.deepEqual(plugin.handleHotUpdate({ file }), []);
});

test("bundled asset edits reload, but game files and lookalike paths do not", async (t) => {
  const plugin = yage()[0]; const s = server();
  t.after(() => plugin.closeBundle()); plugin.configureServer(s);
  for (const file of [join(engineRoot, "../example/src/main.ts"), join(engineRoot, "engine-other/module.ts")]) {
    s.watcher.emit("all", "change", file);
    assert.equal(plugin.handleHotUpdate({ file }), undefined);
  }
  await delay(110); assert.equal(s.state.messages.length, 0);
  s.watcher.emit("all", "change", join(engineRoot, "assets", "ui", "flow.json5"));
  await delay(110); assert.equal(s.state.messages.length, 1);
});

test("closing a server cancels pending reloads and removes listener hooks", async () => {
  const plugin = yage()[0]; const s = server(); plugin.configureServer(s);
  s.watcher.emit("all", "change", join(engineRoot, "engine", "global.ts"));
  s.httpServer.emit("close"); await delay(110);
  assert.equal(s.watcher.listenerCount("all"), 0);
  assert.equal(s.state.messages.length, 0);
  plugin.closeBundle();
});

test("reconfiguration and reload:false do not leave extra watcher listeners", () => {
  const plugin = yage()[0]; const s = server();
  plugin.configureServer(s); plugin.configureServer(s);
  assert.equal(s.watcher.listenerCount("all"), 1);
  plugin.closeBundle(); assert.equal(s.watcher.listenerCount("all"), 0);
  yage({ reload: false })[0].configureServer(s);
  assert.equal(s.watcher.listenerCount("all"), 0);
});
