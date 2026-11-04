import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserBundle } from "./ui-final-browser-bundle.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, ["scripts/build-ui-final.mjs"], { cwd: root, stdio: "inherit" });
const { chromium } = await import(process.env.UI_FINAL_PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.UI_FINAL_BROWSER || undefined, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: browserBundle(root, "test/ui-final/context-menu-browser.mjs") });
  await page.locator('[data-uif-id="copy"]').click({ button: "right" });
  await page.locator('[data-uif-id="ordinary"]').click({ button: "right" });
  await page.locator('[data-uif-id="authored"]').click({ button: "right" });
  await page.locator('[data-uif-id="copy"]').click();
  const state = await page.evaluate(() => structuredClone(window.contextMenuTest.state));
  assert.deepEqual(state, { direct: 1, document: 1, activations: 1, defaults: [
    { id: "copy", prevented: true }, { id: "ordinary", prevented: false }, { id: "authored", prevented: true },
  ] });
  await page.evaluate(() => { window.contextMenuTest.dispose(); window.contextMenuTest.dispatchAfterDispose(); });
  assert.equal(await page.evaluate(() => window.contextMenuTest.state.direct), 1);
  assert.deepEqual(errors, []);
  console.log("PASS native contextMenu + authored allowlist, scoped default cancellation, left-click and disposal");
} finally { await browser.close(); }
