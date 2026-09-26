import { browserBundle } from "./ui-final-browser-bundle.mjs";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv.includes("--no-build")) execFileSync(process.execPath, ["scripts/build-ui-final.mjs"], { cwd: root, stdio: "inherit" });
const playwright = await import(process.env.UI_FINAL_PLAYWRIGHT_MODULE || "playwright-core");
const { chromium } = playwright;
let browser;
const results = [];
try {
  browser = await chromium.launch({ executablePath: process.env.UI_FINAL_BROWSER || undefined, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const uncaught = [];
  page.on("pageerror", error => uncaught.push(String(error)));
  // about:blank + precompiled local code also runs in locked-down, offline CI environments.
  await page.setContent('<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:"><title>UI Final browser tests</title></head><body style="margin:0"></body></html>');
  await page.addScriptTag({ content: browserBundle(root) });
  await page.waitForFunction(() => !!window.runUIFinalTests);
  results.push(...await page.evaluate(() => window.runUIFinalTests()));
  async function nativeTest(name, fn) {
    try { await fn(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: String(error.stack ?? error) }); }
  }
  await page.evaluate(() => window.setupNativeUIFinalTest());
  await nativeTest("real keyboard Enter and Space each activate a native button exactly once", async () => {
    await page.locator('[data-uif-id="native-button"]').focus(); await page.keyboard.press("Enter"); await page.keyboard.press("Space");
    const count = await page.evaluate(() => window.nativeUIFinal.clicks); if (count !== 2) throw new Error(`expected 2, got ${count}`);
  });
  await nativeTest("real touch tap activates once without a synthetic duplicate", async () => {
    await page.locator('[data-uif-id="native-button"]').tap();
    const count = await page.evaluate(() => window.nativeUIFinal.clicks); if (count !== 3) throw new Error(`expected 3, got ${count}`);
  });
  await nativeTest("native pointer capture routes dragging outside the original button", async () => {
    const box = await page.locator('[data-uif-id="drag"]').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await page.mouse.move(box.x + box.width + 200, box.y + 100, { steps: 4 }); await page.mouse.up();
    const result = await page.evaluate(() => ({ captures: window.nativeUIFinal.captures, moves: window.nativeUIFinal.moves }));
    if (result.captures !== 1 || result.moves < 1) throw new Error(JSON.stringify(result));
  });
  await nativeTest("real keyboard editing retains native input behavior", async () => {
    const input = page.locator('[data-uif-id="native-input"]'); await input.focus(); await page.keyboard.type("Sky Harbor"); await page.keyboard.press("ArrowLeft"); await page.keyboard.type("!");
    if (await input.inputValue() !== "Sky Harbo!r") throw new Error(await input.inputValue());
  });
  await page.evaluate(() => window.cleanupUIFinalTests());
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.addScriptTag({ content: browserBundle(root, "examples/ui-final/offline.mjs") });
  await nativeTest("complete 100,000-item showcase mounts with a bounded DOM and accepts equipment commands", async () => {
    await page.waitForFunction(() => window.skyHarborUIDemo?.ui.stats.realizedRows > 0);
    const rows = await page.evaluate(() => window.skyHarborUIDemo.ui.stats.realizedRows);
    if (rows > 14) throw new Error(`unexpected row count ${rows}`);
    await page.locator('[data-uif-id="search"]').fill("Helix");
    await page.waitForFunction(() => window.skyHarborUIDemo.visible.peek().length === 12500);
    await page.locator('[data-uif-id="inventory-list"] button').first().click();
    await page.locator('[data-uif-id="equip"]').click();
    await page.locator('[data-uif-id="confirm-equip"]').click();
    await page.waitForFunction(() => window.skyHarborUIDemo.model.get("equipped") === "Helix coil carbine");
    await page.locator('[data-uif-id="reset"]').click();
    await page.waitForFunction(() => window.skyHarborUIDemo.visible.peek().length === 100000);
    if (process.env.UI_FINAL_SCREENSHOT_DIR) {
      await mkdir(process.env.UI_FINAL_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.UI_FINAL_SCREENSHOT_DIR, "desktop.png"), fullPage: true });
    }
  });
  await nativeTest("showcase reflows at 390px, switches RTL, and disposes every retained element", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-uif-id="language"]').click();
    await page.waitForFunction(() => document.querySelector(".harbor-app")?.dir === "rtl");
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    if (dimensions.scroll > dimensions.width + 1) throw new Error(`horizontal overflow: ${JSON.stringify(dimensions)}`);
    if (process.env.UI_FINAL_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.UI_FINAL_SCREENSHOT_DIR, "mobile-rtl.png"), fullPage: true });
    const remaining = await page.evaluate(() => { const demo = window.skyHarborUIDemo; demo.dispose(); return { rows: demo.ui.stats.realizedRows, resources: demo.ui.scope.resources, roots: document.querySelectorAll("[data-uif-root]").length }; });
    if (remaining.rows !== 0 || remaining.resources !== 0 || remaining.roots !== 0) throw new Error(JSON.stringify(remaining));
  });
  if (uncaught.length) results.push({ name: "no unhandled browser exceptions", pass: false, error: uncaught.join("\n") });
  const output = { browser: await browser.version(), cspUnsafeEval: false, results, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length };
  console.log(JSON.stringify(output, null, 2));
  if (output.failed) process.exitCode = 1;
} finally { await browser?.close(); }
