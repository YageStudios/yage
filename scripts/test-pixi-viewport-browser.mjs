/** PixiViewportSystem.configure in headless Chromium: bundles test/render/pixiViewport.browser.ts (esbuild) and runs it offline. */
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  entryPoints: [resolve(root, "test/render/pixiViewport.browser.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  conditions: ["yage-source"],
  alias: { yage: resolve(root, "engine") },
  tsconfig: resolve(root, "tsconfig.json"),
  logLevel: "error",
});
const { chromium } = await import(process.env.UI_FINAL_PLAYWRIGHT_MODULE || "playwright-core");
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.UI_FINAL_BROWSER || undefined, headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const uncaught = [];
  page.on("pageerror", (error) => uncaught.push(String(error)));
  await page.setContent('<!doctype html><html><head><meta charset="UTF-8"><title>PixiViewport browser tests</title></head><body style="margin:0"></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(() => window.runPixiViewportTests());
  if (uncaught.length) results.push({ name: "no unhandled browser exceptions", pass: false, error: uncaught.join("\n") });
  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "ok  " : "FAIL"} ${r.name}${r.pass ? "" : `\n${r.error}`}`);
  console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length || !results.length) process.exitCode = 1;
} finally {
  await browser?.close();
}
