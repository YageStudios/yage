import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = fileURLToPath(new URL("../../", import.meta.url));
const chromiumPath = "/usr/bin/chromium";

test("browser HMR keeps the page, imported constructor, world instances, state, and draw lifecycle stable", {
  skip: process.env.YAGE_BROWSER_HMR !== "1" || !existsSync(chromiumPath),
  timeout: 30000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), "yage browser hot reload-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const sourceDir = join(root, "src");
  const modules = join(root, "node_modules");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(modules, { recursive: true });
  symlinkSync(engineRoot, join(modules, "yage"), "dir");
  symlinkSync(join(engineRoot, "node_modules", "minecs"), join(modules, "minecs"), "dir");

  const writeSystems = version => {
    writeFileSync(join(sourceDir, "Updater.ts"), [
      'import { System, SystemImpl } from "minecs";',
      'import Description from "yage/schemas/core/Description";',
      "@System(Description)",
      "export class Updater extends SystemImpl {",
      "  count = 0;",
      "  run() { this.count++; window.systemResult = { version: '" + version + "', count: this.count }; }",
      "}",
    ].join("\n"));
    writeFileSync(join(sourceDir, "DrawUpdater.ts"), [
      'import { DrawSystemImpl, System } from "minecs";',
      'import Description from "yage/schemas/core/Description";',
      "@System(Description)",
      "export class DrawUpdater extends DrawSystemImpl {",
      "  init() { window.drawEvents.push('" + version + ":init'); }",
      "  cleanup() { window.drawEvents.push('" + version + ":cleanup'); }",
      "  run() { window.drawVersion = '" + version + "'; }",
      "}",
    ].join("\n"));
  };
  writeSystems("old");
  writeFileSync(join(root, "index.html"), '<div id="app">ready</div><script type="module" src="/src/main.ts"></script>');
  writeFileSync(join(sourceDir, "main.ts"), [
    'import { addComponent, addEntity, createWorld, stepWorldDraw } from "minecs";',
    'import Description from "yage/schemas/core/Description";',
    'import { Updater } from "./Updater";',
    'import { DrawUpdater } from "./DrawUpdater";',
    'import { applyHotReload, getHotSystem, stepHotWorld } from "yage/dev/hotReload";',
    "declare global { interface Window { pageToken: string; worlds: any[]; systemRefs: any[]; systemRefsInitial: any[]; systemCtors: any[]; drawEvents: string[]; systemResult: any; drawVersion: string; tick: () => void; makeFutureWorld: () => any } }",
    "window.pageToken = Math.random().toString(36);",
    "window.drawEvents = [];",
    "window.worlds = [createWorld(), createWorld()];",
    "window.systemRefs = []; window.systemCtors = [];",
    "for (const world of window.worlds) {",
    "  const entity = addEntity(world); addComponent(world, Description, entity, { description: 'live' });",
    "  window.systemRefs.push(getHotSystem(world, Updater)); window.systemCtors.push(Updater);",
    "}",
    "window.systemRefsInitial = [...window.systemRefs];",
    "const drawWorld = window.worlds[0]; window.drawRef = getHotSystem(drawWorld, DrawUpdater);",
    "window.tick = () => { for (const world of window.worlds) { applyHotReload(world); stepHotWorld(world, false); } stepWorldDraw(drawWorld); };",
    "window.makeFutureWorld = () => { const world = createWorld(); const entity = addEntity(world); addComponent(world, Description, entity, { description: 'future' }); const instance = getHotSystem(world, Updater); instance.runAll(world); return { instance, constructor: Updater }; };",
    "setInterval(window.tick, 30);",
  ].join("\n"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "yage-browser-hmr", type: "module" }));
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { experimentalDecorators: true } }));

  const { chromium } = await import("playwright-core");
  const { yageHotReload } = await import("../../tooling/hot-reload.mjs");
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  const server = await (await import("vite")).createServer({
    configFile: false,
    root,
    plugins: yageHotReload(),
    resolve: { conditions: ["yage-source", "module", "browser", "development|production"] },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => window.systemResult?.version === "old" && window.drawVersion === "old");

  const before = await page.evaluate(() => ({
    token: window.pageToken,
    count: window.systemResult.count,
    sameRefs: window.systemRefs.every((instance, index) => instance === window.systemRefsInitial[index]),
  }));
  writeSystems("new");
  await page.waitForFunction(() => window.systemResult?.version === "new" && window.drawVersion === "new");

  const after = await page.evaluate(() => ({
    token: window.pageToken,
    count: window.systemResult.count,
    sameRefs: window.systemRefs.every((instance, index) => instance === window.systemRefsInitial[index]),
    stableConstructor: window.systemRefs.every((instance, index) => instance.constructor === window.systemCtors[index]),
    instanceType: window.systemRefs.every((instance, index) => instance instanceof window.systemCtors[index]),
    drawEvents: window.drawEvents,
  }));
  assert.equal(after.token, before.token, "the self-accepted HMR update must keep the page loaded");
  assert.equal(before.sameRefs, true);
  assert.equal(after.sameRefs, true, "existing worlds must keep their live system references");
  assert.ok(after.count > before.count, "simulation fields must survive replacement");
  assert.equal(after.stableConstructor, true, "imported system constructors must keep identity");
  assert.equal(after.instanceType, true, "existing instances must remain instanceof their imported constructor");
  assert.ok(after.drawEvents.includes("old:cleanup"));
  assert.ok(after.drawEvents.includes("new:init"));
  assert.deepEqual(browserErrors, []);

  const future = await page.evaluate(() => {
    const { instance, constructor } = window.makeFutureWorld();
    return { version: window.systemResult.version, constructorStable: instance.constructor === constructor && constructor === window.systemCtors[0] };
  });
  assert.equal(future.constructorStable, true, "a world created after HMR must use the stable imported constructor");
});
