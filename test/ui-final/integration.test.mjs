// Integration contracts against the real Scene/UiLoader source with isolated legacy/platform adapters.
// This is not a substitute for the original engine's Pixi/minECS end-to-end suite.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { Scope, parseDocument } from "../../.ui-final-build/engine/ui/final/index.js";
const require = createRequire(import.meta.url);
const local = resolve("node_modules/typescript/lib/typescript.js");
const ts = require(existsSync(local) ? local : resolve(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "typescript/lib/typescript.js"));
async function sourceModule(path, mocks) {
  const context = vm.createContext({ console });
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const module = new vm.SourceTextModule(source, { context, identifier: path });
  await module.link(specifier => {
    assert.ok(specifier in mocks, `missing adapter ${specifier}`);
    const exports = mocks[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context });
  });
  await module.evaluate(); return module.namespace;
}
async function sceneFixture() {
  const tickers = [], roots = [];
  class Legacy { }
  class Container { constructor() { this.destroyed = false; } destroy() { this.destroyed = true; } }
  class Runtime {
    scope = new Scope(null); frames = []; mounts = [];
    constructor(options) { this.options = options; roots.push(this); }
    mount(content) { this.mounts.push(content); return this; }
    frame(dt) { this.frames.push(dt); }
    dispose() { this.scope.dispose(); }
  }
  class Ticker {
    constructor(type) { this.type = type; this.started = false; tickers.push(this); }
    add(fn) { this.callback = fn; } start() { this.started = true; } stop() { this.started = false; }
  }
  let clears = 0;
  const mocks = { "pixi.js": { Container }, "./Timing": { FIXED_TIMESTEP_MS: 16 }, "./Ticker": { default: Ticker }, "../ui/final/runtime": { UIFinal: Runtime }, "yage/ui/UIService": { UIService: { getInstance: () => ({ clearUI: () => { clears++; } }) } } };
  for (const name of ["AnimatedImageBox", "Box", "Button", "Rectangle", "Text", "TextInput"]) mocks[`yage/ui/${name}`] = { [name]: Legacy };
  const { Scene } = await sourceModule("engine/game/Scene.ts", mocks);
  return { Scene, tickers, roots, clears: () => clears };
}
test("Scene mounts one presentation root, reconciles later mounts, and owns its continuous ticker", async () => {
  const f = await sceneFixture(), scene = new f.Scene();
  const ui = scene.mountUIFinal("one"); scene.mountUIFinal("two");
  assert.equal(f.roots.length, 1); assert.equal(f.tickers.length, 1); assert.equal(f.tickers[0].type, "continuous");
  assert.equal(ui.options.scheduling, "manual"); assert.deepEqual(ui.mounts, ["one", "two"]);
  f.tickers[0].callback(17); assert.deepEqual(ui.frames, [17]);
  scene.destroy(); assert.ok(scene.destroyed); assert.ok(ui.scope.disposed); assert.equal(f.tickers[0].started, false); assert.equal(scene.uiFinal, undefined); assert.equal(f.clears(), 1);
});
test("explicit UI disposal permits a new scene root and destroy still cleans Pixi after a cleanup error", async () => {
  const f = await sceneFixture(), scene = new f.Scene();
  scene.mountUIFinal("old").dispose(); const next = scene.mountUIFinal("new");
  assert.equal(f.roots.length, 2); assert.equal(f.tickers[0].started, false);
  next.scope.add(() => { throw new Error("app cleanup failed"); });
  assert.throws(() => scene.destroy(), /UIF_CLEANUP/); assert.ok(scene.destroyed); assert.equal(f.tickers[1].started, false); assert.equal(f.clears(), 1);
});
test("UiLoader Final assets use overrides and validation without legacy registration; invalid reload keeps last good asset", async () => {
  let legacyRegistrations = 0;
  const mocks = {
    "yage/global": { assignGlobalSingleton: (_name, make) => make() },
    "yage/ui/UiMap": { getUiMapTemplate: () => ({}), registerTemplate: () => { legacyRegistrations++; } },
    "yage/utils/sharedFetch": { default: async () => { throw new Error("network should not be called"); } },
    "../ui/final/document": { parseDocument }, "json5": { default: { parse: JSON.parse } },
    "lodash": { cloneDeep: value => structuredClone(value), get: (value, path) => path.split(".").reduce((next, key) => next?.[key], value) },
    "./BundledUiAssets": { bundledUiAssets: new Map() },
  };
  // parseDocument correctly rejects cross-realm prototypes; convert mock VM-generated data to this realm's JSON tree.
  mocks["../ui/final/document"].parseDocument = value => parseDocument(JSON.parse(JSON.stringify(value)));
  const { UiLoader } = await sourceModule("engine/loader/UiLoader.ts", mocks), loader = new UiLoader();
  const good = { schema: "ui-final/1", root: { type: "text", props: { text: "working" } } };
  loader.registerOverride("final/test.json", good); await loader.loadFinal("test", "assets/ui/final/test.json");
  assert.equal(loader.getFinal("test").root.props.text, "working"); assert.equal(legacyRegistrations, 0);
  loader.registerOverride("final/test.json", { ...good, schema: "invalid" });
  await assert.rejects(loader.loadFinal("test", "final/test.json"), /UIF_DOCUMENT_VERSION/);
  assert.equal(loader.getFinal("test").root.props.text, "working"); assert.throws(() => loader.getFinal("missing"), /UIF_ASSET_MISSING/);
});
